"""Classificador do resultado do julgamento + extracao do dispositivo.

Portado do classifica5.py (fase 2 da analise). Os padroes foram extraidos do
proprio corpus e a regra central so ficou clara validando amostras a mao:

- DENTRO do dispositivo (depois de 'ANTE O EXPOSTO'), vale o PRIMEIRO verbo
  decisorio: a frase comeca decidindo e depois trata de honorarios, custas,
  intimacoes. Usar o ultimo fazia 'NEGA-SE PROVIMENTO ... FIXANDO-SE
  HONORARIOS' virar outra coisa.
- FORA do dispositivo (ementa ou texto sem marcador), vale o ULTIMO: a ementa
  narra o caso e so no fim conclui ('SUSCITACAO IMPROVIDA. RECURSO CONHECIDO E
  PROVIDO').

Outras licoes do corpus: os encliticos sao a forma dominante ('NEGAR-LHE
PROVIMENTO' 2.243x vs 'NEGAR PROVIMENTO' 1.318x); e INDEFIRO/DEFIRO (1a pessoa,
comuns nas monocraticas) NAO sao cobertas por 'INDEFER'/'DEFER' — a vogal muda.
"""
import re
import unicodedata

# Resultados que representam reforma da origem (usado pelo prognostico).
REFORMA = {"provido", "parcialmente provido"}
# Resultados de merito — os demais sao processuais e distorcem a taxa de reforma.
MERITO = REFORMA | {"desprovido"}


def normaliza(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).upper()


MARCADOR = re.compile(
    r"ANTE\s+O\s+EXPOSTO|DIANTE\s+DO\s+EXPOSTO|ISTO\s+POSTO|POSTO\s+ISSO|PELO\s+EXPOSTO"
    r"|ACORDAM|ACORDA\s+A|RESOLVEM|DECIDE-SE|FORTE\s+NO\s+EXPOSTO|EM\s+FACE\s+DO\s+EXPOSTO"
    r"|POR\s+TODO\s+O\s+EXPOSTO")

NEG = r"NEG(?:O|A|AR|OU|UE|UEM)(?:-SE|-LHES?|-O|-A)?\s+(?:PROVIMENTO|SEGUIMENTO)"
DAR = r"D(?:OU|A|AR|EU|E|EEM)(?:-SE|-LHES?|-O|-A)?\s+(?:PARCIAL\s+)?PROVIMENTO"

PADROES = [
    ("não conhecido", 5, r"\bNAO\s+(?:SE\s+)?CONHEC|\bNAO\s+CONHECIMENTO|\bINADMISSIV"),
    ("prejudicado", 5, r"\bPREJUDICAD[OA]S?"),
    ("parcialmente provido", 4,
     r"PARCIALMENTE\s+PROVID[OA]S?|PROVID[OA]S?\s+EM\s+PARTE|PARCIAL\s+PROVIMENTO"
     r"|PROVIMENTO\s+PARCIAL|EM\s+PARTE\s+PROVID[OA]S?|PARCIALMENTE\s+ACOLHID[OA]S?"
     r"|D(?:OU|A|AR|E)(?:-SE|-LHES?)?\s+PARCIAL\s+PROVIMENTO"
     r"|ACOLHER\s+(?:EM\s+PARTE|PARCIALMENTE)|PARCIALMENTE\s+DEFERID[OA]S?"),
    ("extinto/homologado", 4, r"\bEXTINT[OA]S?\b|\bHOMOLOG"),
    ("liminar/tutela indeferida", 3, r"\bINDEFER|\bINDEFIR"),
    ("liminar/tutela deferida", 3, r"\bDEFER(?:E|I|ID)|\bDEFIR"),
    ("desprovido", 2,
     NEG + r"|\bDESPROVID|\bIMPROVID|\bNAO\s+PROVID|\bNEGAD[OA]S?\s+PROVIMENTO"
     r"|\bDESPROVIMENTO|\bREJEIT|\bNAO\s+ACOLHID|\bDENEG|\bMANTID[OA]\s+A\s+SENTENCA"),
    ("provido", 1, DAR + r"|\bPROVID[OA]S?\b|\bACOLH|\bCONCED"),
]
PADROES = [(r, esp, re.compile(p)) for r, esp, p in PADROES]


def _decide(trecho, primeiro):
    """primeiro=True: vence o verbo mais proximo do inicio (regiao do dispositivo)."""
    achados = []
    for rotulo, esp, rx in PADROES:
        ms = list(rx.finditer(trecho))
        if ms:
            pos = ms[0].start() if primeiro else ms[-1].end()
            achados.append((pos, -esp if primeiro else esp, rotulo))
    if not achados:
        return None
    achados.sort()
    return achados[0][2] if primeiro else achados[-1][2]


def classificar(inteiro_teor, ementa):
    """Devolve (resultado, origem_do_trecho, trecho_usado)."""
    txt = normaliza(inteiro_teor or "")
    if len(txt) > 400:
        # do ultimo marcador para tras: o ultimo as vezes cai em texto sem verbo
        # decisorio (assinatura, rodape), e o dispositivo real esta no anterior
        for m in reversed(list(MARCADOR.finditer(txt))):
            trecho = txt[m.end():m.end() + 320]
            r = _decide(trecho, primeiro=True)
            if r:
                return r, "dispositivo", trecho
        r = _decide(txt, primeiro=False)
        return (r or "indefinido"), "texto completo", txt[-350:]
    em = re.sub(r"VOLTAR PARA PESQUISA.*$", "",
                re.sub(r"\(TJSC.*$", "", normaliza(ementa or "")))
    if not em.strip():
        return "sem texto", "-", ""
    return (_decide(em, primeiro=False) or "indefinido"), "ementa", em[-350:]


