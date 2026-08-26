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

from .busca import RAG, _db, _exigir

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


# ------------------------------------------------------------------- leis

# Dispositivo legal e' outra natureza de autoridade: a ancora diz que outro
# TRIBUNAL ja' decidiu assim, a lei diz o que o legislador escreveu. Juntar as
# duas num balde so' seria afirmar que se equivalem. Por isso coluna propria no
# indice, no' proprio no grafo, e bloco proprio no prompt do redator.
#
# Extracao literal, sem catalogo de normas: sai o que o acordao ESCREVEU. Se o
# tribunal errou o numero — e erra: um acordao do acervo cita "Lei 98.906/94"
# onde quis dizer 8.906/94 — o rotulo sai errado igual. Consertar em silencio
# seria a ficha divergir do documento que ela descreve.

# O carimbo de assinatura fecha TODO documento do TJSC e cita a Lei 11.419/2006.
# Nao e' fundamento — e' rodape de sistema. Cai na FONTE e nao na tela: uma lei
# presente em todo precedente viraria a mais citada do acervo e envenenaria a
# contagem que vai para o redator. Recorta-se o BLOCO, e nao o numero da lei:
# quem citar a 11.419 de verdade, no meio do voto, continua sendo contado.
#
# Sao dois carimbos, e o segundo so' apareceu depois de indexar o acervo inteiro:
# o eproc escreve "Documento eletronico assinado por FULANO, ... na forma do
# artigo 1o, inciso III, da Lei 11.419"; os acordaos antigos escrevem apenas
# "Documento assinado digitalmente / Lei n. 11.419/2006". Cobrindo so' o
# primeiro, sobravam 2.952 decisoes citando a lei do processo eletronico como se
# fosse fundamento — teria sido a 2a norma mais citada do acervo.
_RUIDO = re.compile(
    r"(?i)Documento\s+(?:eletr[ôo]nico\s+)?assinado\s+(?:por|digitalmente).{0,500}",
    re.S)

# Ordem importa: "codigo de processo civil" tem de ser tentado antes de "codigo
# civil", senao o segundo casa dentro do primeiro e o art. 487 do CPC vira CC.
#
# O artigo ("do"/"da") vai junto porque o rotulo e' lido por advogado: codigo e'
# masculino, Constituicao e CLT sao femininas, e "art. 5o do CF" denuncia na
# primeira linha que quem escreveu a tela nao le' o que ela imprime.
_CODIGOS = (
    (r"c[óo]digos?\s+de\s+processo\s+civil|\bN?CPC\b", "CPC", "do"),
    (r"c[óo]digos?\s+de\s+defesa\s+do\s+consumidor|\bCDC\b", "CDC", "do"),
    (r"c[óo]digos?\s+de\s+processo\s+penal|\bCPP\b", "CPP", "do"),
    (r"c[óo]digos?\s+tribut[áa]rios?\s+nacional|\bCTN\b", "CTN", "do"),
    (r"consolida[çc][ãa]o\s+das\s+leis\s+do\s+trabalho|\bCLT\b", "CLT", "da"),
    (r"constitui[çc][ãa]o\s+(?:federal|da\s+rep[úu]blica)|\bCF\s*/\s*88\b|\bCRFB\b",
     "CF", "da"),
    (r"c[óo]digos?\s+civil|\bCC\b", "CC", "do"),
    (r"c[óo]digos?\s+penal|\bCP\b", "CP", "do"),
)
_CODIGO = re.compile("(?i)(?:%s)" % "|".join(
    "(?P<c%d>%s)" % (i, c[0]) for i, c in enumerate(_CODIGOS)))
_SIGLA = {"c%d" % i: (c[2], c[1]) for i, c in enumerate(_CODIGOS)}

# O espaco em volta do numero e' "branco menos quebra de linha", e as duas
# metades custaram um erro cada. Com \s puro, um "art. 5" no fim da linha engolia
# a quebra e a janela abaixo comecava no paragrafo SEGUINTE — o artigo casava com
# a sigla do proximo assunto. Com [ \t] puro, "artigo\xa085" parava de casar: o
# inteiro teor do TJSC usa espaco inquebravel o tempo todo. Um erro foi pego pelo
# self-check, o outro pelo confronto com os acordaos do acervo.
_ART = re.compile(
    r"(?i)\bart(?:igos?|s?\.|\.|s)[^\S\r\n]*(\d{1,3}(?:\.\d{3})?)"
    r"[^\S\r\n]*([ºo°]?)")

# "Decreto-Lei n. 911/69" NAO e' "Lei 911/69": sao normas diferentes, e a busca
# e apreensao de bem alienado fiduciariamente mora na primeira. O prefixo entra
# no rotulo, senao a tela cita a norma errada com a cara de quem conferiu.
_LEI = re.compile(
    r"(?i)\b(decretos?[\s-]*)?lei\s+(?:complementar\s+)?(?:n[.ºo°]*\s*)?"
    r"(\d{1,3}(?:\.\d{3})?)\s*(?:[/-]\s*|,?\s*de\s+\d{1,2}\s+de\s+\w+\s+de\s+)"
    r"(\d{2,4})")


