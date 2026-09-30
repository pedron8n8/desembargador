"""Rodar o grafo fora da request, e contar ao vivo o que ele esta' fazendo.

Uma consulta leva minutos e custa dinheiro. Nenhuma das duas coisas cabe dentro
de um request HTTP, entao: ThreadPoolExecutor no proprio processo do uvicorn,
eventos gravados em web.db, e SSE para o navegador.

SEM Celery e SEM Redis de proposito. O grafo e' sincrono (async nao ganharia
nada), a durabilidade que importa ja' existe no output/rag_runs.db — e o gargalo
real e' USD por consulta, nao CPU.

O que o stream do LangGraph entrega, medido no langgraph 1.2.10:

    ("tasks",   {id, name, input, triggers})     o no' acendeu
    ("updates", {nome_do_no: delta_do_estado})   o que ele mudou
    ("tasks",   {id, name, result, error, ...})  o no' terminou

Como Estado.custos e' Annotated[list, operator.add], cada no' devolve o proprio
custo no delta — modelo, tokens e USD por no' saem de graca, sem instrumentar
nada.
"""
import contextlib
import datetime as dt
import json
import os
import queue
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

from src import cerebros
from src.rag import cli, grafo
from src.rag.llm import SemChave, SemCredito

from .esquema import db

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS = os.path.join(RAIZ, "output", "rag_runs.db")

MAX_WORKERS = 2
_pool = None
_ouvintes = {}          # thread_consulta -> [SimpleQueue]
_trava = threading.Lock()


def _agora():
    return dt.datetime.now().isoformat(timespec="seconds")


# --------------------------------------------------------- prints dos nós

class _Roteador:
    """sys.stdout compartilhado que sabe de qual consulta veio cada linha.

    grafo.no_triar e no_redigir imprimem avisos que importam ("triagem cortada
    no teto", "AVISO: a triagem não devolveu nota nenhuma"). No servidor isso
    sumiria no console. contextlib.redirect_stdout nao serve aqui: ele troca
    sys.stdout do PROCESSO, e com dois workers um capturaria os prints do outro.
    Este roteador e' instalado uma vez e despacha por thread do SO.
    """

    def __init__(self, real):
        self.real = real
        self.local = threading.local()

    def write(self, texto):
        alvo = getattr(self.local, "consulta", None)
        if alvo and texto.strip():
            for linha in texto.splitlines():
                if linha.strip():
                    publicar(alvo, "log", {"linha": linha.rstrip()})
        return self.real.write(texto)

    def flush(self):
        return self.real.flush()

    def isatty(self):
        return False


_roteador_out = _roteador_err = None


def instalar_roteador():
    global _roteador_out, _roteador_err
    if _roteador_out is None:
        _roteador_out = _Roteador(sys.stdout)
        _roteador_err = _Roteador(sys.stderr)
        sys.stdout, sys.stderr = _roteador_out, _roteador_err


@contextlib.contextmanager
def _rotulando(thread):
    """Marca esta thread do SO como pertencente a esta consulta."""
    if _roteador_out is None:
        yield
        return
    for r in (_roteador_out, _roteador_err):
        r.local.consulta = thread
    try:
        yield
    finally:
        for r in (_roteador_out, _roteador_err):
            r.local.consulta = None


# ------------------------------------------------------------- eventos

def publicar(thread, tipo, payload):
    """Grava e empurra. A ordem importa: quem se conecta no meio le' o banco e
    depois assina a fila, entao o evento precisa estar no banco antes de sair."""
    c = db()
    try:
        with c:
            seq = (c.execute("SELECT coalesce(max(seq),0)+1 FROM evento WHERE thread=?",
                             (thread,)).fetchone()[0])
            c.execute("INSERT INTO evento (thread, seq, tipo, payload_json, criado_em) "
                      "VALUES (?,?,?,?,?)",
                      (thread, seq, tipo,
                       json.dumps(payload, ensure_ascii=False, default=str), _agora()))
    finally:
        c.close()
    ev = {"seq": seq, "tipo": tipo, "payload": payload}
    with _trava:
        for q in _ouvintes.get(thread, []):
            q.put(ev)
    return seq


