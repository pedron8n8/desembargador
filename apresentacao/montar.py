"""Monta os dados da apresentacao a partir das fontes e dos bancos.

    .venv\\Scripts\\python -m apresentacao.montar

Nenhum numero da apresentacao e' digitado a mao: tudo o que aparece na tela sai
daqui, e daqui sai do relatorio real de uma consulta (apresentacao/fontes/consultas)
ou do acervo (output/rag.db). Se um numero mudar no sistema, roda-se isto de novo.

O que e' EDITORIAL (texto de secao, alinhamento do confronto) esta' em constantes
neste arquivo, com a origem anotada ao lado. O que e' MEDIDO e' extraido.
"""
import json
import os
import re
import sqlite3
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

from src import cerebros  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTES = os.path.join(AQUI, "fontes")
DADOS = os.path.join(AQUI, "dados")

# --------------------------------------------------------------- o caso da demo

CASO = {
    "numero": "5024128-82.2025.8.24.0000",
    "consulta": "demo-arresto",
    "peca": "caso-arresto-execucao.txt",
    "excluir": [12522],
    "julgado_em": "24/04/2025",
    "orgao": "6ª Câmara de Direito Comercial",
    "materia": "Execução de título extrajudicial — arresto online via Sisbajud",
    "real": "provido",
}

# Quantos casos foram triados ate' achar um em que o sistema DECIDE. Isto vai
# para a tela: sem este numero a demo e' uma vitrine montada.
TRIAGEM = {
    "elegiveis_2025": 1369,
    "pre_filtrados_decidiriam": 245,
    "consultados": 7,
    "decidiram": 2,
    "cobertura_medida": 0.378,
}

# A apresentacao NAO fala em dinheiro. E o corte e' na FONTE, nao na tela: os
# JSON abaixo sao servidos por /api/apresentacao/dados, e um preco que ficasse
# neles apareceria no DevTools de quem esta' assistindo a demonstracao — que e'
# exatamente a pessoa de quem se quer esconder o custo de producao.
# O livro-caixa continua inteiro no relatorio da consulta
# (apresentacao/fontes/consultas/) e no prova.md; so' nao sai por esta rota.
SEM_DINHEIRO = ("usd", "total_usd", "custo_usd", "custo_total_usd",
                "por_chamada_usd")


def sem_dinheiro(obj):
    """Remove recursivamente qualquer chave de valor monetario."""
    if isinstance(obj, dict):
        return {k: sem_dinheiro(v) for k, v in obj.items() if k not in SEM_DINHEIRO}
    if isinstance(obj, list):
        return [sem_dinheiro(x) for x in obj]
    return obj

# ------------------------------------------- os candidatos lidos, congelados

# O relatorio markdown so' imprime os 8 APROVADOS. Os 32 que a triagem leu e
# reprovou existem — com nota, motivo escrito pelo modelo, ficha e conta de
# rerank — dentro do checkpoint do LangGraph, em output/rag_runs.db.
#
# Congelamos porque aquele arquivo tem 34 MB, esta' no .gitignore e guarda
# formato interno do LangGraph (msgpack via JsonPlusSerializer): uma limpeza de
# checkpoints ou um upgrade da lib apagaria a unica copia da evidencia. fontes/
# e' onde mora a prova; dados/ e' o que a tela consome.
CANDIDATOS = os.path.join(FONTES, "candidatos-%s.json" % CASO["consulta"])

RUNS = os.path.join(RAIZ, "output", "rag_runs.db")


