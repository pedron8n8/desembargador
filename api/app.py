"""A API. So' transporte: toda conta vem de src/rag/.

    python -m uvicorn api.app:app --port 8000
    web.bat                                    (sobe isto + o vite)

Em dev o Vite (5173) faz proxy de /api para ca'. Same-origin, entao nao ha' CORS
nem cookie cross-site para configurar. Em producao o `frontend/dist` e' servido daqui
mesmo: um processo, uma porta, um certificado.
"""
import contextlib
import datetime as dt
import json
import os
import re
import sqlite3

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from src.rag import (busca, calibrar, cli, conversa, deriva, estatisticas,
                     feedback, floresta, grafo, rede, rerank)
from src.rag.llm import config

from . import auth, esquema, execucao, serial

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TJSC = os.path.join(RAIZ, "output", "tjsc.db")
RAG = os.path.join(RAIZ, "output", "rag.db")
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
    # os dois tem cache de modulo: carregar aqui tira 40 MB do caminho critico
    # da primeira consulta
    floresta.carregar()
    calibrar.carregar()
    pendentes = execucao.reconciliar()
    if pendentes:
        print("reconciliadas %d execuções interrompidas: %s"
              % (len(pendentes), ", ".join("%s=%s" % x for x in pendentes)))
    yield


app = FastAPI(title="Segundo Cérebro — TJSC", lifespan=lifespan, docs_url=None,
              redoc_url=None, openapi_url=None)


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


def admin(u=Depends(atual)):
    if u["papel"] != "admin":
        raise HTTPException(403, "só para administrador")
    return u


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
def saude():
    return {"ok": True, "bancos": {
        n: os.path.exists(p) for n, p in
        (("rag", RAG), ("tjsc", TJSC), ("runs", execucao.RUNS),
         ("feedback", feedback.FB), ("web", esquema.WEB))}}


@app.get("/api/config")
def configuracao(_u=Depends(atual)):
    """O que está CARREGADO no processo, não o que está no arquivo.

    llm.config() cacheia num global: mexer no config_rag.json com o servidor de
    pé não muda nada até reiniciar. A interface tem de mostrar o que está
    valendo, senão vira um painel que mente com boa intenção.
    """
    cfg = config()
    rf = floresta.carregar()
    return {
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
        "calibrado": calibrar.calibrado(),
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
        if u["papel"] != "admin":
            raise HTTPException(404, "consulta não encontrada")
    elif d["email"] != u["email"] and u["papel"] != "admin":
        raise HTTPException(404, "consulta não encontrada")


@app.get("/api/consultas")
def listar(c=Depends(conexao), u=Depends(atual), pagina: int = 0,
           por_pagina: int = Query(25, le=100)):
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
        "SELECT thread, estado, erro, segundos FROM execucao")}

    saida = []
    for l in linhas:
        d = meus.get(l["thread"])
        if u["papel"] != "admin" and d != u["email"]:
            continue
        try:
            p = json.loads(l["prognostico_json"] or "{}")
        except ValueError:
            p = {}
        e = estados.get(l["thread"])
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
        })

    # Execuções que ainda não chegaram ao feedback.db. Normalmente são as que
    # estão rodando; uma 'pronto' aqui significa que cli.finalizar não completou
    # — anomalia que tem de aparecer na lista, não sumir dela.
    ja = {x["thread"] for x in saida}
    for r in c.execute("SELECT * FROM execucao ORDER BY criado_em DESC"):
        if r["thread"] in ja:
            continue
        if u["papel"] != "admin" and r["email"] != u["email"]:
            continue
        saida.append({"thread": r["thread"], "criado_em": r["criado_em"],
                      "resumo": "", "custo_usd": None, "nota_humano": None,
                      "nota_juiz": None, "decide": None, "probabilidade_pct": None,
                      "resultado_provavel": None, "estado": r["estado"],
                      "erro": r["erro"], "da_cli": False})
    saida.sort(key=lambda x: x["criado_em"] or "", reverse=True)
    return {"total": len(saida),
            "itens": saida[pagina * por_pagina:(pagina + 1) * por_pagina]}


