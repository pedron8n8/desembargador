"""A API. So' transporte: toda conta vem de src/rag/.

    python -m uvicorn api.app:app --port 8000
    web.bat                                    (sobe isto + o vite)

Em dev o Vite (5173) faz proxy de /api para ca'. Same-origin, entao nao ha' CORS
nem cookie cross-site para configurar. Em producao o `frontend/dist` e' servido daqui
mesmo: um processo, uma porta, um certificado.
"""
import base64
import binascii
import contextlib
import datetime as dt
import json
import os
import re
import sqlite3

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from src import cerebros
from src.rag import (busca, calibrar, cli, conversa, deriva, estatisticas,
                     extrair, feedback, floresta, grafo, rede, rerank)
from src.rag.llm import config

from . import apresentacao, auth, esquema, execucao, serial

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(RAIZ, "frontend", "dist")

DEV = os.environ.get("WEB_DEV") == "1"
COOKIE = "sessao"
# Cabecalho obrigatorio em todo metodo mutante. Com SameSite=Lax e SPA
# same-origin isto ja' fecha CSRF: um <form> de outro site nao consegue mandar
# cabecalho customizado, e um fetch cross-origin esbarra no preflight.
CSRF = "x-requerido-por"


@contextlib.asynccontextmanager
async def lifespan(_app):
    esquema.db().close()
    # RAG fora da lista de proposito: ninguem escreve no rag.db em execucao
    # (busca, sinais e floresta abrem com mode=ro), entao WAL ali nao resolve
    # lock nenhum — so' abria o arquivo de 70 MB em modo escrita a cada boot.
    ligados = esquema.wal(execucao.RUNS, feedback.FB, esquema.WEB)
    # flush: sob uvicorn o stdout é bloco-bufferizado, e log de startup que
    # aparece só quando o buffer enche não é log de startup
    print("WAL: %s" % ", ".join("%s=%s" % x for x in ligados), flush=True)
    execucao.instalar_roteador()
    # Os dois tem cache POR CAMINHO: aquecer aqui tira 40 MB do caminho critico
    # da primeira consulta. So' o cerebro PADRAO — cada floresta sao ~40 MB, e
    # pre-aquecer cinco cerebros deixaria 200 MB residentes para nada.
    _cam_padrao = cerebros.caminhos()
    floresta.carregar(_cam_padrao["floresta"])
    calibrar.carregar(_cam_padrao["calibrador"])
    pendentes = execucao.reconciliar()
    if pendentes:
        print("reconciliadas %d execuções interrompidas: %s"
              % (len(pendentes), ", ".join("%s=%s" % x for x in pendentes)))
    yield


app = FastAPI(title="Segundo Cérebro — TJSC", lifespan=lifespan, docs_url=None,
              redoc_url=None, openapi_url=None)

# A apresentacao comercial e' a UNICA rota que nao exige conta: quem recebe o
# link nao tem cadastro. Ela traz a propria senha e o proprio cookie, e nenhuma
# rota abaixo aceita esse cookie. Entra aqui, antes de tudo, porque o mount da
# SPA no fim do arquivo e' catch-all.
app.include_router(apresentacao.router)


# ------------------------------------------------------------------ auth

def conexao():
    c = esquema.db()
    try:
        yield c
    finally:
        c.close()


def atual(request: Request, c=Depends(conexao)):
    u = auth.usuario_da_sessao(c, request.cookies.get(COOKIE))
    if u is None:
        raise HTTPException(401, "sessão inválida ou expirada")
    if request.method not in ("GET", "HEAD", "OPTIONS") \
            and request.headers.get(CSRF) != "web":
        raise HTTPException(403, "cabeçalho %s ausente" % CSRF)
    return u


def manda(u):
    """Vê o que é dos outros: consultas alheias, custos globais, contas.

    O superadmin PRECISA entrar aqui. Sem isto ele teria mais poder sobre os
    cérebros e menos sobre o escritório que o próprio admin — e as sete
    comparações espalhadas com "admin" eram fáceis de deixar pela metade.
    """
    return u["papel"] in ("admin", "superadmin")


def admin(u=Depends(atual)):
    if not manda(u):
        raise HTTPException(403, "só para administrador")
    return u


def superadmin(u=Depends(atual)):
    """Manda nos CÉREBROS: quem pode julgar, e quem aparece no seletor.

    Poder separado do admin de propósito: administrar as contas do escritório
    não é a mesma coisa que decidir de quais desembargadores o escritório tem
    um segundo cérebro.
    """
    if u["papel"] != "superadmin":
        raise HTTPException(403, "só para o superadministrador")
    return u


def cerebro_atual(cerebro: str = Query(None)):
    """Sobre qual acervo esta rota responde. Sem `?cerebro=`, o padrão.

    Slug inválido é 404 e não silêncio: responder com o acervo errado é o único
    erro daqui que ninguém detecta olhando a tela.
    """
    try:
        return cerebros.caminhos(cerebro)
    except cerebros.Desconhecido as e:
        raise HTTPException(404, str(e))


@app.post("/api/sessao", status_code=204)
async def entrar(request: Request, c=Depends(conexao)):
    corpo = await request.json()
    email = (corpo.get("email") or "").strip().lower()
    ip = request.client.host if request.client else ""
    if auth.bloqueado(c, email, ip):
        raise HTTPException(429, "tentativas demais; espere %d minutos"
                            % auth.JANELA_MIN)
    u = auth.verificar_senha(c, email, corpo.get("senha") or "", ip=ip)
    if u is None:
        raise HTTPException(401, "email ou senha incorretos")
    token = auth.abrir_sessao(c, u["email"], ip=ip,
                              agente=request.headers.get("user-agent"))
    # o cookie tem de ir na resposta DEVOLVIDA: setá-lo num Response injetado e
    # devolver outro descarta o cabeçalho em silêncio
    r = Response(status_code=204)
    r.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=not DEV,
                 max_age=auth.VALIDADE_DIAS * 86400, path="/")
    return r


@app.delete("/api/sessao", status_code=204)
def sair(request: Request, c=Depends(conexao), _u=Depends(atual)):
    auth.fechar_sessao(c, request.cookies.get(COOKIE) or "")
    r = Response(status_code=204)
    r.delete_cookie(COOKIE, path="/")
    return r


@app.get("/api/eu")
def eu(u=Depends(atual), c=Depends(conexao)):
    return {"email": u["email"], "papel": u["papel"],
            "sessoes": [{"criado_em": s["criado_em"], "expira_em": s["expira_em"],
                         "ip": s["ip"], "agente": s["agente"]}
                        for s in auth.sessoes(c, u["email"])]}


# ------------------------------------------------------- config e grafo

@app.get("/api/saude")
def saude(cam=Depends(cerebro_atual)):
    return {"ok": True, "cerebro": cam["slug"], "bancos": {
        n: os.path.exists(p) for n, p in
        (("rag", cam["rag"]), ("tjsc", cam["tjsc"]), ("runs", execucao.RUNS),
         ("feedback", feedback.FB), ("web", esquema.WEB))}}