# --- limpeza para o indice --------------------------------------------------
# A ementa vinda do portal traz o cabecalho da listagem colado no texto. Nos
# acordaos ela e' um resumo de verdade; nas monocraticas o campo e' so o inicio
# do documento ("Inicio do documento: ..."), truncado com "[...] voltar para
# pesquisa". Sem cortar isso, o BM25 pontua o mesmo ruido nas 20 mil linhas.
_CORTE_INICIO = re.compile(
    r"(?:In[ií]cio do documento|Ementa)\s*:\s*(?:FECHAR\s*\[\s*X\s*\]\s*)*", re.I)
_CORTE_FIM = re.compile(
    r"\(TJSC,[^)]*\)\s*\.?\s*$|\[\.\.\.\]\s*voltar para pesquisa\s*$"
    r"|voltar para pesquisa\s*$", re.I)


def limpar_ementa(ementa):
    t = (ementa or "").replace("\xa0", " ")
    m = list(_CORTE_INICIO.finditer(t))
    if m:
        t = t[m[-1].end():]
    t = _CORTE_FIM.sub("", t)
    return re.sub(r"\s+", " ", t).strip()


# --- protecao contra vazamento ----------------------------------------------
# Qualquer teste ou modelo que use a ementa como ENTRADA precisa passar por aqui
# primeiro. A ementa termina concluindo ("PLEITO CONHECIDO E ACOLHIDO."), e essa
# frase e' exatamente de onde o rotulo saiu — treinar ou avaliar sem cortar isso
# mede a capacidade de copiar a resposta, nao a de prever.
_VAZA = re.compile("|".join(p.pattern for _, _, p in PADROES))


def sem_vazamento(texto, minimo=12, maximo=90, limite=None):
    """Segmentos do texto que NAO revelam o desfecho.

    `limite` corta a lista (o avaliador usa 10 termos de busca); sem limite,
    devolve tudo o que sobrou — que e' o que a floresta precisa para treinar.
    """
    saida = []
    for seg in re.split(r"[.;\n]", texto or ""):
        seg = " ".join(seg.split())
        if not (minimo <= len(seg) <= maximo):
            continue
        if _VAZA.search(normaliza(seg)):
            continue
        saida.append(seg)
        if limite and len(saida) >= limite:
            break
    return saida


def extrair_dispositivo(inteiro_teor, limite=1200):
    """Trecho a partir do ultimo marcador que contem verbo decisorio. '' se nao houver."""
    txt = (inteiro_teor or "").replace("\xa0", " ")
    if len(txt) < 400:
        return ""
    norm = normaliza(txt)
    # normaliza() colapsa espacos, entao as posicoes nao batem com txt cru;
    # localizamos no normalizado e devolvemos o trecho do normalizado mesmo —
    # o indice FTS nao precisa da acentuacao original.
    for m in reversed(list(MARCADOR.finditer(norm))):
        trecho = norm[m.start():m.start() + limite]
        if _decide(norm[m.end():m.end() + 320], primeiro=True):
            return trecho.strip()
    return ""


if __name__ == "__main__":
    # Self-check: os dois casos que a v4 errava, mais as invariantes da limpeza.
    a = "VISTOS. RELATORIO. " + "X " * 300 + \
        "ANTE O EXPOSTO, NEGA-SE PROVIMENTO AO RECURSO DE APELACAO INTERPOSTO, " \
        "FIXANDO-SE HONORARIOS RECURSAIS EM 12%."
    assert classificar(a, "")[0] == "desprovido", classificar(a, "")

    b = "VISTOS. " + "Y " * 300 + \
        "ANTE O EXPOSTO, INDEFIRO O PLEITO DE CONCESSAO DE EFEITO SUSPENSIVO."
    assert classificar(b, "")[0] == "liminar/tutela indeferida", classificar(b, "")

    # ementa: vence o ULTIMO verbo (a ementa narra e conclui no fim)
    c = "SUSCITACAO IMPROVIDA. RECURSO CONHECIDO E PROVIDO."
    assert classificar("", c)[0] == "provido", classificar("", c)

    assert limpar_ementa(
        "Processo: 1 (Decisao) Relator: Rubens Schulz Inicio do documento: "
        "AGRAVO DE INSTRUMENTO. [...] voltar para pesquisa") == "AGRAVO DE INSTRUMENTO."
    assert limpar_ementa(
        "APELACAO CIVEL. RECURSO PROVIDO. (TJSC, Apelacao n. 1, rel. Rubens Schulz).") \
        == "APELACAO CIVEL. RECURSO PROVIDO."
    assert limpar_ementa("Ementa: FECHAR [ X ] FECHAR [ X ] RECURSO ADMINISTRATIVO.") \
        == "RECURSO ADMINISTRATIVO."

    assert "NEGA-SE PROVIMENTO" in extrair_dispositivo(a)
    assert extrair_dispositivo("texto curto") == ""

    print("self-check OK")