@app.post("/api/consultas", status_code=202)
async def rodar(request: Request, c=Depends(conexao), u=Depends(atual)):
    corpo = await request.json()
    caso = (corpo.get("caso") or "").strip()
    if not caso:
        raise HTTPException(400, "caso vazio")
    tese = corpo.get("tese") or "neutra"
    if tese != "neutra" and tese not in grafo.LADOS:
        raise HTTPException(400, "tese inválida: %s" % tese)
    f = corpo.get("filtros") or {}
    thread = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    if c.execute("SELECT 1 FROM execucao WHERE thread=?", (thread,)).fetchone():
        thread += "-%s" % os.urandom(2).hex()
    execucao.iniciar(
        thread, u["email"], caso, tese=tese,
        filtros={"classe": f.get("classe") or None,
                 "ano_min": f.get("ano_min"), "ano_max": f.get("ano_max"),
                 "excluir": tuple(f.get("excluir") or ())},
        so_prognostico=bool(corpo.get("so_prognostico")))
    return {"thread": thread}


@app.post("/api/consultas/{thread}/retomar", status_code=202)
def retomar(thread: str, c=Depends(conexao), u=Depends(atual)):
    _dono_ou_403(c, thread, u)
    r = c.execute("SELECT * FROM execucao WHERE thread=?", (thread,)).fetchone()
    if r is None:
        raise HTTPException(404, "sem execução registrada")
    if r["estado"] in ("fila", "rodando"):
        raise HTTPException(409, "essa consulta já está rodando")
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
        c.execute("INSERT INTO custo VALUES (?,?,?,?,?,?,?)",
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
def ver_boost(_u=Depends(atual)):
    b = feedback.boost()
    if not b:
        return {"itens": [], "teto": feedback.TETO}
    db = busca._db(RAG)
    linhas = db.execute(
        "SELECT id, numero, classe, ano, resultado FROM decisao WHERE id IN (%s)"
        % ",".join("?" * len(b)), list(b)).fetchall()
    return {"teto": feedback.TETO, "por_voto": feedback.POR_VOTO,
            "itens": [{"id": i, "numero": n, "classe": cl, "ano": a,
                       "resultado": r, "fator": b[i]}
                      for i, n, cl, a, r in linhas]}


# --------------------------------------------------------------- acervo

@app.get("/api/corpus")
def corpus(_u=Depends(atual), q: str = "", classe: str = "", ano_min: int = 0,
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
                             resultados=(resultado,) if resultado else ())
        if ancora:
            itens = [x for x in itens if x.get("ancora") == ancora]
        itens = rerank.ordenar(itens)
        total = len(itens)
        pagina_itens = itens[pagina * por_pagina:(pagina + 1) * por_pagina]
        return {"total": total, "consulta_fts": consulta, "ordenado_por": "bm25+rerank",
                "itens": [serial.precedente(x, ementa_chars=400) for x in pagina_itens]}

    # busca vazia: FTS5 exige MATCH, entao aqui e' um SELECT direto por data
    where = ("WHERE " + " AND ".join(filtros)) if filtros else ""
    db = busca._db(RAG)
    total = db.execute("SELECT count(*) FROM decisao d %s" % where, args).fetchone()[0]
    linhas = db.execute(
        "SELECT %s FROM decisao d %s ORDER BY d.data DESC, d.id DESC LIMIT ? OFFSET ?"
        % (",".join("d." + c for c in busca.CAMPOS), where),
        args + [por_pagina, pagina * por_pagina]).fetchall()
    itens = [dict(zip(busca.CAMPOS, l)) for l in linhas]
    return {"total": total, "consulta_fts": None, "ordenado_por": "data",
            "itens": [serial.precedente(x, ementa_chars=400) for x in itens]}


@app.get("/api/corpus/facetas")
def facetas(_u=Depends(atual)):
    db = busca._db(RAG)
    return {c: [{"valor": v, "n": n} for v, n in db.execute(
        "SELECT %s, count(*) x FROM decisao WHERE %s IS NOT NULL AND %s <> '' "
        "GROUP BY 1 ORDER BY x DESC LIMIT 40" % (c, c, c))]
        for c in ("classe", "orgao", "comarca", "ancora", "resultado")}


@app.get("/api/corpus/{decisao_id}")
def decisao(decisao_id: int, c=Depends(conexao), u=Depends(atual)):
    db = busca._db(RAG)
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
        usos = fb.execute(
            "SELECT thread, nota_triagem, veredito FROM precedente_uso "
            "WHERE decisao_id=?", (decisao_id,)).fetchall()
    finally:
        fb.close()
    meus = {r["thread"] for r in c.execute("SELECT thread FROM dono WHERE email=?",
                                           (u["email"],))}
    saida["usos"] = [{"thread": t, "nota_triagem": n, "veredito": v}
                     for t, n, v in usos
                     if u["papel"] == "admin" or t in meus]
    saida["usos_totais"] = len(usos)
    saida["boost"] = feedback.boost().get(decisao_id)
    saida["tem_documento"] = bool(_doc_path(decisao_id))
    return saida


def _doc_path(decisao_id):
    if not os.path.exists(TJSC):
        return None
    db = sqlite3.connect("file:%s?mode=ro" % TJSC.replace("\\", "/"), uri=True)
    try:
        r = db.execute("SELECT doc_path FROM decisoes WHERE id=?",
                       (decisao_id,)).fetchone()
    finally:
        db.close()
    if not r or not r[0]:
        return None
    caminho = r[0] if os.path.isabs(r[0]) else os.path.join(RAIZ, r[0])
    # o doc_path vem do banco: normalizar e conferir que nao saiu de output/
    caminho = os.path.realpath(caminho)
    raiz_docs = os.path.realpath(os.path.join(RAIZ, "output"))
    if not caminho.startswith(raiz_docs + os.sep) or not os.path.exists(caminho):
        return None
    return caminho


@app.get("/api/corpus/{decisao_id}/teor", response_class=PlainTextResponse)
def teor(decisao_id: int, _u=Depends(atual)):
    if not os.path.exists(TJSC):
        raise HTTPException(404, "tjsc.db indisponível")
    db = sqlite3.connect("file:%s?mode=ro" % TJSC.replace("\\", "/"), uri=True)
    try:
        r = db.execute("SELECT inteiro_teor FROM decisoes WHERE id=?",
                       (decisao_id,)).fetchone()
    finally:
        db.close()
    if not r or not r[0]:
        raise HTTPException(404, "sem inteiro teor")
    return r[0]


@app.get("/api/corpus/{decisao_id}/documento")
def documento(decisao_id: int, _u=Depends(atual)):
    caminho = _doc_path(decisao_id)
    if not caminho:
        raise HTTPException(404, "sem documento em disco")
    return FileResponse(caminho, media_type="application/rtf",
                        filename=os.path.basename(caminho))


# ----------------------------------------------------------- estatísticas

@app.get("/api/estatisticas/corpus")
def est_corpus(_u=Depends(atual)):
    return estatisticas.corpus()


@app.get("/api/estatisticas/documentos")
def est_documentos(_u=Depends(atual)):
    return estatisticas.documentos(tjsc=TJSC)


@app.get("/api/estatisticas/classes")
def est_classes(_u=Depends(atual), minimo: int = 300):
    return {"minimo": minimo, "itens": estatisticas.classes(minimo)}


@app.get("/api/estatisticas/orgaos")
def est_orgaos(_u=Depends(atual), minimo: int = 300):
    return {"minimo": minimo, "itens": estatisticas.orgaos(minimo)}


@app.get("/api/estatisticas/deriva")
def est_deriva(_u=Depends(atual)):
    def t(linhas):
        return [{"rotulo": str(r), "n": n, "reforma_pct": round(p, 1) if p else None}
                for r, n, p in linhas]
    return {"por_ano": t(deriva.por_ano()),
            "por_dia_semana": t(deriva.por_dia_semana()),
            "por_carga": t(deriva.por_carga()),
            "por_carga_controlada": t(deriva.por_carga_controlada()),
            "por_ancora": t(deriva.por_ancora())}


@app.get("/api/estatisticas/calibracao")
def est_calibracao(_u=Depends(atual)):
    return estatisticas.calibracao()


@app.get("/api/estatisticas/abstencao")
def est_abstencao(_u=Depends(atual)):
    return estatisticas.abstencao()


@app.get("/api/estatisticas/concordancia")
def est_concordancia(_u=Depends(atual)):
    return {"concordancia": feedback.concordancia()}


@app.get("/api/estatisticas/custos")
def est_custos(c=Depends(conexao), u=Depends(atual), de: str = "", ate: str = ""):
    onde, args = [], []
    if u["papel"] != "admin":
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
async def novo_usuario(request: Request, c=Depends(conexao), _a=Depends(admin)):
    corpo = await request.json()
    try:
        email = auth.criar_usuario(c, corpo.get("email") or "",
                                   corpo.get("senha") or "",
                                   papel=corpo.get("papel") or "advogado")
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