# ------------------------------------------------------------- cérebros

@app.get("/api/cerebros")
def listar_cerebros(u=Depends(atual), todos: bool = Query(False)):
    """Quem pode julgar. Todo mundo vê os ativos; só o superadmin vê os inativos.

    Um cérebro sem coleta responderia com zero precedente e pareceria defeito do
    sistema — por isso ele nasce inativo e alguém tem de ligá-lo de propósito.
    """
    if todos and u["papel"] != "superadmin":
        raise HTTPException(403, "só o superadministrador vê os cérebros inativos")
    saida = []
    for c in cerebros.listar(incluir_inativos=todos):
        s = cerebros.saude(c["slug"])
        saida.append({
            "slug": c["slug"], "nome": c["nome"], "titulo": c["titulo"],
            "tribunal": c["tribunal"], "ativo": bool(c["ativo"]),
            "n_decisoes": s["n_decisoes"], "n_merito": s["n_merito"],
            "tem_indice": s["tem_rag"], "tem_floresta": s["tem_floresta"],
            "calibrado": s["tem_calibrador"],
            # o front usa isto para avisar que o percentual não vale, em vez de
            # mostrar um número que ninguém mediu
            "crava": s["n_merito"] >= grafo.MIN_MERITO_PARA_CRAVAR,
        })
    return {"padrao": cerebros.padrao(), "minimo_para_cravar":
            grafo.MIN_MERITO_PARA_CRAVAR, "itens": saida}


@app.patch("/api/cerebros/{slug}")
async def ativar_cerebro(slug: str, request: Request, _s=Depends(superadmin)):
    corpo = await request.json()
    if "ativo" not in corpo:
        raise HTTPException(400, "informe 'ativo'")
    ativo = bool(corpo["ativo"])
    try:
        cerebros.obter(slug)          # valida ANTES de olhar o disco
        if ativo and not cerebros.saude(slug)["tem_rag"]:
            raise HTTPException(409, "esse cérebro ainda não tem índice — rode a "
                                     "coleta e o indexar antes de ativá-lo")
        c = cerebros.ativar(slug, ativo)
    except cerebros.Desconhecido as e:
        raise HTTPException(404, str(e))
    return {"slug": c["slug"], "nome": c["nome"], "ativo": bool(c["ativo"])}


@app.get("/api/config")
def configuracao(_u=Depends(atual), cam=Depends(cerebro_atual)):
    """O que está CARREGADO no processo, não o que está no arquivo.

    llm.config() cacheia num global: mexer no config_rag.json com o servidor de
    pé não muda nada até reiniciar. A interface tem de mostrar o que está
    valendo, senão vira um painel que mente com boa intenção.

    Os modelos são do sistema; a floresta e o calibrador são do CÉREBRO — daí o
    `?cerebro=`. Sem ele o painel mostraria a calibração de um acervo enquanto a
    consulta roda em outro.
    """
    cfg = config()
    rf = floresta.carregar(cam["floresta"])
    return {
        "cerebro": cam["slug"], "cerebro_nome": cam["nome"],
        "modelos": cfg.get("modelos", {}),
        "temperatura": cfg.get("temperatura", {}),
        "max_tokens": cfg.get("max_tokens", {}),
        "busca": cfg.get("busca", {}),
        "rerank": rerank._cfg(),
        "floresta": {
            "peso_knn": cfg.get("floresta", {}).get("peso_knn"),
            "disponivel": rf is not None,
            "treinado_ate": rf.get("ano_corte") if rf else None,
            "n_treino": rf.get("n_treino") if rf else None,
        },
        "confianca": cfg.get("confianca", {}),
        "calibrado": calibrar.calibrado(cam["calibrador"]),
        "n_merito": cerebros.saude(cam["slug"])["n_merito"],
        "minimo_para_cravar": grafo.MIN_MERITO_PARA_CRAVAR,
        "julgar_consultas": cfg.get("julgar_consultas"),
        "peso_confianca": grafo.PESO_CONFIANCA,
        # o filtro deixou de ser por `resultado` e passou a ser semantico (a
        # triagem le' o merito e diz se o precedente sustenta o lado pedido),
        # entao aqui vai o rotulo, nao mais a lista de resultados
        "teses": dict({"neutra": "sem lado — a única com prognóstico"}, **grafo.LADOS),
    }


@app.get("/api/grafo")
def topologia(_u=Depends(atual)):
    """A topologia REAL, de get_graph() — não um desenho fixo no frontend."""
    g = grafo.construir().get_graph()
    return {
        "nos": [{"id": n} for n in g.nodes],
        "arestas": [{"de": e.source, "para": e.target,
                     "condicional": bool(e.conditional),
                     "rotulo": getattr(e, "data", None)}
                    for e in g.edges],
    }


# --------------------------------------------------------------- consultas

def _app_grafo(so_prognostico=False):
    return grafo.construir(checkpoint=execucao.RUNS, so_prognostico=so_prognostico)


def _estado(thread, so_prognostico=False):
    st = _app_grafo(so_prognostico).get_state(
        {"configurable": {"thread_id": thread}})
    return st.values or {}, st


def _dono_ou_403(c, thread, u):
    d = c.execute("SELECT email FROM dono WHERE thread=?", (thread,)).fetchone()
    if d is None:
        # thread da CLI: sem dono. So' o admin ve — a consulta pode ser de outro.
        if not manda(u):
            raise HTTPException(404, "consulta não encontrada")
    elif d["email"] != u["email"] and not manda(u):
        raise HTTPException(404, "consulta não encontrada")


