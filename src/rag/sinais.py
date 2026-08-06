"""Procedencia: o que sustenta um argumento, alem do texto dele.

Duas naturezas, duas funcoes:

  ficha(teor, mov)   propriedade do DOCUMENTO — calculada uma vez, na indexacao.
                     Idade, ancora (nacional x estadual), unanimidade, efeito
                     posterior no Datajud.

  perfil(consulta)   propriedade do ARGUMENTO consultado — calculada na hora.
                     Quantas vezes ja' foi usado, em que classes/comarcas, por
                     qual camara, com que taxa de reforma.

Nada aqui usa LLM nem rede. Custo zero, resultado deterministico — e' por isso
que da' para colocar no relatorio como fato, e nao como opiniao do modelo.

Limite declarado: o corpus e' 100% TJSC, de um relator so'. Da' para dizer se a
ancora do argumento e' nacional ou estadual; NAO da' para dizer "em quais outros
estados vale". Quem quiser isso precisa raspar outros tribunais.
"""
import json
import os
import re
import sqlite3
import sys

from .busca import RAG, _db

# ---------------------------------------------------------------- ancora

# Tema numerado e' sempre repetitivo (STJ) ou repercussao geral (STF): os dois
# vinculam todo o pais. Sumula vinculante idem, por definicao constitucional.
_VINCULANTE = re.compile(
    r"(?i)"
    r"s[uú]mula\s+vinculante"
    r"|tema[s]?\s+(?:n[.ºo°]*\s*)?\d{2,4}"
    r"|recursos?\s+repetitivos?"
    r"|art(?:igo)?\.?\s*1\.?036"
    r"|repercuss[ãa]o\s+geral"
    r"|\bIRDR\b|\bIAC\b|incidente\s+de\s+resolu[çc][ãa]o\s+de\s+demandas")

# Sumula comum e precedente de corte superior: persuadem, nao vinculam.
_PERSUASIVA = re.compile(
    r"(?i)s[uú]mula\s+(?:n[.ºo°]*\s*)?\d{1,4}"
    r"|\b(?:REsp|AREsp|AgInt|AgRg|EDcl)\b"
    r"|Superior\s+Tribunal\s+de\s+Justi[çc]a|Supremo\s+Tribunal\s+Federal")

# Identificadores para mostrar no relatorio: "Tema 1059/STJ" diz mais que
# "vinculante". So' o rotulo faz o usuario ter que ir conferir na mao.
_IDS = re.compile(
    r"(?i)(?:s[uú]mula\s+vinculante\s+(?:n[.ºo°]*\s*)?\d{1,3}"
    r"|tema[s]?\s+(?:n[.ºo°]*\s*)?\d{2,4}(?:\s*/\s*ST[JF])?"
    r"|s[uú]mula\s+(?:n[.ºo°]*\s*)?\d{1,4}(?:\s*(?:/|\s+d[oe]\s+)\s*ST[JF])?"
    r"|\bIRDR\b|\bIAC\b)")


def _ancora(teor):
    if not teor:
        return "estadual", []
    ids = []
    for m in _IDS.finditer(teor):
        t = " ".join(m.group(0).split())
        if t not in ids:
            ids.append(t)
        if len(ids) >= 8:
            break
    if _VINCULANTE.search(teor):
        return "vinculante", ids
    if _PERSUASIVA.search(teor):
        return "persuasiva", ids
    return "estadual", ids


# ------------------------------------------------------------ unanimidade

# Ordem importa: "por maioria, vencido o Des. X" costuma vir junto de um
# "a unanimidade" de outro capitulo do julgamento. Divergencia manda.
_DIVERGIU = re.compile(
    r"(?i)por\s+maioria"
    r"|vencid[oa]s?\s+(?:o|a|os|as)\s+(?:Exm|Des|Sr)"
    r"|voto\s+divergente|declara[çc][ãa]o\s+de\s+voto")
_UNANIME = re.compile(r"(?i)[àa]\s+unanimidade|un[âa]nime")


def _unanimidade(teor):
    """1 unanime, 0 divergiu, None nao da' para saber."""
    if not teor:
        return None
    if _DIVERGIU.search(teor):
        return 0
    return 1 if _UNANIME.search(teor) else None