def assinar(thread, desde=0):
    """Gerador de eventos: primeiro o que ja' passou, depois o que vier.

    Assina ANTES de ler o banco. O contrario perderia todo evento publicado
    entre a leitura e a assinatura — que e' justamente quando o no' mais
    barulhento esta' rodando.
    """
    q = queue.SimpleQueue()
    with _trava:
        _ouvintes.setdefault(thread, []).append(q)
    try:
        c = db()
        try:
            passados = c.execute(
                "SELECT seq, tipo, payload_json FROM evento WHERE thread=? AND seq>? "
                "ORDER BY seq", (thread, desde)).fetchall()
        finally:
            c.close()
        visto = desde
        for seq, tipo, p in passados:
            visto = seq
            yield {"seq": seq, "tipo": tipo, "payload": json.loads(p)}
        while True:
            try:
                ev = q.get(timeout=15)
            except queue.Empty:
                yield None                      # heartbeat: mantem o proxy vivo
                continue
            if ev["seq"] <= visto:              # ja' veio na reproducao
                continue
            visto = ev["seq"]
            yield ev
            if ev["tipo"] in ("fim", "erro"):
                return
    finally:
        with _trava:
            restantes = [x for x in _ouvintes.get(thread, []) if x is not q]
            if restantes:
                _ouvintes[thread] = restantes
            else:
                _ouvintes.pop(thread, None)


# ------------------------------------------------------------- execução

def _estado_execucao(thread, **campos):
    c = db()
    try:
        with c:
            c.execute("UPDATE execucao SET %s WHERE thread=?"
                      % ",".join("%s=?" % k for k in campos),
                      list(campos.values()) + [thread])
    finally:
        c.close()


def _gravar_custos(thread, custos):
    c = db()
    try:
        with c:
            c.execute("DELETE FROM custo WHERE thread=?", (thread,))
            c.executemany(
                "INSERT INTO custo (thread, no, modelo, tokens_in, tokens_out, "
                "custo_usd, quando) VALUES (?,?,?,?,?,?,?)",
                [(thread, x.get("no"), x.get("modelo"), x.get("tokens_in", 0),
                  x.get("tokens_out", 0), x.get("custo_usd", 0.0), _agora())
                 for x in custos])
    finally:
        c.close()


def _rodar(thread, entrada, so_prognostico):
    """O worker. Roda numa thread do pool; nada aqui pode levantar para fora."""
    t0 = dt.datetime.now()
    _estado_execucao(thread, estado="rodando")
    cfg = {"configurable": {"thread_id": thread}, "recursion_limit": 30}
    app = grafo.construir(checkpoint=RUNS, so_prognostico=so_prognostico)
    try:
        with _rotulando(thread):
            publicar(thread, "inicio", {"so_prognostico": bool(so_prognostico)})
            for modo, ev in app.stream(entrada, config=cfg,
                                       stream_mode=["tasks", "updates"]):
                if modo == "tasks":
                    nome = ev.get("name")
                    if nome and nome.startswith("__"):
                        continue
                    if "result" in ev or "error" in ev:
                        publicar(thread, "no_fim", {
                            "no": nome, "erro": str(ev.get("error") or "") or None,
                            "custos": _custos_do_resultado(ev.get("result"))})
                    else:
                        publicar(thread, "no_inicio", {"no": nome})
                elif modo == "updates":
                    for nome, delta in (ev or {}).items():
                        if not nome.startswith("__"):
                            publicar(thread, "delta",
                                     {"no": nome, "campos": _resumir_delta(delta)})
            estado = app.get_state(cfg).values
        seg = (dt.datetime.now() - t0).total_seconds()
        _, total, _ = cli.finalizar(thread, estado, seg)
        _gravar_custos(thread, estado.get("custos") or [])
        _estado_execucao(thread, estado="pronto", terminado_em=_agora(), segundos=seg)
        publicar(thread, "fim", {"segundos": seg, "custo_usd": total})
    except (SemChave, SemCredito) as e:
        # o que ja' rodou esta' no checkpoint: da' para retomar sem repagar
        _estado_execucao(thread, estado="interrompido", terminado_em=_agora(),
                         erro=str(e))
        publicar(thread, "erro", {"mensagem": str(e), "retomavel": True})
    except Exception as e:                                    # noqa: BLE001
        _estado_execucao(thread, estado="erro", terminado_em=_agora(), erro=repr(e))
        publicar(thread, "erro", {"mensagem": "%s: %s" % (type(e).__name__, e),
                                  "retomavel": True})


