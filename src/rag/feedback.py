"""Qualificação humana das respostas + o que ela efetivamente muda.

Duas coisas separadas, e vale não confundir:

1. NOTA DA CONSULTA (0-5) — serve para medir. Guardada ao lado da nota do juiz
   automático, ela responde a pergunta que decide tudo: o juiz concorda com você?
   Se concordar, dá para trocar de modelo rodando o bench sem ler minuta nenhuma.
   Se não concordar, o juiz não vale como instrumento e o bench mente.

2. VEREDITO POR PRECEDENTE (útil/inútil) — serve para melhorar. É o único sinal
   que realimenta a recuperação: um precedente marcado inútil desce, um marcado
   útil sobe, nas consultas seguintes.

O ajuste é limitado de propósito (ver `boost`): o BM25 foi calibrado em 400
casos cegos, e deixar o feedback mexer demais nele joga fora essa calibração em
troca de meia dúzia de cliques.
"""
import argparse
import datetime as dt
import json
import os
import sqlite3
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FB = os.path.join(RAIZ, "output", "feedback.db")

# Teto do ajuste por feedback: +-30%. Um precedente reprovado nao some do indice,
# so' perde posicao — humano erra, e o BM25 vale mais que uma marcacao isolada.
TETO = 0.30
POR_VOTO = 0.10

ESQUEMA = """
CREATE TABLE IF NOT EXISTS consulta (
  thread TEXT PRIMARY KEY, criado_em TEXT, caso TEXT,
  prognostico_json TEXT, minuta TEXT, custo_usd REAL, modelos_json TEXT);
CREATE TABLE IF NOT EXISTS precedente_uso (
  thread TEXT, decisao_id INTEGER, numero TEXT, nota_triagem INTEGER,
  veredito TEXT,                       -- 'util' | 'inutil' | NULL (nao avaliado)
  PRIMARY KEY (thread, decisao_id));
CREATE TABLE IF NOT EXISTS avaliacao (
  thread TEXT, fonte TEXT,             -- 'humano' | 'juiz'
  criado_em TEXT, nota REAL, detalhe_json TEXT,
  PRIMARY KEY (thread, fonte));
CREATE INDEX IF NOT EXISTS ix_uso_dec ON precedente_uso(decisao_id);
"""


def db():
    os.makedirs(os.path.dirname(FB), exist_ok=True)
    c = sqlite3.connect(FB)
    c.executescript(ESQUEMA)
    return c


def registrar_consulta(thread, caso, estado, custo_total):
    c = db()
    with c:
        c.execute("INSERT OR REPLACE INTO consulta VALUES (?,?,?,?,?,?,?)",
                  (thread, dt.datetime.now().isoformat(timespec="seconds"), caso,
                   json.dumps(estado.get("prognostico") or {}, ensure_ascii=False),
                   estado.get("minuta") or "", custo_total,
                   json.dumps([x.get("modelo") for x in (estado.get("custos") or [])])))
        # a sustentacao (--tese) entra junto: para "ja' usei esse processo?" o
        # que conta e' ter chegado ao redator, nao por qual das duas buscas
        for p in ((estado.get("precedentes") or [])
                  + (estado.get("sustentacao") or [])):
            c.execute("INSERT OR IGNORE INTO precedente_uso VALUES (?,?,?,?,NULL)",
                      (thread, p["id"], p["numero"], p.get("nota")))
    c.close()


def registrar_avaliacao(thread, fonte, nota, detalhe):
    c = db()
    with c:
        c.execute("INSERT OR REPLACE INTO avaliacao VALUES (?,?,?,?,?)",
                  (thread, fonte, dt.datetime.now().isoformat(timespec="seconds"),
                   nota, json.dumps(detalhe, ensure_ascii=False)))
    c.close()


def marcar_precedentes(thread, uteis=(), inuteis=(), limpar=()):
    """`limpar` desfaz um veredito. A CLI so' marca, mas a interface web tem
    controle de tres estados (útil / inútil / sem opinião) e precisa voltar ao
    terceiro — sem isso um clique errado fica no boost para sempre."""
    c = db()
    with c:
        for ids, v in ((uteis, "util"), (inuteis, "inutil"), (limpar, None)):
            for i in ids:
                c.execute("UPDATE precedente_uso SET veredito=? WHERE thread=? "
                          "AND decisao_id=?", (v, thread, int(i)))
    c.close()


def boost():
    """{decisao_id: fator multiplicativo}, só para os que já receberam veredito."""
    if not os.path.exists(FB):
        return {}
    c = db()
    linhas = c.execute(
        "SELECT decisao_id, sum(veredito='util') - sum(veredito='inutil') "
        "FROM precedente_uso WHERE veredito IS NOT NULL GROUP BY 1").fetchall()
    c.close()
    return {i: 1.0 + max(-TETO, min(TETO, saldo * POR_VOTO)) for i, saldo in linhas}