@app.get("/api/consultas")
def listar(c=Depends(conexao), u=Depends(atual), pagina: int = 0,
           por_pagina: int = Query(25, le=100), cerebro: str = Query(None)):
    fb = sqlite3.connect("file:%s?mode=ro" % feedback.FB.replace("\\", "/"), uri=True)
    fb.row_factory = sqlite3.Row
    try:
        linhas = fb.execute(
            "SELECT c.thread, c.criado_em, c.custo_usd, c.prognostico_json, "
            "  substr(replace(c.caso,char(10),' '),1,160) AS resumo, "
            "  (SELECT nota FROM avaliacao WHERE thread=c.thread AND fonte='humano') nh,"
            "  (SELECT nota FROM avaliacao WHERE thread=c.thread AND fonte='juiz') nj "
            "FROM consulta c ORDER BY c.criado_em DESC").fetchall()
    finally:
        fb.close()

    meus = {r["thread"]: r["email"] for r in c.execute("SELECT thread, email FROM dono")}
    estados = {r["thread"]: r for r in c.execute(
        "SELECT thread, estado, erro, segundos, cerebro, comparacao FROM execucao")}
    # nome legivel sem uma consulta por linha
    nomes = {x["slug"]: x["nome"] for x in cerebros.listar(incluir_inativos=True)}

    saida = []
    for l in linhas:
        d = meus.get(l["thread"])
        if not manda(u) and d != u["email"]:
            continue
        try:
            p = json.loads(l["prognostico_json"] or "{}")
        except ValueError:
            p = {}
        e = estados.get(l["thread"])
        # o cerebro sai do prognostico gravado (consulta da CLI) ou da execucao
        slug = p.get("cerebro") or (e["cerebro"] if e else None)             or cerebros.CEREBRO_LEGADO
        if cerebro and slug != cerebro:
            continue
        saida.append({
            "thread": l["thread"], "criado_em": l["criado_em"],
            "resumo": (l["resumo"] or "").strip(),
            "custo_usd": l["custo_usd"], "nota_humano": l["nh"], "nota_juiz": l["nj"],
            "decide": p.get("decide"),
            "probabilidade_pct": p.get("probabilidade_pct"),
            "resultado_provavel": p.get("resultado_provavel"),
            "estado": e["estado"] if e else "pronto",
            "erro": e["erro"] if e else None,
            "da_cli": d is None,
            "cerebro": slug, "cerebro_nome": nomes.get(slug, slug),
            "comparacao": e["comparacao"] if e else None,
        })

    # Execuções que ainda não chegaram ao feedback.db. Normalmente são as que
    # estão rodando; uma 'pronto' aqui significa que cli.finalizar não completou
    # — anomalia que tem de aparecer na lista, não sumir dela.
    ja = {x["thread"] for x in saida}
    for r in c.execute("SELECT * FROM execucao ORDER BY criado_em DESC"):
        if r["thread"] in ja:
            continue
        if not manda(u) and r["email"] != u["email"]:
            continue
        slug = r["cerebro"] or cerebros.CEREBRO_LEGADO
        if cerebro and slug != cerebro:
            continue
        saida.append({"thread": r["thread"], "criado_em": r["criado_em"],
                      "resumo": "", "custo_usd": None, "nota_humano": None,
                      "nota_juiz": None, "decide": None, "probabilidade_pct": None,
                      "resultado_provavel": None, "estado": r["estado"],
                      "erro": r["erro"], "da_cli": False,
                      "cerebro": slug, "cerebro_nome": nomes.get(slug, slug),
                      "comparacao": r["comparacao"]})
    saida.sort(key=lambda x: x["criado_em"] or "", reverse=True)
    return {"total": len(saida),
            "itens": saida[pagina * por_pagina:(pagina + 1) * por_pagina]}


