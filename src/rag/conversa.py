"""Perguntar sobre uma consulta que ja' rodou. UMA chamada de LLM, centavos.

A consulta completa custa US$ 0,15-0,25 e leva minutos: cinco modelos, dois
ciclos de busca, um de revisao. Perguntar "por que voce citou o 0301...?" nao
pode custar isso. Este modulo responde em cima do que JA' esta' no checkpoint —
precedentes recuperados, prognostico, minuta — com um modelo barato.

O limite e' explicito e vai na resposta: aqui nao ha' busca nova. Se a pergunta
pede precedente que a recuperacao nao trouxe, a resposta correta e' dizer isso e
mandar rodar consulta nova, nao inventar.

    python -m src.rag.conversa        # self-check offline (nao chama LLM)
"""
from .grafo import recortar_caso
from .llm import chamar, config

MAX_HISTORICO = 8          # turnos que voltam no contexto
MAX_EMENTA = 700
MAX_MINUTA = 12000
# A pergunta pode vir com um documento anexado grudado nela (a web junta os dois
# num texto so'). Cortar em 4.000 como antes engolia a peca inteira em silencio e
# o modelo respondia sobre meia peca achando que tinha a peca toda. Depois que o
# anexo passou a aceitar PDF e DOCX, 12.000 tambem ficou apertado: uma peticao de
# 30 paginas tem ~60.000 caracteres e o modelo lia um quinto dela. 50.000 sao
# ~15k tokens no gemini-flash-lite — meio centavo a mais por pergunta.
MAX_PERGUNTA = 50000

P_CONVERSA = """Você responde perguntas sobre uma análise já feita, para um
advogado que está lendo o relatório. Seja direto e curto: ele já leu o material.

REGRAS DURAS — as mesmas do redator, e valem aqui igual:
- Fundamente APENAS com o que está abaixo. NÃO invente número de processo,
  súmula, tema repetitivo nem citação de outro tribunal.
- Ao citar um precedente, use exatamente o número que aparece na lista.
- NÃO há busca nova nesta conversa. Se a resposta exigir precedente que não está
  na lista, diga isso com todas as letras e sugira uma consulta nova — não
  preencha o buraco com o que você acha que existe.
- O prognóstico é interno ao sistema. Você PODE explicá-lo aqui (o usuário está
  perguntando sobre a análise), mas não o apresente como se fosse a posição do
  desembargador.
- O advogado pode anexar um documento junto com a pergunta. Quando isso acontecer,
  responda usando OS DOIS: a pergunta diz o que ele quer, o documento é o material
  dele. Mas o documento NÃO é do acervo — não o cite como precedente do relator,
  não o misture com a lista abaixo, e diga com todas as letras quando ele
  contradisser o que a análise concluiu.
{abstencao}
CASO ANALISADO:
{caso}

PROGNÓSTICO:
{prognostico}

PRECEDENTES RECUPERADOS:
{precedentes}
{minuta}{historico}
PERGUNTA:
{pergunta}
"""

R_ABSTEVE = """
ATENÇÃO: nesta consulta o sistema NÃO cravou um prognóstico — os dados não o
sustentavam. Não afirme um desfecho como provável nas suas respostas; se a
pergunta pedir um, explique por que o sistema se recusou.
"""


def _bloco_precedentes(estado):
    linhas = []
    for p in ((estado.get("precedentes") or [])
              + (estado.get("sustentacao") or [])):
        linhas.append(
            "- %s | %s | %s | %s | resultado: %s | analogia %s/5\n  %s"
            % (p.get("numero"), p.get("classe"), p.get("comarca"), p.get("data"),
               p.get("resultado"), p.get("nota"),
               (p.get("ementa") or p.get("dispositivo") or "")[:MAX_EMENTA]))
    return "\n".join(linhas) or "(nenhum precedente foi recuperado nesta consulta)"


def _bloco_prognostico(estado):
    p = estado.get("prognostico") or {}
    if not p:
        return "(não calculado)"
    if p.get("decide") is False:
        return ("NÃO DECIDO — %s" % "; ".join(p.get("confianca", {})
                                              .get("por_que") or ["—"]))
    partes = []
    if p.get("probabilidade_pct") is not None:
        partes.append("%.0f%% de chance de reforma%s"
                      % (p["probabilidade_pct"],
                         " (calibrado)" if p.get("calibrado") else " (não calibrado)"))
    if p.get("resultado_provavel"):
        partes.append("resultado mais provável: %s" % p["resultado_provavel"])
    if p.get("reforma_nos_precedentes") is not None:
        partes.append("k-NN sobre os precedentes: %.0f%%" % p["reforma_nos_precedentes"])
    rf = p.get("floresta")
    if rf:
        partes.append("Random Forest: %.0f%%" % (100 * rf["p_reforma"]))
    if p.get("acordo") is False:
        partes.append("OS DOIS ESTIMADORES DISCORDAM")
    return "; ".join(partes) or "(não calculado)"


def _cortar_pergunta(pergunta):
    """Corte visivel. Se o documento anexado nao coube, quem tem de avisar o
    advogado e' o modelo — cortar calado faz a resposta parecer completa."""
    if len(pergunta) <= MAX_PERGUNTA:
        return pergunta
    return pergunta[:MAX_PERGUNTA] + (
        "\n\n[CORTADO AQUI: o texto acima passou de %d caracteres e o resto não "
        "chegou até você. AVISE o advogado disso na resposta, e não responda como "
        "se tivesse lido o documento inteiro.]" % MAX_PERGUNTA)