def historico(termo=None, n=20):
    """O que voce ja' usou: consultas passadas e os processos que entraram nelas.

    `termo` casa com o numero do processo, com o texto do caso ou com o id da
    consulta — e' a mesma pergunta feita de tres jeitos ("ja' usei aquele
    acordao?", "ja' consultei esse tema?", "o que rodou naquele dia?").
    """
    if not os.path.exists(FB):
        return {"consultas": [], "precedentes": []}
    like = "%%%s%%" % termo if termo else None
    c = db()
    consultas = c.execute(
        "SELECT thread, criado_em, substr(replace(caso,char(10),' '),1,70), custo_usd "
        "FROM consulta WHERE ?1 IS NULL OR caso LIKE ?1 OR thread LIKE ?1 "
        "ORDER BY criado_em DESC LIMIT ?2", (like, n)).fetchall()
    precedentes = c.execute(
        "SELECT p.numero, p.decisao_id, count(*), max(c.criado_em), "
        "       sum(p.veredito='util'), sum(p.veredito='inutil') "
        "FROM precedente_uso p JOIN consulta c USING (thread) "
        "WHERE ?1 IS NULL OR p.numero LIKE ?1 OR c.caso LIKE ?1 "
        "GROUP BY p.decisao_id ORDER BY count(*) DESC, max(c.criado_em) DESC "
        "LIMIT ?2", (like, n)).fetchall()
    c.close()
    return {"consultas": consultas, "precedentes": precedentes}


def imprimir_historico(termo=None, n=20):
    h = historico(termo, n)
    alvo = " contendo '%s'" % termo if termo else ""
    print("\nConsultas%s (%d):" % (alvo, len(h["consultas"])))
    print("%-22s %-17s %8s  %s" % ("thread", "quando", "US$", "caso"))
    for t, q, caso, u in h["consultas"]:
        print("%-22s %-17s %8.4f  %s" % (t, q[:16], u or 0, (caso or "").strip()))
    print("\nProcessos já usados como precedente%s (%d):" % (alvo, len(h["precedentes"])))
    print("%-28s %-8s %6s %-12s %s" % ("processo", "id", "vezes", "última", "veredito"))
    for num, i, vezes, quando, ut, inu in h["precedentes"]:
        v = "útil x%d" % ut if ut else ""
        v += (" / " if v and inu else "") + ("inútil x%d" % inu if inu else "")
        print("%-28s %-8d %6d %-12s %s" % (num[:28], i, vezes, quando[:10], v or "—"))
    if not h["consultas"] and not h["precedentes"]:
        print("(nada registrado ainda%s)" % alvo)
    return h


def concordancia():
    """O juiz automático concorda com você? Sem isso, o bench não vale nada."""
    if not os.path.exists(FB):
        return None
    c = db()
    pares = c.execute(
        "SELECT h.thread, h.nota, j.nota FROM avaliacao h JOIN avaliacao j "
        "USING (thread) WHERE h.fonte='humano' AND j.fonte='juiz'").fetchall()
    c.close()
    if len(pares) < 2:
        return {"n": len(pares)}
    hs = [p[1] for p in pares]
    js = [p[2] for p in pares]
    mh, mj = sum(hs) / len(hs), sum(js) / len(js)
    cov = sum((a - mh) * (b - mj) for a, b in zip(hs, js))
    vh = sum((a - mh) ** 2 for a in hs) ** .5
    vj = sum((b - mj) ** 2 for b in js) ** .5
    return {"n": len(pares), "media_humano": round(mh, 2), "media_juiz": round(mj, 2),
            "erro_medio": round(sum(abs(a - b) for a, b in zip(hs, js)) / len(hs), 2),
            "correlacao": round(cov / (vh * vj), 3) if vh and vj else None}


# ----------------------------------------------------------------------- CLI

def _listar(c, n=10):
    return c.execute(
        "SELECT c.thread, c.criado_em, c.custo_usd, "
        "  (SELECT nota FROM avaliacao WHERE thread=c.thread AND fonte='humano'), "
        "  (SELECT nota FROM avaliacao WHERE thread=c.thread AND fonte='juiz') "
        "FROM consulta c ORDER BY c.criado_em DESC LIMIT ?", (n,)).fetchall()