@app.post("/api/extrair")
async def extrair_arquivo(request: Request, _u=Depends(atual)):
    """Arquivo -> texto, para a caixa do lado de la'. O arquivo vem em base64
    dentro do JSON de sempre: multipart custaria a dependencia python-multipart
    e um segundo caminho no cliente, para transportar o mesmo byte."""
    corpo = await request.json()
    nome = (corpo.get("nome") or "arquivo")[:200]
    try:
        dados = base64.b64decode(corpo.get("dados") or "", validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "conteúdo do arquivo veio corrompido")
    if len(dados) > extrair.LIMITE_BYTES:
        raise HTTPException(413, "arquivo passa de %d MB"
                            % (extrair.LIMITE_BYTES // 1048576))
    try:
        texto, custo = extrair.extrair(nome, dados)
    except extrair.NaoSuportado as e:
        raise HTTPException(415, str(e))
    return {"texto": texto, "chars": len(texto), "custo_usd": custo}


# Um caso normal tem alguns milhares de caracteres; 120 mil e' uma peca enorme
# ja' com anexos colados. Acima disso nao e' consulta, e' fatura. O limite do
# Caddy (40 MB) existe para o upload em base64 do /api/extrair e nao protege
# isto — nem existe quando a API roda sem o proxy na frente.
MAX_CHARS_CASO = 120_000

# Teto de execucoes simultaneas por usuario. Com MAX_WORKERS=2, tres na fila
# ja' e' a vez de todo mundo comprometida.
MAX_VIVAS_POR_USUARIO = 3


def _pedido(corpo):
    """Valida o que é comum a uma consulta e a uma comparação."""
    caso = (corpo.get("caso") or "").strip()
    if not caso:
        raise HTTPException(400, "caso vazio")
    if len(caso) > MAX_CHARS_CASO:
        raise HTTPException(413, "caso longo demais: %d caracteres (máximo %d)"
                            % (len(caso), MAX_CHARS_CASO))
    tese = corpo.get("tese") or "neutra"
    if tese != "neutra" and tese not in grafo.LADOS:
        raise HTTPException(400, "tese inválida: %s" % tese)
    f = corpo.get("filtros") or {}
    return caso, tese, {"classe": f.get("classe") or None,
                        "ano_min": f.get("ano_min"), "ano_max": f.get("ano_max"),
                        "excluir": tuple(f.get("excluir") or ())}


def _origem(corpo):
    """De onde veio a consulta: {'eproc': '<20 digitos>', 'instancia': '1g'|'2g'}
    quando veio da extensao do eproc, None quando veio do site. Formato invalido
    e' 400: gravar lixo aqui viraria "veio do eproc, processo <lixo>" no site."""
    o = corpo.get("origem")
    if o is None:
        return None
    if (not isinstance(o, dict) or not isinstance(o.get("eproc"), str)
            or not re.fullmatch(r"[0-9]{20}", o["eproc"])
            or o.get("instancia") not in ("1g", "2g")):
        raise HTTPException(400, "origem inválida: use {eproc: 20 dígitos, "
                                 "instancia: '1g' ou '2g'}")
    return {"eproc": o["eproc"], "instancia": o["instancia"]}


def _novo_thread(c, sufixo=""):
    thread = dt.datetime.now().strftime("%Y%m%d-%H%M%S") + sufixo
    if c.execute("SELECT 1 FROM execucao WHERE thread=?", (thread,)).fetchone():
        thread += "-%s" % os.urandom(2).hex()
    return thread


def _cerebro_para_rodar(slug):
    """Só cérebro ATIVO e com índice pode receber consulta.

    Um inativo é um acervo que ainda não existe de fato: responderia com zero
    precedente e pareceria defeito do sistema, não recusa deliberada.
    """
    try:
        c = cerebros.obter(cerebros.resolver(slug))
    except cerebros.Desconhecido as e:
        raise HTTPException(404, str(e))
    if not c["ativo"]:
        raise HTTPException(409, "o cérebro %s está inativo" % c["nome"])
    if not cerebros.saude(c["slug"])["tem_rag"]:
        raise HTTPException(409, "o cérebro %s ainda não tem índice" % c["nome"])
    return c["slug"]


@app.post("/api/consultas", status_code=202)
async def rodar(request: Request, c=Depends(conexao), u=Depends(atual)):
    corpo = await request.json()
    caso, tese, filtros = _pedido(corpo)
    origem = _origem(corpo)
    if execucao.vivas_de(c, u["email"]) >= MAX_VIVAS_POR_USUARIO:
        raise HTTPException(429, "você já tem %d consultas na fila; espere uma "
                                 "terminar" % MAX_VIVAS_POR_USUARIO)
    cerebro = _cerebro_para_rodar(corpo.get("cerebro"))
    thread = _novo_thread(c)
    execucao.iniciar(thread, u["email"], caso, tese=tese, filtros=filtros,
                     so_prognostico=bool(corpo.get("so_prognostico")),
                     cerebro=cerebro, origem=origem)
    return {"thread": thread, "cerebro": cerebro}


# ------------------------------------------------------------ comparações

MAX_CEREBROS_POR_COMPARACAO = 3


@app.post("/api/comparacoes", status_code=202)
async def comparar(request: Request, c=Depends(conexao), u=Depends(atual)):
    """A mesma peça, lida por vários cérebros. Uma execução independente cada.

    São threads separadas ligadas por um id de grupo, e não um par simétrico:
    cada uma nasce com o `comparacao` já no INSERT, então o grupo é consistente
    mesmo se o processo morrer entre uma e outra. Retomada, custo e feedback
    continuam sendo por thread — nada no grafo muda.
    """
    corpo = await request.json()
    caso, tese, filtros = _pedido(corpo)
    pedidos = corpo.get("cerebros") or []
    if len(pedidos) < 2:
        raise HTTPException(400, "uma comparação precisa de pelo menos 2 cérebros")
    if len(pedidos) > MAX_CEREBROS_POR_COMPARACAO:
        raise HTTPException(400, "no máximo %d cérebros por comparação — cada um "
                                 "custa uma consulta inteira"
                            % MAX_CEREBROS_POR_COMPARACAO)
    slugs = [_cerebro_para_rodar(s) for s in pedidos]
    if len(set(slugs)) != len(slugs):
        raise HTTPException(400, "cérebro repetido na comparação")
    if execucao.vivas_de(c, u["email"]) + len(slugs) > MAX_VIVAS_POR_USUARIO:
        raise HTTPException(429, "você já tem consultas na fila; espere uma terminar")

    comparacao = "cmp-" + dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    threads = []
    for i, slug in enumerate(slugs):
        thread = _novo_thread(c, sufixo="-%d" % i)
        execucao.iniciar(thread, u["email"], caso, tese=tese, filtros=filtros,
                         so_prognostico=bool(corpo.get("so_prognostico")),
                         cerebro=slug, comparacao=comparacao)
        threads.append({"cerebro": slug, "thread": thread})
    return {"comparacao": comparacao, "threads": threads}


@app.get("/api/comparacoes")
def listar_comparacoes(c=Depends(conexao), u=Depends(atual)):
    onde, args = ["comparacao IS NOT NULL"], []
    if not manda(u):
        onde.append("email = ?")
        args.append(u["email"])
    linhas = c.execute("SELECT comparacao, thread, cerebro, estado, criado_em "
                       "FROM execucao WHERE %s ORDER BY criado_em DESC"
                       % " AND ".join(onde), args).fetchall()
    if not linhas:
        return {"itens": []}

    # o resumo do caso e o prognostico de cada lado saem do feedback.db, do
    # mesmo jeito que em /api/consultas — sem abrir checkpoint nenhum: uma
    # LISTA nao pode pagar a leitura do LangGraph por linha
    fb = sqlite3.connect("file:%s?mode=ro" % feedback.FB.replace("\\", "/"), uri=True)
    fb.row_factory = sqlite3.Row
    try:
        pronto = {r["thread"]: r for r in fb.execute(
            "SELECT thread, custo_usd, prognostico_json, "
            "  substr(replace(caso,char(10),' '),1,160) AS resumo "
            "FROM consulta WHERE thread IN (%s)" % ",".join("?" * len(linhas)),
            [r["thread"] for r in linhas])}
    finally:
        fb.close()

    nomes = {x["slug"]: x["nome"] for x in cerebros.listar(incluir_inativos=True)}
    grupos = {}
    for r in linhas:
        g = grupos.setdefault(r["comparacao"], {
            "comparacao": r["comparacao"], "criado_em": r["criado_em"],
            "cerebros": [], "estados": [], "resumo": "", "custo_usd": 0.0,
            "_itens": []})
        slug = r["cerebro"] or cerebros.CEREBRO_LEGADO
        g["cerebros"].append(nomes.get(slug, slug))
        g["estados"].append(r["estado"])
        f = pronto.get(r["thread"])
        if f is None:
            # ainda rodando (ou morreu antes de fechar a conta): sem resumo.
            # As chaves vao mesmo assim — _comparavel lê `probabilidade_pct` de
            # todos ANTES de olhar o estado
            g["_itens"].append({"estado": r["estado"], "decide": None,
                                "calibrado": None, "probabilidade_pct": None})
            continue
        g["custo_usd"] += f["custo_usd"] or 0.0
        g["resumo"] = g["resumo"] or (f["resumo"] or "").strip()
        try:
            p = json.loads(f["prognostico_json"] or "{}")
        except ValueError:
            p = {}
        g["_itens"].append({"estado": r["estado"], "decide": p.get("decide"),
                            "calibrado": p.get("calibrado"),
                            "probabilidade_pct": p.get("probabilidade_pct")})
    # o Δ obedece a mesma regra da tela da comparacao — quem decide se dois
    # percentuais podem ser subtraidos e' o servidor, num lugar so'
    return {"itens": [{**{k: v for k, v in g.items() if k != "_itens"},
                       **_comparavel(g["_itens"])} for g in grupos.values()]}


@app.get("/api/comparacoes/{comparacao}")
def ver_comparacao(comparacao: str, c=Depends(conexao), u=Depends(atual)):
    linhas = c.execute("SELECT * FROM execucao WHERE comparacao=? "
                       "ORDER BY thread", (comparacao,)).fetchall()
    if not linhas:
        raise HTTPException(404, "comparação não encontrada")
    for r in linhas:
        _dono_ou_403(c, r["thread"], u)

    nomes = {x["slug"]: x for x in cerebros.listar(incluir_inativos=True)}
    # o resumo dos que já terminaram sai do feedback.db; só quem ainda roda
    # obriga a abrir o checkpoint do LangGraph
    fb = sqlite3.connect("file:%s?mode=ro" % feedback.FB.replace("\\", "/"), uri=True)
    fb.row_factory = sqlite3.Row
    try:
        prontos = {r["thread"]: r for r in fb.execute(
            "SELECT thread, prognostico_json, custo_usd, minuta FROM consulta "
            "WHERE thread IN (%s)" % ",".join("?" * len(linhas)),
            [r["thread"] for r in linhas])}
    finally:
        fb.close()

    itens, caso = [], ""
    for r in linhas:
        slug = r["cerebro"] or cerebros.CEREBRO_LEGADO
        info = nomes.get(slug, {})
        fila = prontos.get(r["thread"])
        prog, custo, tem_minuta = {}, None, False
        if fila is not None:
            try:
                prog = json.loads(fila["prognostico_json"] or "{}")
            except ValueError:
                prog = {}
            custo, tem_minuta = fila["custo_usd"], bool(fila["minuta"])
        else:
            estado, _ = _estado(r["thread"], bool(r["so_prognostico"]))
            prog = estado.get("prognostico") or {}
            tem_minuta = bool(estado.get("minuta"))
            caso = caso or (estado.get("caso") or "")
        itens.append({
            "thread": r["thread"], "cerebro": slug,
            "cerebro_nome": info.get("nome", slug),
            "cerebro_titulo": info.get("titulo", ""),
            "estado": r["estado"], "erro": r["erro"], "segundos": r["segundos"],
            "so_prognostico": bool(r["so_prognostico"]),
            "custo_usd": custo, "tem_minuta": tem_minuta,
            "prognostico": prog,
            "n_precedentes": prog.get("n_precedentes"),
            # o front usa os dois para decidir se pode mostrar um Δ
            "decide": prog.get("decide"),
            "calibrado": prog.get("calibrado"),
            "probabilidade_pct": prog.get("probabilidade_pct"),
            "resultado_provavel": prog.get("resultado_provavel"),
        })
    if not caso:
        estado, _ = _estado(linhas[0]["thread"], bool(linhas[0]["so_prognostico"]))
        caso = estado.get("caso") or ""
    return {"comparacao": comparacao, "caso": caso,
            "criado_em": linhas[0]["criado_em"], "itens": itens,
            **_comparavel(itens)}


def _comparavel(itens):
    """Pode-se subtrair um percentual do outro?

    NÃO quando algum lado se recusou a cravar, e NÃO quando um é calibrado e o
    outro não: 62% calibrado ao lado de 62% cru são números de escalas
    diferentes, e a subtração fabricaria precisão que ninguém mediu. É o erro
    mais fácil de cometer nesta tela, por isso a resposta vem do servidor.
    """
    pcts = [i["probabilidade_pct"] for i in itens]
    if any(i["estado"] != "pronto" for i in itens):
        return {"delta_pp": None, "por_que_sem_delta": "ainda rodando"}
    if any(i["decide"] is False for i in itens):
        return {"delta_pp": None,
                "por_que_sem_delta": "um dos cérebros não cravou um prognóstico"}
    if any(p is None for p in pcts):
        return {"delta_pp": None, "por_que_sem_delta": "algum lado não tem percentual"}
    if len({bool(i["calibrado"]) for i in itens}) > 1:
        return {"delta_pp": None,
                "por_que_sem_delta": "um lado é calibrado e o outro não — as duas "
                                     "escalas não se comparam"}
    return {"delta_pp": round(max(pcts) - min(pcts), 1), "por_que_sem_delta": None}


@app.post("/api/consultas/{thread}/retomar", status_code=202)
def retomar(thread: str, c=Depends(conexao), u=Depends(atual)):
    _dono_ou_403(c, thread, u)
    r = c.execute("SELECT * FROM execucao WHERE thread=?", (thread,)).fetchone()
    if r is None:
        raise HTTPException(404, "sem execução registrada")
    if r["estado"] in ("fila", "rodando"):
        raise HTTPException(409, "essa consulta já está rodando")
    if execucao.vivas_de(c, u["email"]) >= MAX_VIVAS_POR_USUARIO:
        raise HTTPException(429, "você já tem %d consultas na fila; espere uma "
                                 "terminar" % MAX_VIVAS_POR_USUARIO)
    execucao.retomar(thread, so_prognostico=bool(r["so_prognostico"]))
    return {"thread": thread}


@app.get("/api/consultas/{thread}")
def detalhe(thread: str, c=Depends(conexao), u=Depends(atual)):
    _dono_ou_403(c, thread, u)
    r = c.execute("SELECT * FROM execucao WHERE thread=?", (thread,)).fetchone()
    estado, st = _estado(thread, bool(r["so_prognostico"]) if r else False)
    if not estado:
        raise HTTPException(404, "consulta sem checkpoint")
    md = os.path.join(cli.SAIDA, re.sub(r"[^\w-]", "", thread) + ".md")
    texto = None
    if os.path.exists(md):
        with open(md, encoding="utf-8") as f:
            texto = f.read()
    d = serial.consulta(thread, estado,
                        segundos=r["segundos"] if r else None, markdown=texto)
    d["estado"] = r["estado"] if r else "pronto"
    d["erro"] = r["erro"] if r else None
    d["origem"] = ({"eproc": r["origem_eproc"], "instancia": r["origem_instancia"]}
                   if r and r["origem_eproc"] else None)
    d["proximo_no"] = st.next[0] if st.next else None
    return d


@app.get("/api/consultas/{thread}/markdown", response_class=PlainTextResponse)
def markdown(thread: str, c=Depends(conexao), u=Depends(atual)):
    _dono_ou_403(c, thread, u)
    caminho = os.path.join(cli.SAIDA, re.sub(r"[^\w-]", "", thread) + ".md")
    if not os.path.exists(caminho):
        estado, _ = _estado(thread)
        if not estado:
            raise HTTPException(404, "consulta não encontrada")
        texto, _ = cli.formatar(estado, 0.0)
        return texto
    with open(caminho, encoding="utf-8") as f:
        return f.read()


@app.get("/api/consultas/{thread}/eventos")
def eventos(thread: str, request: Request, c=Depends(conexao), u=Depends(atual)):
    _dono_ou_403(c, thread, u)
    desde = int(request.headers.get("last-event-id") or
                request.query_params.get("desde") or 0)

    def fluxo():
        # Abre a conexão na hora. Sem isto, uma thread sem evento gravado só
        # manda o primeiro byte no heartbeat de 15s, e o cliente (ou o proxy)
        # fica sem saber se a conexão vingou.
        yield ": conectado\n\n"
        for ev in execucao.assinar(thread, desde=desde):
            if ev is None:
                yield ": ping\n\n"          # mantem proxy e navegador acordados
                continue
            yield "id: %d\nevent: %s\ndata: %s\n\n" % (
                ev["seq"], ev["tipo"],
                json.dumps(ev["payload"], ensure_ascii=False, default=str))

    return StreamingResponse(fluxo(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
        "Connection": "keep-alive"})


@app.get("/api/consultas/{thread}/pesos")
def pesos(thread: str, c=Depends(conexao), u=Depends(atual)):
    _dono_ou_403(c, thread, u)
    estado, _ = _estado(thread)
    if not estado:
        raise HTTPException(404, "consulta não encontrada")
    return serial.pesos(estado)


@app.get("/api/consultas/{thread}/rede")
def rede_da_consulta(thread: str, c=Depends(conexao), u=Depends(atual),
                     limiar: float = 0.12, max_por_no: int = 4):
    _dono_ou_403(c, thread, u)
    estado, _ = _estado(thread)
    if not estado:
        raise HTTPException(404, "consulta não encontrada")
    prec = {p["id"] for p in (estado.get("precedentes") or [])}
    # No modo tese nao ha' mais duas listas: os precedentes SAO a sustentacao —
    # o que existe a mais e' o veredito por candidato ('lado'), que diz quem a
    # triagem descartou por decidir contra. E' isso que a rede mostra.
    cands = [dict(x, _precedente=x.get("id") in prec, _lado=x.get("lado") or "")
             for x in (estado.get("candidatos") or [])]
    # os precedentes escolhidos podem ter vindo do 1o ciclo e nao estar mais em
    # `candidatos`; sem isto o grafo esconderia justamente o que foi usado
    vistos = {x["id"] for x in cands}
    for p in estado.get("precedentes") or []:
        if p["id"] not in vistos:
            cands.append(dict(p, _precedente=True, _lado=p.get("lado") or ""))
            vistos.add(p["id"])
    return rede.montar(cands, limiar=limiar, max_por_no=max_por_no)


# ------------------------------------------------------------------ chat

@app.get("/api/consultas/{thread}/mensagens")
def ler_mensagens(thread: str, c=Depends(conexao), u=Depends(atual)):
    _dono_ou_403(c, thread, u)
    return {"itens": [dict(r) for r in c.execute(
        "SELECT id, papel, texto, modelo, custo_usd, criado_em FROM mensagem "
        "WHERE thread=? ORDER BY id", (thread,))]}


@app.post("/api/consultas/{thread}/mensagens")
async def falar(thread: str, request: Request, c=Depends(conexao), u=Depends(atual)):
    _dono_ou_403(c, thread, u)
    corpo = await request.json()
    texto = (corpo.get("texto") or "").strip()
    if not texto:
        raise HTTPException(400, "mensagem vazia")
    estado, _ = _estado(thread)
    if not estado:
        raise HTTPException(404, "consulta não encontrada")
    if not estado.get("prognostico"):
        raise HTTPException(409, "a consulta ainda não terminou de rodar")

    historico = [dict(r) for r in c.execute(
        "SELECT papel, texto FROM mensagem WHERE thread=? ORDER BY id", (thread,))]
    agora = dt.datetime.now().isoformat(timespec="seconds")
    try:
        resposta, custo = conversa.responder(estado, texto, historico)
    except Exception as e:                                    # noqa: BLE001
        raise HTTPException(502, "o modelo não respondeu: %s" % e)
    with c:
        c.execute("INSERT INTO mensagem (thread,papel,texto,modelo,custo_usd,criado_em)"
                  " VALUES (?,'usuario',?,NULL,NULL,?)", (thread, texto, agora))
        c.execute("INSERT INTO mensagem (thread,papel,texto,modelo,custo_usd,criado_em)"
                  " VALUES (?,'assistente',?,?,?,?)",
                  (thread, resposta, custo["modelo"], custo["custo_usd"],
                   dt.datetime.now().isoformat(timespec="seconds")))
        c.execute("INSERT INTO custo (thread, no, modelo, tokens_in, tokens_out, "
                  "custo_usd, quando) VALUES (?,?,?,?,?,?,?)",
                  (thread, "conversa", custo["modelo"], custo["tokens_in"],
                   custo["tokens_out"], custo["custo_usd"], agora))
    return {"texto": resposta, "modelo": custo["modelo"],
            "custo_usd": custo["custo_usd"], "tokens_in": custo["tokens_in"],
            "tokens_out": custo["tokens_out"]}


# ------------------------------------------------------------- avaliação

@app.post("/api/consultas/{thread}/avaliacao")
async def avaliar_consulta(thread: str, request: Request, c=Depends(conexao),
                           u=Depends(atual)):
    _dono_ou_403(c, thread, u)
    corpo = await request.json()
    nota = corpo.get("nota")
    if nota is None or not 0 <= float(nota) <= 5:
        raise HTTPException(400, "nota tem de estar entre 0 e 5")
    feedback.registrar_avaliacao(thread, "humano", float(nota),
                                 {"comentario": corpo.get("comentario") or "",
                                  "por": u["email"]})
    return {"ok": True, "concordancia": feedback.concordancia()}


@app.post("/api/consultas/{thread}/precedentes/{decisao_id}/veredito")
async def veredito(thread: str, decisao_id: int, request: Request,
                   c=Depends(conexao), u=Depends(atual)):
    _dono_ou_403(c, thread, u)
    corpo = await request.json()
    v = corpo.get("veredito")
    if v not in ("util", "inutil", None):
        raise HTTPException(400, "veredito tem de ser 'util', 'inutil' ou null")
    feedback.marcar_precedentes(
        thread, uteis=[decisao_id] if v == "util" else (),
        inuteis=[decisao_id] if v == "inutil" else (),
        limpar=[decisao_id] if v is None else ())
    return {"ok": True, "boost": feedback.boost().get(decisao_id)}


@app.get("/api/consultas/{thread}/avaliacao")
def ler_avaliacao(thread: str, c=Depends(conexao), u=Depends(atual)):
    _dono_ou_403(c, thread, u)
    fb = sqlite3.connect("file:%s?mode=ro" % feedback.FB.replace("\\", "/"), uri=True)
    fb.row_factory = sqlite3.Row
    try:
        notas = {r["fonte"]: {"nota": r["nota"],
                              "detalhe": json.loads(r["detalhe_json"] or "{}"),
                              "criado_em": r["criado_em"]}
                 for r in fb.execute("SELECT * FROM avaliacao WHERE thread=?", (thread,))}
        vereditos = {r["decisao_id"]: r["veredito"] for r in fb.execute(
            "SELECT decisao_id, veredito FROM precedente_uso WHERE thread=?", (thread,))}
    finally:
        fb.close()
    return {"humano": notas.get("humano"), "juiz": notas.get("juiz"),
            "vereditos": vereditos, "concordancia": feedback.concordancia()}


@app.get("/api/feedback/boost")
def ver_boost(_u=Depends(atual), cam=Depends(cerebro_atual)):
    # por cerebro: decisao_id so' e' unico dentro de um acervo
    b = feedback.boost(cerebro=cam["slug"])
    if not b:
        return {"itens": [], "teto": feedback.TETO}
    db = busca._db(cam["rag"])
    linhas = db.execute(
        "SELECT id, numero, classe, ano, resultado FROM decisao WHERE id IN (%s)"
        % ",".join("?" * len(b)), list(b)).fetchall()
    return {"teto": feedback.TETO, "por_voto": feedback.POR_VOTO,
            "itens": [{"id": i, "numero": n, "classe": cl, "ano": a,
                       "resultado": r, "fator": b[i]}
                      for i, n, cl, a, r in linhas]}


# --------------------------------------------------------------- acervo

@app.get("/api/corpus")
def corpus(_u=Depends(atual), cam=Depends(cerebro_atual), q: str = "",
           classe: str = "", ano_min: int = 0,
           ano_max: int = 0, ancora: str = "", resultado: str = "",
           pagina: int = 0, por_pagina: int = Query(25, le=100)):
    filtros = []
    args = []
    for campo, valor in (("classe", classe), ("ancora", ancora),
                         ("resultado", resultado)):
        if valor:
            filtros.append("d.%s = ?" % campo if campo != "classe"
                           else "d.classe LIKE ?")
            args.append(valor if campo != "classe" else "%" + valor + "%")
    if ano_min:
        filtros.append("d.ano >= ?")
        args.append(ano_min)
    if ano_max:
        filtros.append("d.ano <= ?")
        args.append(ano_max)

    if q.strip():
        # o mesmo caminho da consulta: BM25 e depois o rerank, para a busca do
        # acervo explicar a propria ordem igual ao relatorio
        consulta = busca.montar_consulta([t for t in re.split(r"[;\n]", q) if t.strip()]
                                         or [q])
        itens = busca.buscar(consulta, limite=400, classe=classe or None,
                             ano_min=ano_min or None, ano_max=ano_max or None,
                             resultados=(resultado,) if resultado else (),
                             banco=cam["rag"])
        if ancora:
            itens = [x for x in itens if x.get("ancora") == ancora]
        itens = rerank.ordenar(itens)
        total = len(itens)
        pagina_itens = itens[pagina * por_pagina:(pagina + 1) * por_pagina]
        return {"total": total, "consulta_fts": consulta, "ordenado_por": "bm25+rerank",
                "cerebro": cam["slug"],
                "itens": [serial.precedente(x, ementa_chars=400) for x in pagina_itens]}

    # busca vazia: FTS5 exige MATCH, entao aqui e' um SELECT direto por data
    where = ("WHERE " + " AND ".join(filtros)) if filtros else ""
    db = busca._db(cam["rag"])
    total = db.execute("SELECT count(*) FROM decisao d %s" % where, args).fetchone()[0]
    linhas = db.execute(
        "SELECT %s FROM decisao d %s ORDER BY d.data DESC, d.id DESC LIMIT ? OFFSET ?"
        % (",".join("d." + c for c in busca.CAMPOS), where),
        args + [por_pagina, pagina * por_pagina]).fetchall()
    itens = [dict(zip(busca.CAMPOS, l)) for l in linhas]
    return {"total": total, "consulta_fts": None, "ordenado_por": "data",
            "cerebro": cam["slug"],
            "itens": [serial.precedente(x, ementa_chars=400) for x in itens]}


@app.get("/api/corpus/facetas")
def facetas(_u=Depends(atual), cam=Depends(cerebro_atual)):
    db = busca._db(cam["rag"])
    return {c: [{"valor": v, "n": n} for v, n in db.execute(
        "SELECT %s, count(*) x FROM decisao WHERE %s IS NOT NULL AND %s <> '' "
        "GROUP BY 1 ORDER BY x DESC LIMIT 40" % (c, c, c))]
        for c in ("classe", "orgao", "comarca", "ancora", "resultado")}


# O CEREBRO VAI NO CAMINHO, e nao em ?cerebro=. `decisao_id` so' e' unico dentro
# de um acervo: um link colado por quem estava num cerebro abriria a decisao de
# mesmo id no OUTRO, com aparencia perfeitamente normal. Assim o link e'
# auto-contido.
@app.get("/api/corpus/{cerebro}/{decisao_id}")
def decisao(cerebro: str, decisao_id: int, c=Depends(conexao), u=Depends(atual)):
    cam = cerebro_atual(cerebro)
    db = busca._db(cam["rag"])
    linha = db.execute(
        "SELECT %s FROM decisao d WHERE d.id = ?" % ",".join("d." + x
                                                             for x in busca.CAMPOS),
        (decisao_id,)).fetchone()
    if linha is None:
        raise HTTPException(404, "decisão não encontrada")
    d = dict(zip(busca.CAMPOS, linha))
    saida = serial.precedente(d, ementa_chars=20000)
    saida["dispositivo"] = d.get("dispositivo")

    # onde ela já foi usada — só as consultas que este usuário pode ver
    fb = sqlite3.connect("file:%s?mode=ro" % feedback.FB.replace("\\", "/"), uri=True)
    try:
        # AND cerebro=?: sem isso a pagina de uma decisao do dacol listaria as
        # consultas do rubens que por acaso tinham o mesmo id — plausivel e
        # invisivel
        usos = fb.execute(
            "SELECT thread, nota_triagem, veredito FROM precedente_uso "
            "WHERE decisao_id=? AND cerebro=?", (decisao_id, cam["slug"])).fetchall()
    finally:
        fb.close()
    meus = {r["thread"] for r in c.execute("SELECT thread FROM dono WHERE email=?",
                                           (u["email"],))}
    saida["cerebro"] = cam["slug"]
    saida["cerebro_nome"] = cam["nome"]
    saida["usos"] = [{"thread": t, "nota_triagem": n, "veredito": v}
                     for t, n, v in usos
                     if manda(u) or t in meus]
    saida["usos_totais"] = len(usos)
    saida["boost"] = feedback.boost(cerebro=cam["slug"]).get(decisao_id)
    saida["tem_documento"] = bool(_doc_path(decisao_id, cam))
    return saida


def _remontar_doc(guardado, cam):
    """O caminho DESTE servidor para um doc_path guardado em outro.

    So' o nome do arquivo e' portavel. O doc_path foi gravado onde a coleta
    rodou — no Windows sai "D:\\...\\output\\documentos\\x.rtf", e no Linux isso
    nao e' isabs(): cairia num join com a RAIZ, a validacao do chamador
    rejeitaria e TODO documento viraria 404 calado. O arquivo mora sempre em
    <dir do cerebro>/documentos/, entao e' de la' que remontamos.
    """
    return os.path.join(cam["documentos"],
                        os.path.basename(guardado.replace("\\", "/")))


def _doc_path(decisao_id, cam):
    if not os.path.exists(cam["tjsc"]):
        return None
    db = sqlite3.connect("file:%s?mode=ro" % cam["tjsc"].replace("\\", "/"), uri=True)
    try:
        r = db.execute("SELECT doc_path FROM decisoes WHERE id=?",
                       (decisao_id,)).fetchone()
    finally:
        db.close()
    if not r or not r[0]:
        return None
    caminho = _remontar_doc(r[0], cam)
    # Cinto e suspensorio: o basename ja' mata travessia, mas a conferencia fica
    # porque e' ela que garante que o arquivo e' DESTE cerebro. Comparar contra
    # RAIZ/output rejeitaria em silencio (404 "sem documento") qualquer cerebro
    # configurado com `dir` fora de output/ — que e' para o que o campo existe.
    caminho = os.path.realpath(caminho)
    raiz_docs = os.path.realpath(cam["dir"])
    if not caminho.startswith(raiz_docs + os.sep) or not os.path.exists(caminho):
        return None
    return caminho


@app.get("/api/corpus/{cerebro}/{decisao_id}/teor", response_class=PlainTextResponse)
def teor(cerebro: str, decisao_id: int, _u=Depends(atual)):
    cam = cerebro_atual(cerebro)
    if not os.path.exists(cam["tjsc"]):
        raise HTTPException(404, "tjsc.db indisponível")
    db = sqlite3.connect("file:%s?mode=ro" % cam["tjsc"].replace("\\", "/"), uri=True)
    try:
        r = db.execute("SELECT inteiro_teor FROM decisoes WHERE id=?",
                       (decisao_id,)).fetchone()
    finally:
        db.close()
    if not r or not r[0]:
        raise HTTPException(404, "sem inteiro teor")
    return r[0]


@app.get("/api/corpus/{cerebro}/{decisao_id}/documento")
def documento(cerebro: str, decisao_id: int, _u=Depends(atual)):
    caminho = _doc_path(decisao_id, cerebro_atual(cerebro))
    if not caminho:
        raise HTTPException(404, "sem documento em disco")
    return FileResponse(caminho, media_type="application/rtf",
                        filename=os.path.basename(caminho))


# ----------------------------------------------------------- estatísticas

@app.get("/api/estatisticas/corpus")
def est_corpus(_u=Depends(atual), cam=Depends(cerebro_atual)):
    return dict(estatisticas.corpus(cam["rag"]), cerebro=cam["slug"],
                cerebro_nome=cam["nome"])


@app.get("/api/estatisticas/documentos")
def est_documentos(_u=Depends(atual), cam=Depends(cerebro_atual)):
    return estatisticas.documentos(banco=cam["rag"], tjsc=cam["tjsc"])


@app.get("/api/estatisticas/classes")
def est_classes(_u=Depends(atual), cam=Depends(cerebro_atual), minimo: int = 300):
    return {"minimo": minimo, "itens": estatisticas.classes(minimo, cam["rag"])}


@app.get("/api/estatisticas/orgaos")
def est_orgaos(_u=Depends(atual), cam=Depends(cerebro_atual), minimo: int = 300):
    return {"minimo": minimo, "itens": estatisticas.orgaos(minimo, cam["rag"])}


@app.get("/api/estatisticas/deriva")
def est_deriva(_u=Depends(atual), cam=Depends(cerebro_atual)):
    def t(linhas):
        return [{"rotulo": str(r), "n": n, "reforma_pct": round(p, 1) if p else None}
                for r, n, p in linhas]
    b = cam["rag"]
    return {"por_ano": t(deriva.por_ano(b)),
            "por_dia_semana": t(deriva.por_dia_semana(b)),
            "por_carga": t(deriva.por_carga(b)),
            "por_carga_controlada": t(deriva.por_carga_controlada(b)),
            "por_ancora": t(deriva.por_ancora(b))}


@app.get("/api/estatisticas/calibracao")
def est_calibracao(_u=Depends(atual), cam=Depends(cerebro_atual)):
    return estatisticas.calibracao(cam["calibrador"])


@app.get("/api/estatisticas/abstencao")
def est_abstencao(_u=Depends(atual), cam=Depends(cerebro_atual)):
    return estatisticas.abstencao(cerebro=cam["slug"])


@app.get("/api/estatisticas/concordancia")
def est_concordancia(_u=Depends(atual)):
    return {"concordancia": feedback.concordancia()}


@app.get("/api/estatisticas/custos")
def est_custos(c=Depends(conexao), u=Depends(atual), de: str = "", ate: str = ""):
    onde, args = [], []
    if not manda(u):
        onde.append("thread IN (SELECT thread FROM dono WHERE email=?)")
        args.append(u["email"])
    if de:
        onde.append("quando >= ?")
        args.append(de)
    if ate:
        onde.append("quando <= ?")
        args.append(ate)
    w = ("WHERE " + " AND ".join(onde)) if onde else ""
    fmt = lambda linhas: [dict(r) for r in linhas]            # noqa: E731
    return {
        "total_usd": c.execute("SELECT coalesce(sum(custo_usd),0) FROM custo %s" % w,
                               args).fetchone()[0],
        "por_dia": fmt(c.execute(
            "SELECT substr(quando,1,10) dia, sum(custo_usd) usd, count(*) chamadas "
            "FROM custo %s GROUP BY 1 ORDER BY 1" % w, args)),
        "por_no": fmt(c.execute(
            "SELECT no, sum(custo_usd) usd, count(*) chamadas, "
            "  sum(tokens_in) tin, sum(tokens_out) tout "
            "FROM custo %s GROUP BY 1 ORDER BY 2 DESC" % w, args)),
        "por_modelo": fmt(c.execute(
            "SELECT modelo, sum(custo_usd) usd, count(*) chamadas "
            "FROM custo %s GROUP BY 1 ORDER BY 2 DESC" % w, args)),
    }


@app.get("/api/historico")
def historico(_u=Depends(atual), termo: str = "", n: int = Query(30, le=200)):
    return serial.historico(termo or None, n)


# ---------------------------------------------------------------- admin

@app.get("/api/admin/usuarios")
def listar_usuarios(c=Depends(conexao), _a=Depends(admin)):
    return {"itens": [{"email": r["email"], "papel": r["papel"],
                       "criado_em": r["criado_em"], "ativo": bool(r["ativo"]),
                       "sessoes": len(auth.sessoes(c, r["email"]))}
                      for r in c.execute("SELECT * FROM usuario ORDER BY email")]}


@app.post("/api/admin/usuarios", status_code=201)
async def novo_usuario(request: Request, c=Depends(conexao), a=Depends(admin)):
    corpo = await request.json()
    papel = corpo.get("papel") or "advogado"
    # criar superadmin e' poder sobre os CEREBROS, nao sobre o escritorio: fica
    # com quem ja' tem esse poder (ver o docstring de superadmin()).
    if papel == "superadmin" and a["papel"] != "superadmin":
        raise HTTPException(403, "só um superadministrador cria outro")
    try:
        email = auth.criar_usuario(c, corpo.get("email") or "",
                                   corpo.get("senha") or "", papel=papel)
    except auth.EmailEmUso as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"email": email}


@app.delete("/api/admin/usuarios/{email}", status_code=204)
def desativar(email: str, c=Depends(conexao), _a=Depends(admin)):
    with c:
        c.execute("UPDATE usuario SET ativo=0 WHERE email=?", (email.lower(),))
        c.execute("DELETE FROM sessao WHERE email=?", (email.lower(),))
    return Response(status_code=204)


# ------------------------------------------------------------- estáticos

if os.path.isdir(DIST):
    # StaticFiles(html=True) serve o index em "/", mas devolve 404 em qualquer
    # rota funda: o roteamento e' do react-router, e /consultas/2026-08-06 nao
    # existe como arquivo. Sem o fallback abaixo, F5 numa consulta aberta ou um
    # link colado para outra pessoa cai em 404 — que e' como o usuario descobre
    # que "a pagina quebrou". Os /api/* nunca chegam aqui: as rotas declaradas
    # acima tem precedencia sobre o mount.
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")),
              name="assets")

    @app.get("/{caminho:path}", include_in_schema=False)
    def spa(caminho: str):
        arquivo = os.path.normpath(os.path.join(DIST, caminho))
        # normpath resolve ".." — sem esta checagem, /../../config.json sairia
        if arquivo.startswith(DIST) and os.path.isfile(arquivo):
            return FileResponse(arquivo)
        if caminho.startswith("api/"):
            raise HTTPException(404, "rota de API inexistente")
        return FileResponse(os.path.join(DIST, "index.html"))