# ---------------------------------------------------------------- efeito

_TRANSITO = re.compile(r"(?i)tr[âa]nsito\s+em\s+julgado|baixa\s+definitiva")
_SUBIU = re.compile(r"(?i)recurso\s+(?:especial|extraordin[áa]rio)")
_SOBRESTADO = re.compile(
    r"(?i)sobrestad|sobrestamento|suspens[ãa]o\s+ou\s+sobrestamento"
    r"|afeta[çc][ãa]o\s+ao\s+rito|demandas\s+repetitivas")


def _efeito(nomes):
    """O que aconteceu DEPOIS, pelos movimentos do Datajud.

    transitou  = ninguem levou adiante; a tese ficou de pe'.
    subiu      = foi para STJ/STF. Se subiu e nao transitou, esta' contestada.
    sobrestado = a tese esta' parada por controversia nacional.
    """
    if not nomes:
        return None
    t = " | ".join(n for n in nomes if n)
    return {"transitou": bool(_TRANSITO.search(t)),
            "subiu": bool(_SUBIU.search(t)),
            "sobrestado": bool(_SOBRESTADO.search(t))}


def ficha(teor, movimentos=()):
    """A ficha de procedencia de uma decisao. `movimentos` = nomes do Datajud."""
    anc, ids = _ancora(teor)
    ef = _efeito(movimentos)
    return {"ancora": anc,
            "ancoras": ids,
            "unanime": _unanimidade(teor),
            "efeito": ef}


def movimentos_por_processo(tjsc):
    """{numero_processo: [nomes]} — so' os movimentos que importam para o efeito.

    994 mil movimentos no banco, 99% deles 'Peticao'/'Documento'/'Conclusao'.
    Filtrar no SQL evita carregar tudo na memoria por nada.
    """
    db = sqlite3.connect("file:%s?mode=ro" % tjsc.replace("\\", "/"), uri=True)
    m = {}
    for num, nome in db.execute(
            "SELECT numero_processo, nome FROM movimentos WHERE nome IS NOT NULL "
            "AND (nome LIKE '%r%nsito em julgado%' OR nome LIKE '%Baixa Definitiva%' "
            "OR nome LIKE '%Recurso Especial%' OR nome LIKE '%Recurso especial%' "
            "OR nome LIKE '%Recurso Extraordin%' OR nome LIKE '%Recurso extraordin%' "
            "OR nome LIKE '%obrestad%' OR nome LIKE '%obrestamento%' "
            "OR nome LIKE '%Afeta%' OR nome LIKE '%Demandas Repetitivas%')"):
        m.setdefault(num, []).append(nome)
    db.close()
    return m


# ------------------------------------------------- perfil do argumento

_TOPO = 5


def perfil(consulta, banco=RAG):
    """Quantas vezes esse argumento ja' apareceu, onde e com que desfecho.

    Uma agregacao FTS5 sobre o indice inteiro (~130 ms medidos em 20 mil
    decisoes) — cabe dentro da consulta sem o usuario sentir.
    """
    if not (consulta or "").strip():
        return {}
    db = _db(banco)
    merito = ("AND d.resultado IN ('provido','parcialmente provido','desprovido')")
    juncao = ("FROM decisao_fts JOIN decisao d ON d.id = decisao_fts.rowid "
              "WHERE decisao_fts MATCH ?")
    try:
        n, ref, ini, fim = db.execute(
            "SELECT count(*), sum(d.resultado IN ('provido','parcialmente provido')),"
            " min(d.ano), max(d.ano) %s %s" % (juncao, merito), (consulta,)).fetchone()
        grupos = {}
        for campo in ("classe", "orgao", "comarca"):
            grupos["por_" + campo] = [
                (v or "?", c) for v, c in db.execute(
                    "SELECT d.%s, count(*) c %s GROUP BY 1 ORDER BY c DESC LIMIT %d"
                    % (campo, juncao, _TOPO), (consulta,))]
        vinc, = db.execute(
            "SELECT count(*) %s AND d.ancora='vinculante'" % juncao, (consulta,)).fetchone()
        div, = db.execute(
            "SELECT count(*) %s AND d.unanime=0" % juncao, (consulta,)).fetchone()
    except sqlite3.OperationalError as e:
        print("perfil falhou (%s)" % e, file=sys.stderr)
        return {}
    return {"usos": n or 0,
            "primeiro_ano": ini, "ultimo_ano": fim,
            "reforma_pct": round(100 * ref / n, 1) if n else None,
            "com_ancora_nacional": vinc or 0,
            "nao_unanimes": div or 0,
            **grupos}