def leis(teor, limite=8):
    """Os dispositivos legais citados, no rotulo canonico.

    "art. 830 do Código de Processo Civil" e "art. 830, CPC" sao a mesma coisa e
    tem de sair com a mesma cara — senao a contagem que chega ao redator conta
    duas leis onde ha' uma.

    A sigla so' vale se estiver PERTO do artigo: a janela de 90 caracteres nao
    atravessa quebra de linha nem ponto-e-virgula. Sem esse limite um "art. 5"
    solto no fim de um paragrafo gruda no primeiro "CPC" do paragrafo seguinte,
    e a ficha passa a afirmar uma citacao que o acordao nao fez.

    O teto de 8 e' o mesmo de _ancora, pela mesma razao: isto vai para dentro de
    um prompt, e uma lista de 40 artigos afoga o que importa.
    """
    if not teor:
        return []
    t = _RUIDO.sub(" ", teor)
    achados = []
    for m in _ART.finditer(t):
        janela = t[m.end():m.end() + 90].split("\n")[0].split(";")[0]
        c = _CODIGO.search(janela)
        if not c:
            continue
        artigo, sigla = _SIGLA[c.lastgroup]
        achados.append("art. %s%s %s %s" % (
            m.group(1), "º" if m.group(2) else "", artigo, sigla))
    for m in _LEI.finditer(t):
        ano = m.group(3)
        if len(ano) == 2:
            # o acervo vai de 2000 a 2026 e cita norma de 1916 em diante; 30 e'
            # o corte que separa "/16" de Codigo Civil de "/16" de lei recente
            ano = ("19" if int(ano) > 30 else "20") + ano
        achados.append("%sLei %s/%s" % (
            "Decreto-" if m.group(1) else "", m.group(2), ano))
    saida = []
    for a in achados:
        if a not in saida:
            saida.append(a)
        if len(saida) >= limite:
            break
    return saida


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
            "leis": leis(teor),
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


def perfil(consulta, banco=None):
    """Quantas vezes esse argumento ja' apareceu, onde e com que desfecho.

    Uma agregacao FTS5 sobre o indice inteiro (~130 ms medidos em 20 mil
    decisoes) — cabe dentro da consulta sem o usuario sentir.

    Atencao ao nome: este `perfil` e' o do ARGUMENTO, e nao tem relacao com o
    cerebro (o relator). Sao dois "perfis" diferentes e eles convivem no mesmo
    estado do grafo — ver src/cerebros.py.
    """
    banco = _exigir(banco)
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
    from .. import cerebros

    cam = cerebros.caminhos()
    TJSC = cam["tjsc"]

    # --- ancora: textos escritos a mao, para o teste nao depender do corpus
    assert _ancora("aplica-se o Tema 1059/STJ, julgado sob o rito dos repetitivos")[0] \
        == "vinculante"
    assert _ancora("nos termos da Súmula Vinculante n. 13")[0] == "vinculante"
    assert _ancora("conforme a Súmula 297 do STJ, o CDC aplica-se")[0] == "persuasiva"
    assert _ancora("precedente desta Segunda Câmara de Direito Civil")[0] == "estadual"
    assert "Tema 1059/STJ" in _ancora("aplica-se o Tema 1059/STJ ao caso")[1]

    # --- leis: as quatro grafias do mesmo artigo caem no mesmo rotulo
    for v in ("art. 830 do Código de Processo Civil", "artigo 830 do CPC",
              "art. 830, caput, do CPC", "arts. 830 e seguintes do NCPC"):
        assert leis(v) == ["art. 830 do CPC"], (v, leis(v))
    assert leis("art. 6º do CDC e art. 421 do Código Civil") == \
        ["art. 6º do CDC", "art. 421 do CC"]
    # codigo e' "do", Constituicao e CLT sao "da"
    assert leis("art. 5º da Constituição Federal") == ["art. 5º da CF"]
    # "codigo de processo civil" contem "civil": a ordem de _CODIGOS decide
    assert leis("nos termos do art. 487 do Código de Processo Civil") == \
        ["art. 487 do CPC"]
    # Decreto-Lei 911 e Lei 911 sao normas diferentes
    assert leis("o art. 3º do Decreto-Lei n. 911/69 autoriza") == \
        ["Decreto-Lei 911/1969"], leis("o art. 3º do Decreto-Lei n. 911/69 autoriza")
    assert leis("na forma da Lei n. 11.101/2005") == ["Lei 11.101/2005"]
    # artigo sem codigo por perto nao vira citacao — e a janela nao atravessa
    # a quebra de linha atras de uma sigla do paragrafo seguinte
    assert leis("descumpriu o art. 5 do contrato") == []
    assert leis("violou o art. 5\nOutro tema: aplica-se o CPC") == []
    # o inteiro teor do TJSC separa "artigo" do numero com espaco inquebravel
    assert leis("nos termos do artigo\xa085, § 11, do Código de Processo Civil") == \
        ["art. 85 do CPC"]
    # os DOIS carimbos de assinatura: o do eproc e o dos acordaos antigos.
    # Nenhum e' fundamento, e o segundo custou uma reindexacao para aparecer.
    assert leis("Documento eletrônico assinado por FULANO, Desembargador Relator, "
                "na forma do artigo 1º, inciso III, da Lei 11.419, de 19 de "
                "dezembro de 2006. A conferência") == []
    assert leis("Rubens Schulz \n Relator \n Documento assinado digitalmente \n "
                "Lei n. 11.419/2006 \n") == []
    # mas a mesma lei citada de verdade, fora do carimbo, continua contando
    assert leis("aplica-se a Lei 11.419/2006 ao processo eletrônico") == \
        ["Lei 11.419/2006"]
    assert leis("") == [] and leis(None) == []

    # a ficha carrega as leis junto do resto — e' a unica porta do modulo
    f = ficha("nos termos do art. 830 do CPC, à unanimidade")
    assert f["leis"] == ["art. 830 do CPC"] and f["unanime"] == 1, f

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
        p = perfil(q, banco=cam["rag"])
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