def montar_prompt(estado, pergunta, historico=()):
    p = estado.get("prognostico") or {}
    minuta = estado.get("minuta") or ""
    hist = ""
    if historico:
        hist = "\nCONVERSA ATÉ AQUI:\n" + "\n".join(
            "%s: %s" % ("Advogado" if m["papel"] == "usuario" else "Você",
                        (m["texto"] or "")[:1500])
            for m in list(historico)[-MAX_HISTORICO:]) + "\n"
    return P_CONVERSA.format(
        abstencao=R_ABSTEVE if p.get("decide") is False else "",
        caso=recortar_caso(estado.get("caso"))[0],
        prognostico=_bloco_prognostico(estado),
        precedentes=_bloco_precedentes(estado),
        minuta=("\nMINUTA GERADA:\n%s\n" % minuta[:MAX_MINUTA]) if minuta else "",
        historico=hist,
        pergunta=_cortar_pergunta(pergunta))


def responder(estado, pergunta, historico=()):
    """(texto, custo). Uma chamada; o `no` 'conversa' vem de config_rag.json."""
    if not (pergunta or "").strip():
        raise ValueError("pergunta vazia")
    texto, custo = chamar("conversa", [{"role": "user",
                                        "content": montar_prompt(estado, pergunta,
                                                                 historico)}])
    return texto, custo


if __name__ == "__main__":
    estado = {
        "caso": "Apelação cível sobre prescrição intercorrente em execução fiscal.",
        "precedentes": [
            {"numero": "0301234-56.2020.8.24.0023", "classe": "Apelação Cível",
             "comarca": "Capital", "data": "2024-03-11", "resultado": "provido",
             "nota": 5, "ementa": "E" * 2000},
        ],
        "sustentacao": [
            {"numero": "0309999-11.2021.8.24.0038", "classe": "Apelação Cível",
             "comarca": "Joinville", "data": "2023-08-02", "resultado": "provido",
             "nota": 4, "ementa": "S" * 100},
        ],
        "prognostico": {"probabilidade_pct": 71.0, "calibrado": True, "decide": True,
                        "resultado_provavel": "provido",
                        "reforma_nos_precedentes": 80.0,
                        "floresta": {"p_reforma": 0.62}, "acordo": True},
        "minuta": "M" * 30000,
    }

    p = montar_prompt(estado, "Por que o 0301234 pesou mais?")
    assert "0301234-56.2020.8.24.0023" in p and "0309999-11.2021.8.24.0038" in p, \
        "a sustentação tem que entrar: o redator a recebeu e o usuário pode citá-la"
    assert "71%" in p and "Random Forest: 62%" in p, p[:400]
    assert "NÃO invente" in p and "não há busca nova" in p.lower()
    # os cortes tem que cortar: senao um turno barato custa uma consulta
    assert len(p) < 30000, len(p)
    assert "E" * MAX_EMENTA in p and "E" * (MAX_EMENTA + 1) not in p
    assert "M" * MAX_MINUTA in p and "M" * (MAX_MINUTA + 1) not in p

    # --- documento anexado: chega junto com a pergunta, nao no lugar dela
    doc = ("Isto contradiz o precedente 0301234?\n"
           "--- documento anexado: contrarrazoes.txt ---\n" + "D" * 3000)
    pd = montar_prompt(estado, doc)
    assert "contradiz o precedente" in pd and "D" * 3000 in pd, \
        "a pergunta E o documento tem que chegar — os dois, inteiros"
    assert "anexar um documento" in pd, "falta a regra de como tratar o anexo"

    # e quando nao couber, o corte tem que se anunciar: cortar calado faz a
    # resposta parecer completa quando o modelo leu meia peca
    pg = montar_prompt(estado, "P" * (MAX_PERGUNTA + 5000))
    assert "P" * MAX_PERGUNTA in pg and "P" * (MAX_PERGUNTA + 1) not in pg
    assert "CORTADO AQUI" in pg and "AVISE o advogado" in pg

    # --- abstencao: o aviso entra e o modelo e' proibido de cravar
    abst = dict(estado, prognostico={"decide": False,
                                     "confianca": {"por_que": ["margem estreita"]}})
    pa = montar_prompt(abst, "vai reformar?")
    assert "NÃO DECIDO" in pa and "margem estreita" in pa
    assert "NÃO cravou um prognóstico" in pa
    # e sem abstencao o aviso NAO entra
    assert "NÃO cravou um prognóstico" not in p

    # --- historico: entra, e so' os ultimos turnos
    h = [{"papel": "usuario", "texto": "pergunta %d" % i} for i in range(20)]
    ph = montar_prompt(estado, "e agora?", historico=h)
    assert "pergunta 19" in ph and "pergunta 0" not in ph
    assert ph.count("Advogado:") == MAX_HISTORICO

    # --- consulta sem precedente nenhum nao pode virar prompt vazio e mudo
    vazio = montar_prompt({"caso": "x"}, "e daí?")
    assert "nenhum precedente foi recuperado" in vazio

    try:
        responder(estado, "   ")
        raise AssertionError("aceitou pergunta vazia")
    except ValueError:
        pass

    assert config()["modelos"].get("conversa"), \
        "falta a chave modelos.conversa em config_rag.json"
    print("modelo de conversa: %s" % config()["modelos"]["conversa"])
    print("self-check OK — contexto sai do checkpoint, cortado, e sem busca nova")