def contra_argumentacao(candidatos):
    """Quem discorda, dentro do que a busca trouxe.

    A divergencia interna (voto vencido) e' rara — 3% das decisoes. O sinal
    abundante e' outro: decisoes analogas que terminaram no resultado OPOSTO ao
    majoritario. E' isso que o redator precisa enfrentar, nao ignorar.
    """
    merito = [c for c in candidatos
              if c.get("resultado") in ("provido", "parcialmente provido", "desprovido")]
    if not merito:
        return {"contra": 0, "exemplos": [], "lado_majoritario": None}
    reforma = sum(c["resultado"] != "desprovido" for c in merito)
    # Metade a metade nao tem lado majoritario. Chamar um dos dois de
    # "majoritario" num empate e' inventar uma tendencia que os dados nao tem —
    # e e' justamente o caso em que o usuario mais precisa saber que esta' 50/50.
    empate = reforma * 2 == len(merito)
    majoritario = None if empate else (
        "reforma" if reforma * 2 > len(merito) else "manutencao")
    oposto = [] if empate else [
        c for c in merito
        if (c["resultado"] != "desprovido") != (majoritario == "reforma")]
    fracos = [c for c in merito if c.get("unanime") == 0]
    return {"contra": (len(merito) if empate else len(oposto)),
            "de": len(merito),
            "empate": empate,
            "lado_majoritario": majoritario,
            "nao_unanimes": len(fracos),
            "exemplos": [{"numero": c["numero"], "data": c.get("data"),
                          "resultado": c["resultado"]}
                         for c in (merito if empate else oposto)[:3]]}


def comuns(decisoes, minimo=2):
    """O que se REPETE num conjunto de decisoes do mesmo lado.

    Serve a linha de argumentacao (--tese): dado um punhado de precedentes que
    terminaram como o usuario quer, o que eles tem em comum e' o material de
    sustentacao. Tudo sai de campo indexado — nada de LLM, nada de inferencia.
    """
    if not decisoes:
        return {}
    anc, org, cls = {}, {}, {}
    un = tr = 0
    for d in decisoes:
        for a in json.loads(d.get("ancoras_json") or "[]"):
            anc[a] = anc.get(a, 0) + 1
        for mapa, chave in ((org, "orgao"), (cls, "classe")):
            v = d.get(chave)
            if v:
                mapa[v] = mapa.get(v, 0) + 1
        un += d.get("unanime") == 1
        ef = d.get("efeito")
        if isinstance(ef, str):
            ef = json.loads(ef) if ef else None
        tr += bool(ef and ef.get("transitou"))
    topo = lambda m: sorted(  # noqa: E731
        ((k, n) for k, n in m.items() if n >= minimo), key=lambda kv: -kv[1])[:_TOPO]
    return {"n": len(decisoes), "ancoras": topo(anc), "orgaos": topo(org),
            "classes": topo(cls), "unanimes": un, "transitaram": tr,
            "anos": sorted({d.get("ano") for d in decisoes if d.get("ano")})}


def resumir_ficha(d):
    """Uma linha legivel para o relatorio e para o prompt do redator."""
    ef = d.get("efeito")
    if isinstance(ef, str):
        ef = json.loads(ef) if ef else None
    partes = ["%s" % {"vinculante": "âncora nacional vinculante",
                      "persuasiva": "âncora nacional persuasiva",
                      "estadual": "âncora só estadual"}.get(d.get("ancora"), "âncora ?")]
    if d.get("ancoras_json"):
        ids = json.loads(d["ancoras_json"])
        if ids:
            partes[0] += " (%s)" % ", ".join(ids[:3])
    u = d.get("unanime")
    partes.append("unânime" if u == 1 else "por maioria/vencido" if u == 0
                  else "unanimidade não identificada")
    if ef:
        marcas = [k for k in ("transitou", "subiu", "sobrestado") if ef.get(k)]
        partes.append("Datajud: " + (", ".join(marcas) if marcas else "sem efeito posterior"))
    return " | ".join(partes)