def main(argv=None):
    ap = argparse.ArgumentParser(description="Qualificar consultas do segundo cérebro")
    ap.add_argument("--thread", help="consulta a qualificar (padrão: a última)")
    ap.add_argument("--nota", type=float, help="0 a 5")
    ap.add_argument("--comentario", default="")
    ap.add_argument("--util", type=int, nargs="*", default=[],
                    help="ids de precedentes que serviram")
    ap.add_argument("--inutil", type=int, nargs="*", default=[],
                    help="ids de precedentes que não serviram")
    ap.add_argument("--relatorio", action="store_true",
                    help="mostra a concordância entre você e o juiz automático")
    ap.add_argument("--historico", nargs="?", const="", default=None,
                    metavar="TERMO",
                    help="processos e consultas que você já usou (filtra por termo)")
    a = ap.parse_args(argv)

    if a.historico is not None:
        imprimir_historico(a.historico or None)
        return 0

    c = db()
    if a.relatorio:
        print("\nÚltimas consultas:")
        print("%-22s %-20s %8s %7s %7s" % ("thread", "quando", "US$", "você", "juiz"))
        for t, q, u, nh, nj in _listar(c, 20):
            print("%-22s %-20s %8.4f %7s %7s"
                  % (t, q[:19], u or 0, "-" if nh is None else "%.1f" % nh,
                     "-" if nj is None else "%.1f" % nj))
        conc = concordancia()
        print("\nConcordância juiz x humano:", json.dumps(conc, ensure_ascii=False))
        if conc and conc.get("n", 0) < 8:
            print("  (com menos de ~8 pares avaliados isso ainda não significa nada)")
        b = boost()
        if b:
            print("\n%d precedentes com ajuste por feedback "
                  "(fator entre %.2f e %.2f)" % (len(b), min(b.values()), max(b.values())))
        c.close()
        return 0

    thread = a.thread
    if not thread:
        r = _listar(c, 1)
        if not r:
            print("Nenhuma consulta registrada ainda. Rode consultar.bat primeiro.")
            return 2
        thread = r[0][0]

    linha = c.execute("SELECT prognostico_json FROM consulta WHERE thread=?",
                      (thread,)).fetchone()
    if not linha:
        print("Consulta '%s' não encontrada." % thread, file=sys.stderr)
        return 2

    if a.nota is None:
        print("\nConsulta: %s" % thread)
        print("Precedentes usados:")
        for i, num, nt, v in c.execute(
                "SELECT decisao_id, numero, nota_triagem, veredito "
                "FROM precedente_uso WHERE thread=? ORDER BY nota_triagem DESC",
                (thread,)):
            print("  id %-7d %-28s analogia %s  %s" % (i, num, nt, v or ""))
        print("\nNota de 0 a 5 para esta resposta: ", end="", flush=True)
        try:
            a.nota = float(input().strip())
        except (ValueError, EOFError):
            print("Nota inválida.", file=sys.stderr)
            return 2
        print("Comentário (enter para pular): ", end="", flush=True)
        a.comentario = input().strip()
        print("ids dos precedentes que NÃO serviram (separados por espaço, "
              "enter para nenhum): ", end="", flush=True)
        a.inutil = [int(x) for x in input().split() if x.strip().isdigit()]
    c.close()

    registrar_avaliacao(thread, "humano", a.nota, {"comentario": a.comentario})
    marcar_precedentes(thread, a.util, a.inutil)
    print("\nRegistrado: nota %.1f em '%s'." % (a.nota, thread))
    if a.inutil:
        print("%d precedentes marcados como inúteis — vão perder posição nas "
              "próximas buscas." % len(a.inutil))
    conc = concordancia()
    if conc and conc.get("n", 0) >= 2:
        print("Concordância com o juiz automático:", json.dumps(conc, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        sys.exit(main())
    # self-check: usa um banco temporario, nao encosta no de verdade
    import tempfile
    FB = os.path.join(tempfile.mkdtemp(), "fb.db")
    registrar_consulta("t1", "caso", {
        "prognostico": {"resultado_provavel": "desprovido"}, "minuta": "m",
        "precedentes": [{"id": 10, "numero": "A", "nota": 5},
                        {"id": 11, "numero": "B", "nota": 4}],
        "custos": [{"modelo": "x/y"}]}, 0.2)
    assert boost() == {}, "sem veredito nao pode haver ajuste"
    marcar_precedentes("t1", uteis=[10], inuteis=[11])
    b = boost()
    assert b[10] > 1.0 > b[11], b
    # limpar devolve ao estado 'sem opiniao' — o clique errado nao pode ficar
    # empurrando o ranking para sempre
    marcar_precedentes("t1", limpar=[10, 11])
    assert boost() == {}, boost()
    marcar_precedentes("t1", uteis=[10], inuteis=[11])
    # o teto tem que segurar mesmo com muitos votos
    for t in range(20):
        registrar_consulta("t%d" % t, "c", {"precedentes": [{"id": 11, "numero": "B",
                                                             "nota": 3}]}, 0)
        marcar_precedentes("t%d" % t, inuteis=[11])
    assert abs(boost()[11] - (1.0 - TETO)) < 1e-9, boost()[11]

    registrar_avaliacao("t1", "humano", 4.0, {})
    registrar_avaliacao("t1", "juiz", 3.5, {})
    registrar_avaliacao("t2", "humano", 2.0, {})
    registrar_avaliacao("t2", "juiz", 2.5, {})
    conc = concordancia()
    assert conc["n"] == 2 and conc["correlacao"] == 1.0, conc
    assert conc["erro_medio"] == 0.5, conc

    # historico: acha pelo numero do processo e conta reuso
    h = historico("A")
    assert [p[0] for p in h["precedentes"]] == ["A"], h["precedentes"]
    assert h["precedentes"][0][2] == 1 and h["precedentes"][0][4] == 1  # 1 uso, util
    # t0..t19 sao 20 threads (o t1 do inicio foi sobrescrito pelo do laco)
    assert historico("B")["precedentes"][0][2] == 20, historico("B")["precedentes"]
    assert historico("nao-existe") == {"consultas": [], "precedentes": []}
    assert len(historico()["precedentes"]) == 2, "sem termo, lista tudo"
    print("self-check OK")