def _custos_do_resultado(result):
    """O custo que o no' acabou de gastar, tirado do `result` da task.

    No langgraph 1.2.10 o `result` e' o DICT que o no' devolveu — {'custos':
    [...], 'triagem': {...}}. A primeira versao disto assumia lista de pares
    (campo, valor) e falhava calada: iterar um dict da' as chaves, desempacotar
    uma string em dois nomes levanta ValueError, o except engolia e todo no'
    aparecia custando US$ 0,0000 ao vivo — com o total certo no fim, que e' o
    jeito mais convincente de um numero errado passar. As duas formas seguem
    aceitas para nao quebrar de novo numa atualizacao."""
    if not result:
        return []
    if isinstance(result, dict):
        return [dict(x) for x in (result.get("custos") or [])]
    try:
        for campo, valor in result:
            if campo == "custos":
                return [dict(x) for x in valor]
    except (TypeError, ValueError):
        pass
    return []


def _resumir_delta(delta):
    """O delta inteiro tem ementas e minuta — nao vai por SSE. So' o formato."""
    if not isinstance(delta, dict):
        return {}
    fora = {}
    for k, v in delta.items():
        if k == "custos":
            continue
        if isinstance(v, list):
            fora[k] = {"n": len(v)}
        elif isinstance(v, str):
            fora[k] = {"chars": len(v)}
        elif isinstance(v, dict):
            fora[k] = {"chaves": sorted(v)[:12]}
        else:
            fora[k] = v
    return fora


def pool():
    global _pool
    if _pool is None:
        _pool = ThreadPoolExecutor(max_workers=MAX_WORKERS,
                                   thread_name_prefix="consulta")
    return _pool


def vivas_de(conn, email):
    """Execucoes do usuario que ainda vao consumir LLM.

    'fila' conta junto com 'rodando' de proposito: com MAX_WORKERS=2, o que
    esta' na fila ja' e' custo comprometido e ja' esta' segurando a vez dos
    outros usuarios.
    """
    return conn.execute(
        "SELECT count(*) FROM execucao WHERE email=? AND estado IN ('fila','rodando')",
        (email,)).fetchone()[0]


def iniciar(thread, email, caso, tese="neutra", filtros=None, so_prognostico=False,
            cerebro=None, comparacao=None, origem=None):
    """`origem`: {'eproc': '<20 digitos>', 'instancia': '1g'|'2g'} quando a
    consulta veio da extensao do eproc; None quando veio do site."""
    cerebro = cerebros.resolver(cerebro)
    origem = origem or {}
    c = db()
    try:
        with c:
            # COLUNAS NOMEADAS. A versao posicional (8 '?') quebrava assim que a
            # tabela ganhasse uma coluna — e ganhou duas nesta fase.
            c.execute(
                "INSERT OR REPLACE INTO execucao "
                "(thread, email, estado, criado_em, so_prognostico, cerebro, "
                " comparacao, origem_eproc, origem_instancia) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (thread, email, "fila", _agora(), int(bool(so_prognostico)),
                 cerebro, comparacao, origem.get("eproc"), origem.get("instancia")))
            c.execute("INSERT OR REPLACE INTO dono (thread, email) VALUES (?,?)",
                      (thread, email))
    finally:
        c.close()
    entrada = {"caso": caso, "custos": [], "criticas": [], "ciclo_revisao": 0,
               "tese": tese, "filtros": filtros or {}, "cerebro": cerebro}
    pool().submit(_rodar, thread, entrada, so_prognostico)
    return thread


def retomar(thread, so_prognostico=False):
    """invoke/stream com entrada None. Reenviar o input reinicia o grafo do zero
    e REPAGA as chamadas de LLM que ja' sairam — e' a razao de existir o botao
    em vez de retomada automatica."""
    _estado_execucao(thread, estado="fila", erro=None)
    pool().submit(_rodar, thread, None, so_prognostico)
    return thread