if __name__ == "__main__":
    RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    TJSC = os.path.join(RAIZ, "output", "tjsc.db")

    # --- ancora: textos escritos a mao, para o teste nao depender do corpus
    assert _ancora("aplica-se o Tema 1059/STJ, julgado sob o rito dos repetitivos")[0] \
        == "vinculante"
    assert _ancora("nos termos da Súmula Vinculante n. 13")[0] == "vinculante"
    assert _ancora("conforme a Súmula 297 do STJ, o CDC aplica-se")[0] == "persuasiva"
    assert _ancora("precedente desta Segunda Câmara de Direito Civil")[0] == "estadual"
    assert "Tema 1059/STJ" in _ancora("aplica-se o Tema 1059/STJ ao caso")[1]

    assert _unanimidade("decidiu, por maioria, vencido o Des. Fulano") == 0
    assert _unanimidade("ACORDAM, à unanimidade, em negar provimento") == 1
    assert _unanimidade("texto sem qualquer marca de votacao") is None
    # divergencia manda sobre unanimidade: um capitulo unanime nao apaga o outro
    assert _unanimidade("à unanimidade quanto ao mérito e por maioria quanto aos "
                        "honorários") == 0

    e = _efeito(["Trânsito em julgado", "Baixa Definitiva"])
    assert e["transitou"] and not e["subiu"]
    e = _efeito(["Recurso Especial", "Sobrestado"])
    assert e["subiu"] and e["sobrestado"] and not e["transitou"]
    assert _efeito([]) is None

    # --- perfil: precisa do indice ja' construido
    from . import busca
    q = busca.montar_consulta(["prescrição intercorrente", "honorários recursais"])
    try:
        p = perfil(q)
    except sqlite3.OperationalError:
        print("indice sem as colunas novas — rode: python -m src.rag.indexar")
        raise SystemExit(1)
    assert p["usos"] > 100, p
    assert p["primeiro_ano"] and p["ultimo_ano"] >= p["primeiro_ano"]
    assert p["por_orgao"] and p["por_orgao"][0][1] > 0
    print("argumento usado %d vezes (%d–%d), reforma em %.1f%%, %d com âncora nacional"
          % (p["usos"], p["primeiro_ano"], p["ultimo_ano"], p["reforma_pct"],
             p["com_ancora_nacional"]))

    ca = contra_argumentacao([
        {"numero": "1", "resultado": "provido", "data": "2025-01-01"},
        {"numero": "2", "resultado": "provido", "data": "2025-01-02"},
        {"numero": "3", "resultado": "desprovido", "data": "2025-01-03", "unanime": 0},
    ])
    assert ca["lado_majoritario"] == "reforma" and ca["contra"] == 1, ca
    assert ca["exemplos"][0]["numero"] == "3" and ca["nao_unanimes"] == 1
    assert not ca["empate"]

    # metade a metade NAO tem lado majoritario — inventar um seria afirmar uma
    # tendencia que os dados nao mostram
    ca = contra_argumentacao([{"numero": "1", "resultado": "provido"},
                              {"numero": "2", "resultado": "desprovido"}])
    assert ca["empate"] and ca["lado_majoritario"] is None and ca["contra"] == 2, ca

    # so' processual (nao conhecido, prejudicado) nao gera tendencia nenhuma
    ca = contra_argumentacao([{"numero": "1", "resultado": "não conhecido"}])
    assert ca["contra"] == 0 and ca["lado_majoritario"] is None, ca

    # --- distribuicao real no indice, se ja' foi reindexado
    try:
        for a, c in _db(RAG).execute("SELECT ancora, count(*) c FROM decisao "
                                     "GROUP BY 1 ORDER BY c DESC"):
            print("  %-12s %6d" % (a, c))
    except sqlite3.OperationalError:
        print("  (reindexe para ver a distribuicao de ancoras)")
    print("self-check OK — ficha e perfil sem LLM, sem rede")