def congelar():
    """Le os candidatos do checkpoint e grava fontes/candidatos-*.json.

        .venv\\Scripts\\python -m apresentacao.montar --congelar

    Roda uma vez, ou quando a consulta da demo for refeita. A ficha e a conta
    sao renderizadas pelas MESMAS funcoes que o relatorio usa — assim o que
    aparece na tela e' literalmente o que o pipeline calculou, nao uma
    reimplementacao que pode divergir em silencio.
    """
    from api import serial
    from src.rag import grafo as motor, rede, rerank, sinais

    app = motor.construir(checkpoint=RUNS)
    est = app.get_state({"configurable": {"thread_id": CASO["consulta"]}}).values
    cand = est.get("candidatos") or []
    assert cand, "o checkpoint da thread %s nao tem candidatos" % CASO["consulta"]

    # Os dispositivos legais sao mais NOVOS que este checkpoint: a coluna
    # leis_json entrou no indice depois que a consulta da demo rodou, entao o
    # estado congelado do LangGraph nao os tem. Vem do indice, por id.
    #
    # Isto NAO e' recalcular a consulta: a extracao de lei e' deterministica
    # sobre o mesmo inteiro teor (regex, sem LLM, sem rede), e o id e' o mesmo
    # dos dois lados. O que sai daqui e' o que a consulta teria trazido se
    # tivesse rodado hoje — e uma consulta rodada hoje traz isto.
    idx = sqlite3.connect(
        "file:%s?mode=ro" % cerebros.caminhos()["rag"].replace("\\", "/"), uri=True)
    try:
        por_id = dict(idx.execute(
            "SELECT id, leis_json FROM decisao WHERE id IN (%s)"
            % ",".join("?" * len(cand)), [c["id"] for c in cand]))
    finally:
        idx.close()
    for c in cand:
        c["leis_json"] = por_id.get(c["id"]) or "[]"

    saida = []
    for c in cand:
        saida.append({
            "id": c["id"], "num": c["numero"], "classe": c.get("classe"),
            "orgao": c.get("orgao"), "comarca": c.get("comarca"),
            "data": c.get("data"), "ano": c.get("ano"),
            "res": c.get("resultado"), "nota": c.get("nota"),
            "porque": c.get("por_que") or "",
            "proc": sinais.resumir_ficha(c),
            "rank": rerank.explicar(c),
            "fatores": c.get("porque_rank") or {},
            "bm25": c.get("score"), "pontos": c.get("pontos"),
            # de onde saiu o RESULTADO daquela decisao (dispositivo, texto
            # completo, ementa). E' o primeiro fator do peso do k-NN, e sem ele
            # a conta da tela nao fecha com a do pipeline.
            "confianca": c.get("confianca"),
            "ancora": c.get("ancora"), "ancoras": c.get("ancoras_json"),
            "leis": c.get("leis_json"),
            "unanime": c.get("unanime"), "efeito": c.get("efeito"),
            # a ementa vai truncada no mesmo tamanho do relatorio
            "ementa": (c.get("ementa") or c.get("dispositivo") or "")[:400],
            "url": c.get("url"),
        })
    # a rede entre os candidatos sai do modulo que ja' a calcula em producao
    # (src/rag/rede.py, a aba Rede de /consulta/:thread): ancora canonizada
    # vira NO', e semelhanca de ementa vira aresta tracejada. Congelada junto
    # para nao arrastar sklearn/TF-IDF para dentro da montagem.
    r = rede.montar(cand, limiar=0.12, max_por_no=3)

    # A CASCATA DO PROGNOSTICO, inteira, da funcao que ja' a serve ao produto
    # (api/serial.py -> aba Pesos de /consulta/:thread). Por precedente:
    # bm25, fatores do rerank, pontos, peso de confianca, nota normalizada,
    # peso final e fracao do total. E a agregacao: k-NN, floresta, conjunto,
    # calibrado, intervalo e o dossie do portao de confianca.
    #
    # A secao "A conta" da apresentacao reencena esses numeros passo a passo.
    # Reimplementar a conta em TypeScript para animá-la seria manter duas
    # aritmeticas do mesmo prognostico, e a tela passaria a poder divergir do
    # pipeline em silencio — que e' exatamente o que esta pagina promete nao
    # fazer. Aqui ela e' CONGELADA, nao recalculada.
    ps = serial.pesos(est)

    obj = {"candidatos": saida, "rede": r, "pesos": ps}
    with open(CANDIDATOS, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    print("congelados %d candidatos (%d âncoras, %d leis, %d arestas de rede; "
          "cascata de %d precedentes) em %s"
          % (len(saida), r["resumo"]["n_ancoras"], r["resumo"]["n_leis"],
             len(r["arestas"]), len(ps["precedentes"]), CANDIDATOS))
    return obj


def candidatos():
    """O congelado. Sem checkpoint, sem langgraph, sem sklearn."""
    with open(CANDIDATOS, encoding="utf-8") as f:
        return json.load(f)

# ---------------------------------------------------------- leitura da consulta


def consulta(nome):
    with open(os.path.join(FONTES, "consultas", "%s.md" % nome),
              encoding="utf-8") as f:
        return f.read()


def _bloco(txt, inicio, fim=None):
    i = txt.find(inicio)
    if i < 0:
        return ""
    j = txt.find(fim, i + len(inicio)) if fim else -1
    return txt[i:j if j > 0 else len(txt)].strip()


def precedentes(txt):
    """Os precedentes usados, com a ficha e a conta de peso que o relatorio imprimiu."""
    bloco = _bloco(txt, "## Precedentes usados", "## Procedência")
    saida = []
    for m in re.finditer(
            r"\*\*(?P<num>[\d\-.]+)\*\* — (?P<classe>[^,]+), (?P<comarca>[^,]+), "
            r"(?P<data>[\d-]+) — \*(?P<res>[^*]+)\* "
            r"\(analogia (?P<nota>\d)/5: (?P<porque>[^)]+)\)\n\n"
            r"\s+Procedência: (?P<proc>[^\n]+)\n"
            r"\s+Ranking: (?P<rank>[^\n]+)\n\n"
            r"\s+(?P<ementa>[^\n]+)\n\n\s+<(?P<url>[^>]+)>", bloco):
        d = m.groupdict()
        d["nota"] = int(d["nota"])
        d["ano"] = int(d["data"][:4])
        fator = re.search(r"→ ([\d.]+)x", d["rank"])
        d["fator"] = float(fator.group(1)) if fator else 1.0
        saida.append(d)
    return saida


def prognostico(txt):
    est = {}
    for nome, chave in (("k-NN sobre precedentes", "knn"),
                        ("Random Forest", "floresta"),
                        (r"\*\*conjunto\*\*", "conjunto")):
        m = re.search(r"\| %s \| \*?\*?([\d.]+)%%" % nome, txt)
        if m:
            est[chave] = float(m.group(1)) / 100
    cab = re.search(r"## (\d+)% de chance de reforma\s+\(intervalo de 80%: "
                    r"(\d+)% a (\d+)%\)", txt)
    return {
        "decide": bool(cab),
        "p": int(cab.group(1)) / 100 if cab else None,
        "intervalo": [int(cab.group(2)) / 100, int(cab.group(3)) / 100] if cab else None,
        "estimadores": est,
        "concordam": "Os dois estimadores concordam no lado." in txt,
        "resultado": (re.search(r"Resultado mais provável: \*\*([^*]+)\*\*", txt)
                      or [None, None])[1] if cab else None,
    }


def custo(txt):
    linhas = []
    for m in re.finditer(r"\| (\w+) \| ([\w\-./]+) \| ([\d]+)/([\d]+) \| ([\d.]+) \|", txt):
        linhas.append({"no": m.group(1), "modelo": m.group(2),
                       "entrada": int(m.group(3)), "saida": int(m.group(4)),
                       "usd": float(m.group(5))})
    tot = re.search(r"\| \*\*total\*\* \| \| \| \*\*([\d.]+)\*\* \|", txt)
    seg = re.search(r"(\d+) candidatos do BM25, (\d+) aprovados na triagem, (\d+)s", txt)
    return {
        "etapas": linhas,
        "total_usd": float(tot.group(1)) if tot else None,
        "candidatos": int(seg.group(1)) if seg else None,
        "aprovados": int(seg.group(2)) if seg else None,
        "segundos": int(seg.group(3)) if seg else None,
        "consulta_fts": (re.search(r"Busca FTS5: `([^`]+)`", txt) or [None, None])[1],
    }


def minuta(txt):
    return _bloco(txt, "**RELATÓRIO**", "### Nota do juiz automático").strip()


def juiz(txt):
    m = re.search(r"### Nota do juiz automático — ([\d.]+) \(([^)]+)\)", txt)
    if not m:
        return None
    notas = dict(re.findall(r"\| (\w+) \| (\d) \|",
                            _bloco(txt, "| critério |", "Sem gabarito")))
    crit = re.search(r"> (O ponto mais fraco[^\n]+)", txt)
    return {"nota": float(m.group(1)), "modelo": m.group(2),
            "criterios": {k: int(v) for k, v in notas.items()},
            "critica": crit.group(1) if crit else None}


def leitura(txt):
    b = _bloco(txt, "## Leitura do caso", "---")
    campo = lambda n: (re.search(r"\*\*%s:\*\* ([^\n]+)" % n, b) or [None, ""])[1]
    return {"classe": campo("Classe"), "materia": campo("Matéria"),
            "tese": campo("Tese"),
            "pedidos": [p.strip() for p in campo("Pedidos").split(";") if p.strip()]}


# ------------------------------------------------------------ acordao real


def base_legal(gerada, real, cnd, cfg):
    """Em que lei o documento gerado se apoiou — e se o acórdão real concordou.

    Tres colunas, e as tres saem do MESMO extrator que indexa o acervo
    (src/rag/sinais.leis): o que a minuta citou, se o desembargador citou o
    mesmo, e quantos dos precedentes aprovados invocam aquele dispositivo.

    A terceira coluna e' a que importa para quem assiste: ela mostra que o
    artigo nao veio da memoria do modelo, veio das decisoes reais que o sistema
    leu. E a segunda mostra o contrario com a mesma honestidade — dispositivo
    que o acordao real usou e a minuta nao, e vice-versa, fica a' vista.
    """
    from src.rag import sinais

    corte = cfg["busca"]["nota_minima"]
    aprovados = [c for c in cnd["candidatos"] if (c["nota"] or 0) >= corte]
    n = {}
    for c in aprovados:
        for lei in json.loads(c.get("leis") or "[]"):
            n[lei] = n.get(lei, 0) + 1

    da_minuta = sinais.leis(gerada)
    # do lado real vale a EMENTA e o VOTO — e' onde o desembargador fundamenta.
    # O relatório do acórdão só resume o que as partes disseram, e citação de
    # parte não é a lei em que a decisão se apoiou.
    do_real = sinais.leis("%s\n%s" % (real.get("ementa") or "",
                                      real.get("voto") or ""))
    linhas = []
    for lei in da_minuta + [x for x in do_real if x not in da_minuta]:
        linhas.append({"lei": lei,
                       "na_minuta": lei in da_minuta,
                       "no_real": lei in do_real,
                       "precedentes": n.get(lei, 0)})
    return {"linhas": linhas, "aprovados": len(aprovados),
            # os dispositivos que o acervo aprovado invoca, citados ou nao pela
            # minuta: e' o material legal que o redator TINHA na mao
            "disponiveis": [{"lei": k, "precedentes": v}
                            for k, v in sorted(n.items(),
                                               key=lambda kv: (-kv[1], kv[0]))]}


def acordao_real(numero):
    with open(os.path.join(FONTES, "acordaos", "%s.txt" % numero),
              encoding="utf-8") as f:
        t = re.sub(r"[ \t\xa0]+", " ", f.read())
    i = t.find("VOTO")
    j = t.find("Documento eletrônico", i)
    voto = t[i:j if j > 0 else len(t)].strip()
    disp = re.search(r"Dispositivo\s+(Ante o exposto[^.]+\.)", voto)
    ac = re.search(r"decidiu, por (unanimidade|maioria),([^.]+\.)", t)
    ementa = _bloco(t, "EMENTA", "ACÓRDÃO").replace("EMENTA", "").strip()
    return {"voto": voto, "dispositivo": disp.group(1) if disp else None,
            "acordao": ("por %s,%s" % (ac.group(1), ac.group(2))) if ac else None,
            "ementa": ementa}


# --------------------------------------------------------------- acervo


def acervo():
    cam = cerebros.caminhos()
    db = sqlite3.connect("file:%s?mode=ro" % cam["rag"].replace("\\", "/"), uri=True)
    n = db.execute("SELECT count(*) FROM decisao").fetchone()[0]
    anc = dict(db.execute("SELECT ancora, count(*) FROM decisao GROUP BY 1"))
    merito = db.execute(
        "SELECT count(*), sum(resultado != 'desprovido') FROM decisao WHERE resultado "
        "IN ('provido','parcialmente provido','desprovido')").fetchone()
    nao_un = db.execute("SELECT count(*) FROM decisao WHERE unanime = 0").fetchone()[0]
    efeito = db.execute("SELECT count(*) FROM decisao WHERE efeito IS NOT NULL "
                        "AND efeito <> ''").fetchone()[0]
    db.close()
    return {"decisoes": n, "ancora": anc, "merito": merito[0],
            "reformas": merito[1], "taxa_reforma": merito[1] / merito[0],
            "nao_unanimes": nao_un, "com_efeito": efeito,
            "relator": cam["nome"], "tribunal": cam.get("tribunal", "TJSC")}


# ------------------------------------------------------------------ o grafo

def grafo(prec, cnd, prog, cst, cfg):
    """Nos de dois mundos no mesmo grafo: as ETAPAS do cerebro e os DOCUMENTOS
    do acervo. Clicar num no abre o dado real daquela etapa.

    Entram os CANDIDATOS INTEIROS, nao so' os aprovados: quem foi lido e
    reprovado carrega a nota, o motivo que o modelo escreveu e a conta do
    ranking. O funil 40 -> 8 e' a coisa mais dificil de acreditar na demo, e o
    unico jeito honesto de mostra-lo e' deixar clicar no que ficou de fora.
    """
    corte = cfg["busca"]["nota_minima"]
    cands = cnd["candidatos"]
    lidos = len(cands)
    nos = [
        {"id": "caso", "tipo": "caso", "rotulo": "O caso",
         "detalhe": "O processo entra por aqui — o relatório do acórdão, sem o voto."},
        {"id": "triagem", "tipo": "etapa", "rotulo": "Triagem",
         "detalhe": "Um modelo lê a peça e devolve classe, matéria, tese, pedidos e os "
                    "termos de busca. É a única etapa que interpreta o caso."},
        {"id": "busca", "tipo": "etapa", "rotulo": "Busca BM25",
         "detalhe": "A consulta literal, disparada contra o índice de texto completo."},
        {"id": "bm80", "tipo": "volume", "rotulo": "%d candidatos" % (lidos * 2),
         "detalhe": "O BM25 entrega o dobro do que a triagem vai ler. O rerank corta "
                    "depois — assim a leitura recebe os %d melhores de %d, e não os "
                    "%d primeiros do BM25." % (lidos, lidos * 2, lidos)},
        {"id": "rerank", "tipo": "etapa", "rotulo": "Rerank",
         "detalhe": "Reordena por recência, âncora, unanimidade e efeito posterior. "
                    "Não inventa relevância — modula a que o BM25 mediu. E não "
                    "reprova ninguém: quem descarta é a nota de analogia."},
        {"id": "c40", "tipo": "volume", "rotulo": "%d lidos" % lidos,
         "detalhe": "O que a triagem de analogia efetivamente lê, um por um. "
                    "Todos os %d estão neste mapa, inclusive os que não passaram."
                    % lidos},
        {"id": "triar", "tipo": "etapa", "rotulo": "Analogia",
         "detalhe": "Um modelo lê os %d e dá nota de 0 a 5 a cada um, com o motivo. "
                    "Passa quem tira %d ou mais — %d passaram. Só o que é análogo "
                    "chega ao redator." % (lidos, corte, cst["aprovados"])},
        {"id": "prognostico", "tipo": "etapa", "rotulo": "Prognóstico",
         "detalhe": "Dois estimadores independentes, e um portão que cala quando a "
                    "margem não é folgada."},
        {"id": "knn", "tipo": "estimador", "rotulo": "k-NN",
         "detalhe": "Contagem ponderada sobre os precedentes recuperados. Auditável: "
                    "sai dos documentos listados."},
        {"id": "floresta", "tipo": "estimador", "rotulo": "Floresta",
         "detalhe": "400 árvores treinadas no histórico. Opaca, e não olha os "
                    "precedentes — por isso erra em direção oposta ao k-NN."},
        {"id": "redigir", "tipo": "etapa", "rotulo": "Redator",
         "detalhe": "Escreve a minuta ancorada nos precedentes selecionados. "
                    "Não escreve de memória."},
        {"id": "revisar", "tipo": "etapa", "rotulo": "Revisor",
         "detalhe": "De propósito de outro fornecedor que o redator: crítica "
                    "independente é o ponto do arranjo."},
        {"id": "juiz", "tipo": "etapa", "rotulo": "Juiz",
         "detalhe": "Dá nota de 0 a 5 à minuta. Fornecedor distinto de todos os "
                    "outros nós — modelo que julga a si mesmo se dá nota alta."},
    ]
    arestas = [
        ("caso", "triagem"), ("triagem", "busca"), ("busca", "bm80"),
        ("bm80", "rerank"), ("rerank", "c40"), ("c40", "triar"),
        ("triar", "prognostico"), ("prognostico", "knn"),
        ("prognostico", "floresta"), ("prognostico", "redigir"),
        ("redigir", "revisar"), ("revisar", "juiz"),
    ]

    arestas = [(a, b, "fluxo", None) for a, b in arestas]

    # TODOS os candidatos lidos viram no', ligados a triar. So' os aprovados
    # seguem para o knn: o funil aparece no desenho, nao so' no texto.
    fator = {p["num"]: p["fator"] for p in prec}
    for c in cands:
        ok = (c["nota"] or 0) >= corte
        # o motivo do descarte e' o que o MODELO escreveu, nao texto editorial.
        # E a conta de rerank nao descartou ninguem — ela decidiu quem chegou a
        # ser lido. Dizer o contrario na tela seria a tela mentindo.
        detalhe = c["porque"]
        if not ok:
            detalhe = "%s  Reprovado: analogia %d/5, e o corte é %d/5." % (
                detalhe, c["nota"] or 0, corte)
        nos.append({
            "id": "p:%s" % c["num"], "tipo": "precedente", "rotulo": c["num"],
            "aprovado": ok, "resultado": c["res"], "ano": c["ano"],
            "nota": c["nota"], "fator": fator.get(c["num"]),
            "classe": c["classe"], "orgao": c["orgao"],
            "bm25": c["bm25"], "pontos": c["pontos"],
            "url": c["url"], "detalhe": detalhe, "ficha": c["proc"],
            "conta": c["rank"], "ementa": c["ementa"],
        })
        arestas.append(("triar", "p:%s" % c["num"], "fluxo", None))
        if ok:
            arestas.append(("p:%s" % c["num"], "knn", "fluxo", None))

    # A ancora e' NO', nao aresta: ligar precedente a precedente por sumula
    # comum produz cliques ilegiveis (medido em rede.py: 20 decisoes que citam
    # a mesma sumula viram 190 arestas). Quem monta e canoniza os rotulos e'
    # src/rag/rede.py, o mesmo modulo que serve a aba Rede do produto — o
    # regex sobre o markdown que morava aqui nao achava nada, porque a mesma
    # sumula aparece escrita de quatro jeitos diferentes no acervo.
    r = cnd["rede"]
    porid = {c["id"]: "p:%s" % c["num"] for c in cands}
    for n in r["nos"]:
        if n["tipo"] != "ancora":
            continue
        nos.append({"id": n["id"], "tipo": "ancora", "rotulo": n["rotulo"],
                    "grau": n["grau"],
                    "detalhe": "%d dos %d lidos se apoiam nesta âncora.%s"
                               % (n["grau"], lidos,
                                  " Vinculante: obriga todo o país."
                                  if n["vinculante"] else
                                  " Persuasiva: convence, não obriga.")})
    for a in r["arestas"]:
        de = porid.get(a["de"], a["de"])
        para = porid.get(a["para"], a["para"])
        if a["tipo"] == "lei":
            continue        # as leis entram abaixo, e so' as dos aprovados
        arestas.append((de, para, a["tipo"], a.get("peso")))

    # A LEI E' NO' PROPRIO, ao lado da ancora e nunca dentro dela: a ancora diz
    # que outro tribunal ja' decidiu assim, a lei diz o que o legislador
    # escreveu. Sao autoridades diferentes, e empilha-las afirmaria que
    # sustentam a decisao do mesmo jeito.
    #
    # So' entram as leis dos APROVADOS, e nao as dos 40 lidos. Duas razoes, e
    # nenhuma e' estetica: os 40 dao 28 dispositivos — de fundacao, de
    # falencia, de gratuidade — que sao a materia dos casos DESCARTADOS, e o
    # mapa passaria a afirmar que a minuta se apoia neles. E a pergunta que
    # esta secao responde e' "em que lei este documento se apoiou", que so'
    # tem uma resposta certa: a dos precedentes que chegaram ao redator.
    aprov = {c["num"] for c in cands if (c["nota"] or 0) >= corte}
    usos_lei = {}
    for c in cands:
        if c["num"] not in aprov:
            continue
        for lei in json.loads(c.get("leis") or "[]"):
            usos_lei.setdefault(lei, []).append(c["num"])
    for lei, quem in sorted(usos_lei.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        if len(quem) < 2:
            continue        # dispositivo citado por um so' nao liga nada
        nos.append({"id": "lei:" + lei, "tipo": "lei", "rotulo": lei,
                    "grau": len(quem),
                    "detalhe": "%d dos %d precedentes que embasaram a minuta "
                               "invocam este dispositivo. Lei não é precedente: "
                               "é o texto em que o precedente se apoia."
                               % (len(quem), len(aprov))})
        for num in quem:
            arestas.append(("p:%s" % num, "lei:" + lei, "lei", None))

    # o dado real que cada no mostra ao ser clicado
    dado = {
        "busca": {"consulta_fts": cst["consulta_fts"]},
        "bm80": {"n": lidos * 2},
        "c40": {"n": lidos, "aprovados": cst["aprovados"]},
        "triar": {"aprovados": cst["aprovados"], "lidos": lidos, "corte": corte,
                  # a distribuicao inteira: nesta consulta ninguem tirou 3 nem
                  # 0, e o corte cai num vazio entre dois blocos
                  "distribuicao": {str(k): sum(1 for c in cands if c["nota"] == k)
                                   for k in sorted({c["nota"] for c in cands},
                                                   reverse=True)},
                  "notas": [{"numero": c["num"], "nota": c["nota"],
                             "porque": c["porque"],
                             "aprovado": (c["nota"] or 0) >= corte}
                            for c in sorted(cands, key=lambda c: -(c["nota"] or 0))]},
        "prognostico": prog,
        "knn": {"p": prog["estimadores"].get("knn")},
        "floresta": {"p": prog["estimadores"].get("floresta")},
        "rerank": {"fatores": cfg["rerank"]},
    }
    for e in cst["etapas"]:
        dado.setdefault(e["no"], {}).update(
            {"modelo": e["modelo"], "usd": e["usd"],
             "entrada": e["entrada"], "saida": e["saida"]})
    dado["juiz"] = dict(dado.get("juiz_efetivo", {}))

    ids = {n["id"] for n in nos}
    return {"nos": nos,
            "arestas": [dict({"de": a, "para": b, "tipo": t},
                             **({"peso": p} if p is not None else {}))
                        for a, b, t, p in arestas if a in ids and b in ids],
            "dado": dado}


# ------------------------------------------------------------------- a floresta

# Quantos niveis da arvore real vao para a tela. Tres da' 15 nos — a mesma
# densidade do desenho de referencia (apresentacao/exemplo/Arvore.png). A arvore
# tem 56: mostrar tudo viraria mancha, e mostrar 3 sem dizer que ha' 56 seria
# mentir por omissao. Por isso os dois numeros vao juntos para a tela.
NIVEIS_ARVORE = 3


def arvore_floresta(cst, lida):
    """Uma arvore DE VERDADE da floresta, com os cortes que ela usa.

    A secao 03 mostrava o PIPELINE — as etapas do sistema. Isto aqui e' a
    decisao matematica propriamente dita: um dos 400 estimadores do
    RandomForest de src/rag/floresta.py, com o termo, o limiar, o gini e o
    numero de amostras que o sklearn guardou em cada no'.

    Sai a arvore 0, e nao a "melhor": escolher a mais bonita entre 400 seria
    vitrine. E o caso da demo desce por ela pelo MESMO texto que a producao
    monta em grafo.py:505 — termos da triagem + materia + tese —, entao o
    caminho que acende na tela e' o caminho que este caso percorreu de fato.

    None quando nao ha' floresta treinada: a secao simplesmente nao aparece, do
    mesmo jeito que o sistema roda sem sklearn.
    """
    cam = cerebros.caminhos()
    if not os.path.exists(cam["floresta"]):
        print("  (sem floresta.pkl — a arvore real fica de fora)")
        return None
    import joblib
    from src.rag.floresta import _texto

    m = joblib.load(cam["floresta"])
    p = m["pipeline"]
    tf, rf = p.named_steps["tfidf"], p.named_steps["rf"]
    vocab = tf.get_feature_names_out()
    est = rf.estimators_[0]
    t = est.tree_
    classes = [str(c) for c in rf.classes_]

    # o mesmo texto que a producao entrega a' floresta: os termos da busca (que
    # saem entre aspas na consulta FTS5 do relatorio) mais materia e tese
    termos = re.findall(r'"([^"]+)"', cst.get("consulta_fts") or "")
    texto = " ".join(termos + [lida.get("materia") or "", lida.get("tese") or ""])
    x = tf.transform([_texto(texto, lida.get("classe"), None, None, None,
                             cru=True)])

    nos = []

    def anda(i, nivel):
        folha = t.children_left[i] == -1
        # cortado != folha. Um no' que a tela para de desenhar continua tendo
        # galho embaixo, e chama-lo de folha seria dizer que a decisao terminou
        # ali. A tela distingue os dois.
        cortado = (not folha) and nivel >= NIVEIS_ARVORE
        v = t.value[i][0]
        tot = float(v.sum()) or 1.0
        no = {"id": str(i), "nivel": nivel,
              "gini": round(float(t.impurity[i]), 3),
              "n": int(t.n_node_samples[i]),
              "dist": [round(float(c) / tot, 3) for c in v],
              "classe": classes[int(v.argmax())],
              "folha": bool(folha), "cortado": bool(cortado)}
        if not folha:
            no["termo"] = str(vocab[t.feature[i]])
            no["limiar"] = round(float(t.threshold[i]), 4)
        if not folha and not cortado:
            no["esq"] = str(t.children_left[i])
            no["dir"] = str(t.children_right[i])
        nos.append(no)
        if not folha and not cortado:
            anda(t.children_left[i], nivel + 1)
            anda(t.children_right[i], nivel + 1)

    anda(0, 0)

    # Por onde ESTE caso desce, ate' onde a tela desenha. Vai junto o valor
    # TF-IDF que o caso tem no termo de cada corte: e' o que deixa a narracao
    # dizer POR QUE o galho foi aquele, em vez de so' apontar o galho.
    caminho, i, nivel = [], 0, 0
    while True:
        no = {"id": str(i)}
        if t.children_left[i] != -1 and nivel < NIVEIS_ARVORE:
            val = float(x[0, t.feature[i]])
            no["valor"] = round(val, 4)
            no["esquerda"] = bool(val <= t.threshold[i])
        caminho.append(no)
        if "esquerda" not in no:
            break
        i = (t.children_left[i] if no["esquerda"] else t.children_right[i])
        nivel += 1

    return {"nos": nos, "caminho": caminho, "classes": classes,
            "arvores": len(rf.estimators_),
            "niveis": NIVEIS_ARVORE,
            "profundidade": int(est.get_depth()),
            "nos_total": int(t.node_count),
            # a raiz nao ve' o acervo inteiro: cada arvore treina num sorteio
            # com reposicao (bootstrap). Sem este par de numeros a tela sugere
            # que a arvore leu as 7.545 decisoes, e ela nao leu.
            "n_raiz": int(t.n_node_samples[0]),
            "n_treino": int(m["n_treino"]),
            "ano_corte": int(m["ano_corte"])}


# ------------------------------------------------------------------- confronto

# EDITORIAL: o alinhamento entre a decisao real e a gerada. Cada linha aponta o
# trecho de cada lado; "bate" e' julgamento de leitura, e o que NAO bate fica.
CONFRONTO = [
    {"elemento": "Admissibilidade",
     "real": "O recurso deve ser conhecido, porquanto preenchidos os requisitos "
             "intrínsecos e extrínsecos de admissibilidade.",
     "gerada": "O recurso deve ser conhecido. Preenchidos estão os requisitos "
               "intrínsecos e extrínsecos de admissibilidade, não havendo óbice à "
               "sua análise de mérito.",
     "bate": True},
    {"elemento": "O erro da decisão recorrida",
     "real": "o magistrado da origem tenha entendido ser necessário comprovar o "
             "esgotamento das possibilidades de localização da parte contrária",
     "gerada": "O magistrado de origem indeferiu o pleito, sustentando, em síntese, "
               "a necessidade de esgotamento prévio de todos os meios de localização "
               "do devedor",
     "bate": True},
    {"elemento": "Fundamento legal",
     "real": "Exegese do art. 830 do Código de Processo Civil",
     "gerada": "Esta posição encontra lastro no artigo 830 do Código de Processo Civil",
     "bate": True},
    {"elemento": "Fato determinante",
     "real": "o exequente tentou localizar os executados no endereço informado no "
             "evento 26.1, bem como em outros endereços, no entanto não foi possível "
             "localizá-los",
     "gerada": "os executados não foram localizados para citação no endereço "
               "constante dos autos",
     "bate": True},
    {"elemento": "DISPOSITIVO",
     "real": "Ante o exposto, voto no sentido de dar provimento ao recurso para "
             "deferir o pedido de arresto online por intermédio do sistema Sisbajud.",
     "gerada": "Ante o exposto, CONHEÇO do recurso e, no mérito, DOU-LHE PROVIMENTO "
               "para reformar a decisão agravada, determinando o deferimento do "
               "pedido de arresto online de valores por intermédio do sistema "
               "Sisbajud, nos termos do art. 830 do CPC.",
     "bate": True},
    {"elemento": "Precedente do STJ citado",
     "real": "REsp 1.822.034/SC, rela. Mina. Nancy Andrighi, Terceira Turma, "
             "j. 15/6/2021",
     "gerada": "REsp 1.112.943/MA — citação que NÃO estava entre os precedentes "
               "entregues ao redator",
     "bate": False,
     "nota": "O juiz automático do próprio sistema pegou isto e derrubou a nota de "
             "fidelidade para 3 de 5. Está impresso no relatório da consulta, não foi "
             "descoberto depois."},
    {"elemento": "Precedentes de outros relatores",
     "real": "cita acórdãos dos Des. Osmar Mohr, Silvio Franco e Rodolfo Tridapalli",
     "gerada": "cita só acórdãos do próprio Rubens Schulz",
     "bate": False,
     "nota": "Consequência direta do desenho: o acervo é de um relator só. O sistema "
             "não conhece os colegas dele."},
]


# ---------------------------------------------------------------------- main

def main():
    if "--congelar" in sys.argv:
        congelar()
        return
    txt = consulta(CASO["consulta"])
    prec = precedentes(txt)
    prog = prognostico(txt)
    cst = custo(txt)
    cnd = candidatos()
    with open(os.path.join(FONTES, "config_rag.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    lida = leitura(txt)
    real = acordao_real(CASO["numero"])
    with open(os.path.join(FONTES, "casos", CASO["peca"]), encoding="utf-8") as f:
        peca = f.read()

    assert prec, "não achei os precedentes no relatório — o formato mudou?"
    # o congelado tem de descrever a MESMA execução que o relatório: se as duas
    # fontes divergirem, a tela mistura duas consultas e ninguém percebe
    assert len(cnd["candidatos"]) == cst["candidatos"], \
        "o congelado tem %d candidatos e o relatório fala em %d — recongele" % (
            len(cnd["candidatos"]), cst["candidatos"])
    corte = cfg["busca"]["nota_minima"]
    assert sum(1 for c in cnd["candidatos"] if (c["nota"] or 0) >= corte) == cst["aprovados"], \
        "o corte de analogia %d/5 no congelado não dá os %d aprovados do relatório" % (
            corte, cst["aprovados"])
    assert prog["decide"], "a consulta da demo tem de ser uma em que o sistema DECIDE"
    assert prog["resultado"] == CASO["real"], \
        "o prognóstico (%s) não bate com o resultado real (%s)" % (
            prog["resultado"], CASO["real"])

    arv = arvore_floresta(cst, lida)
    if arv:
        # A arvore da floresta e' um passeio sobre arrays do sklearn, e passeio
        # errado nao quebra: ele desenha uma arvore plausivel e falsa. Estas
        # quatro travas custam nada e pegam os quatro jeitos de errar.
        no = {n["id"]: n for n in arv["nos"]}
        assert arv["nos"] and arv["nos"][0]["id"] == "0",             "a arvore da floresta nao comeca na raiz"
        for n in arv["nos"]:
            for lado in ("esq", "dir"):
                assert n.get(lado) is None or n[lado] in no,                     "o no %s aponta para um filho que nao foi emitido" % n["id"]
        ids = [x["id"] for x in arv["caminho"]]
        assert ids[0] == "0", "o caminho do caso nao comeca na raiz"
        for k, x in enumerate(arv["caminho"][:-1]):
            pai = no[x["id"]]
            assert (pai["esq"] if x["esquerda"] else pai["dir"]) == ids[k + 1],                 "o caminho do caso pula de galho em %s" % x["id"]
        assert arv["niveis"] <= arv["profundidade"]             and arv["n_raiz"] <= arv["n_treino"],             "a arvore diz mostrar mais do que tem"

    os.makedirs(DADOS, exist_ok=True)

    grava("apresentacao.json", {
        "caso": CASO, "triagem": TRIAGEM, "acervo": acervo(),
        # "execucao", nao "custo": depois do corte de valores este bloco carrega
        # tempo, tokens e modelos — chamá-lo de custo seria nome mentindo
        "leitura": lida, "prognostico": prog, "execucao": cst,
        "juiz": juiz(txt), "precedentes": prec,
        # a cascata do prognostico, congelada de api/serial.pesos — a seção
        # "A conta" a reencena passo a passo, sem recalcular nada
        "pesos": cnd["pesos"],
        "base_legal": base_legal(minuta(txt), real, cnd, cfg),
    })
    # a arvore real da floresta viaja DENTRO do grafo.json: artefato.py carrega
    # tres arquivos fixos, e um quarto obrigaria a mexer no empacotador para
    # nada — os dois desenhos da secao 03 saem da mesma fonte de qualquer jeito
    grava("grafo.json", dict(grafo(prec, cnd, prog, cst, cfg), arvore_rf=arv))
    grava("confronto.json", {
        "caso": CASO,
        "peca_entregue": peca,
        "real": real,
        "gerada": minuta(txt),
        "alinhamento": CONFRONTO,
        "batem": sum(1 for c in CONFRONTO if c["bate"]),
        "total": len(CONFRONTO),
    })
    print("OK — %d precedentes, prognóstico %.0f%% (%s), %d linhas de confronto%s"
          % (len(prec), 100 * prog["p"], prog["resultado"], len(CONFRONTO),
             (", árvore real com %d nós (%d de %d níveis)"
              % (len(arv["nos"]), arv["niveis"], arv["profundidade"])) if arv else ""))


def grava(nome, obj):
    obj = sem_dinheiro(obj)
    caminho = os.path.join(DADOS, nome)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    # trava: se um preco escapar para o JSON servido, isto quebra a montagem em
    # vez de deixar o numero chegar ao DevTools de quem assiste
    bruto = json.dumps(obj, ensure_ascii=False)
    assert "US$" not in bruto and "usd" not in bruto.lower(), \
        "valor monetário escapou para %s" % nome
    print("  %-22s %6.1f KB" % (nome, os.path.getsize(caminho) / 1024))


if __name__ == "__main__":
    main()