def reconciliar():
    """No startup: quem ficou 'rodando' quando o processo morreu?

    Nao retoma sozinho — retomar gasta dinheiro. So' classifica, para a interface
    poder oferecer o botao.
    """
    c = db()
    try:
        pendentes = c.execute(
            "SELECT thread, so_prognostico FROM execucao "
            "WHERE estado IN ('rodando','fila')").fetchall()
    finally:
        c.close()
    saida = []
    for linha in pendentes:
        thread, sop = linha["thread"], linha["so_prognostico"]
        try:
            app = grafo.construir(checkpoint=RUNS, so_prognostico=bool(sop))
            st = app.get_state({"configurable": {"thread_id": thread}})
        except Exception:                                     # noqa: BLE001
            _estado_execucao(thread, estado="erro", erro="checkpoint ilegível")
            saida.append((thread, "erro"))
            continue
        if st.next:
            _estado_execucao(thread, estado="interrompido",
                             erro="servidor reiniciou no nó '%s'" % st.next[0])
            saida.append((thread, "interrompido"))
        elif st.values:
            # terminou de verdade antes do crash, so' nao fechou a conta
            _, total, _ = cli.finalizar(thread, st.values, 0.0)
            _gravar_custos(thread, st.values.get("custos") or [])
            _estado_execucao(thread, estado="pronto", terminado_em=_agora())
            saida.append((thread, "pronto"))
        else:
            _estado_execucao(thread, estado="erro", erro="sem checkpoint")
            saida.append((thread, "erro"))
    return saida


if __name__ == "__main__":
    import tempfile

    from . import esquema

    esquema.WEB = os.path.join(tempfile.mkdtemp(), "web.db")

    # --- reprodução + assinatura: o evento publicado depois de assinar chega,
    # e o publicado antes tambem — sem duplicar
    publicar("t1", "inicio", {"a": 1})
    publicar("t1", "no_inicio", {"no": "triagem"})
    g = assinar("t1", desde=0)
    assert next(g)["payload"] == {"a": 1}
    assert next(g)["tipo"] == "no_inicio"
    publicar("t1", "fim", {"segundos": 1})
    assert next(g)["tipo"] == "fim"
    try:
        next(g)
        raise AssertionError("o gerador tinha que encerrar no 'fim'")
    except StopIteration:
        pass
    assert not _ouvintes, "vazou ouvinte: %s" % _ouvintes

    # retomar do meio: 'desde' pula o que o cliente ja' viu
    g = assinar("t1", desde=1)
    assert next(g)["seq"] == 2
    g.close()

    # --- o delta nao pode carregar a minuta inteira para dentro do SSE
    d = _resumir_delta({"minuta": "x" * 50000, "precedentes": [1, 2, 3],
                        "custos": [{"custo_usd": 1}], "triagem": {"classe": "Ap"},
                        "ciclo_busca": 1})
    assert d == {"minuta": {"chars": 50000}, "precedentes": {"n": 3},
                 "triagem": {"chaves": ["classe"]}, "ciclo_busca": 1}, d

    # --- custo extraido do result de uma task.
    # A forma que o langgraph 1.2.10 realmente manda e' DICT. Este assert e' o
    # que teria pego o bug de todo no' aparecer a US$ 0,0000 ao vivo.
    esperado = [{"no": "triagem", "custo_usd": 0.01}]
    assert _custos_do_resultado({"custos": esperado, "triagem": {}}) == esperado
    # ... e a forma de pares continua aceita, para nao quebrar numa atualizacao
    assert _custos_do_resultado([("custos", esperado), ("triagem", {})]) == esperado
    assert _custos_do_resultado(None) == [] and _custos_do_resultado([]) == []
    assert _custos_do_resultado({"triagem": {}}) == []

    # --- o roteador manda cada print para a consulta certa, mesmo com duas
    # threads imprimindo ao mesmo tempo
    instalar_roteador()
    erros = []

    def imprime(nome, n):
        try:
            with _rotulando(nome):
                for i in range(n):
                    print("linha %d de %s" % (i, nome))
        except Exception as e:                                # noqa: BLE001
            erros.append(e)

    a = threading.Thread(target=imprime, args=("ta", 20))
    b = threading.Thread(target=imprime, args=("tb", 20))
    a.start(), b.start(), a.join(), b.join()
    assert not erros, erros
    c = db()
    for nome in ("ta", "tb"):
        linhas = [json.loads(r[0])["linha"] for r in c.execute(
            "SELECT payload_json FROM evento WHERE thread=? AND tipo='log'", (nome,))]
        assert len(linhas) == 20, (nome, len(linhas))
        assert all(nome in l for l in linhas), "print vazou entre consultas"
    c.close()

    print("self-check OK — eventos reproduzem sem duplicar e os prints não se misturam")
