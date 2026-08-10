"""LLM-as-a-judge, em dois modos — e a diferença entre eles importa muito.

MODO COM REFERÊNCIA (o forte, usado no bench). Para casos que ele já julgou, a
decisão verdadeira existe. O juiz não opina sobre qual minuta é "melhor": ele
compara a minuta com o que o desembargador realmente escreveu. Isso derruba as
patologias conhecidas do juiz-LLM — viés de tamanho, viés de posição,
autopreferência — porque a nota passa a ser sobre concordância com um fato, não
sobre gosto.

MODO SEM REFERÊNCIA (o fraco, usado nas consultas reais). Caso novo não tem
gabarito; sobra checar a minuta contra os precedentes e o caso. Só verifica
coerência interna e fidelidade à fonte. NÃO diz se a decisão está juridicamente
certa e não deve ser lida como se dissesse.

Uma regra fixa: o juiz nunca é do mesmo fornecedor que o redator sendo julgado
(ver `juiz_para()`).
"""
import json

from .llm import chamar, config, json_da_resposta

CRITERIOS = {
    "dispositivo": "o desfecho da minuta é o mesmo da decisão real (0 = oposto, "
                   "5 = idêntico incluindo a extensão: parcial x total)",
    "fundamentos": "os fundamentos jurídicos invocados coincidem com os da "
                   "decisão real (0 = nenhum, 5 = os mesmos, na mesma ordem de peso)",
    "cobertura":   "todos os pedidos e preliminares do caso foram enfrentados",
    "fidelidade":  "nada foi inventado: toda citação de precedente, súmula ou "
                   "tese existe na lista fornecida (0 = inventou, 5 = tudo confere)",
    "estilo":      "estrutura e vocabulário compatíveis com a decisão real",
}

P_COM_REF = """Você avalia uma minuta gerada por IA contra a decisão REAL que o
{titulo} {relator} proferiu no mesmo caso. Não julgue qual texto é mais
bonito — julgue o quanto a minuta chegou onde ele chegou.

Dê nota 0 a 5 em cada critério:
{criterios}

Devolva SOMENTE um JSON:
{{"notas": {{"dispositivo": 0-5, "fundamentos": 0-5, "cobertura": 0-5,
             "fidelidade": 0-5, "estilo": 0-5}},
  "dispositivo_real": "o desfecho da decisão real em 3 palavras",
  "dispositivo_minuta": "o desfecho da minuta em 3 palavras",
  "resumo": "uma frase sobre a maior divergência"}}

PRECEDENTES QUE A MINUTA PODIA CITAR: {numeros}

=== DECISÃO REAL (gabarito) ===
{real}

=== MINUTA GERADA ===
{minuta}
"""

P_SEM_REF = """Você avalia uma minuta gerada por IA. NÃO existe gabarito: julgue
só o que dá para verificar contra as fontes fornecidas.

Dê nota 0 a 5 em cada critério:
- cobertura: todos os pedidos e preliminares do caso foram enfrentados
- fidelidade: nada foi inventado — toda citação de precedente existe na lista
- coerencia: o dispositivo decorre da fundamentação escrita
- ancoragem: a fundamentação usa os precedentes ou só os cita de enfeite

Devolva SOMENTE um JSON:
{{"notas": {{"cobertura": 0-5, "fidelidade": 0-5, "coerencia": 0-5, "ancoragem": 0-5}},
  "resumo": "uma frase sobre o ponto mais fraco"}}

PRECEDENTES QUE A MINUTA PODIA CITAR: {numeros}
{abstencao}
=== CASO ===
{caso}

=== MINUTA ===
{minuta}
"""

# Sem este aviso o juiz penaliza exatamente o comportamento que o sistema pediu.
# Aconteceu na primeira consulta real da fase 4: nota 2 em "coerencia" com o
# comentario "o dispositivo condicional nao define qual caminho julga o recurso"
# — que e' a descricao literal do que o redator foi mandado fazer.
P_ABSTENCAO = """
IMPORTANTE — MODO SEM PROGNÓSTICO: neste caso os dados não sustentavam uma
previsão, e o redator foi EXPRESSAMENTE instruído a não afirmar um desfecho como
provável, expondo os dois caminhos possíveis e o ponto concreto de que o caso
depende. Portanto:
- dispositivo condicional ou em dois cenários é o comportamento CORRETO aqui,
  não um defeito. Não penalize por isso.
- avalie "coerencia" como: cada caminho decorre da fundamentação que o sustenta?
- avalie se o ponto decisivo apontado é concreto e verificável nos autos, em vez
  de uma ressalva genérica.
"""


def juiz_para(modelo_redator):
    """O juiz nunca é do mesmo fornecedor do redator: um modelo julgando a si
    mesmo se dá nota alta (autopreferência é o viés mais documentado do
    juiz-LLM). Se colidir, cai para o reserva."""
    cfg = config()
    juiz = cfg["modelos"].get("juiz", "")
    if juiz.split("/")[0] == (modelo_redator or "").split("/")[0]:
        return cfg["modelos"].get("juiz_reserva", juiz)
    return juiz


def avaliar(minuta, numeros, caso=None, decisao_real=None, modelo_redator=None,
            absteve=False, titulo="Desembargador", relator=None):
    """Devolve (dict de notas, custo). Com `decisao_real`, usa o modo forte.

    `absteve` avisa que a minuta foi escrita sob instrucao de NAO cravar um
    desfecho — sem isso o juiz desconta nota pelo dispositivo condicional, que
    e' justamente o que se pediu.

    `relator` e' de quem e' o gabarito. Sem ele o juiz do cerebro B avaliaria a
    minuta contra o estilo do cerebro A — nome errado no criterio "estilo".
    """
    modelo = juiz_para(modelo_redator)
    if decisao_real:
        p = P_COM_REF.format(
            titulo=titulo, relator=relator or "relator",
            criterios="\n".join("- %s: %s" % (k, v) for k, v in CRITERIOS.items()),
            numeros=", ".join(numeros) or "(nenhum)",
            real=decisao_real[:30000], minuta=minuta[:30000])
    else:
        p = P_SEM_REF.format(numeros=", ".join(numeros) or "(nenhum)",
                             abstencao=P_ABSTENCAO if absteve else "",
                             caso=(caso or "")[:8000], minuta=minuta[:30000])

    cfg = config()
    modelos_orig = cfg["modelos"]
    cfg["modelos"] = {**modelos_orig, "juiz_efetivo": modelo}
    try:
        txt, custo = chamar("juiz_efetivo", [{"role": "user", "content": p}])
    finally:
        cfg["modelos"] = modelos_orig
    d = json_da_resposta(txt, padrao={})
    notas = {k: v for k, v in (d.get("notas") or {}).items()
             if isinstance(v, (int, float))}
    d["notas"] = notas
    d["media"] = round(sum(notas.values()) / len(notas), 2) if notas else None
    d["modo"] = "com_referencia" if decisao_real else "sem_referencia"
    d["absteve"] = bool(absteve)
    d["juiz"] = modelo
    return d, custo


if __name__ == "__main__":
    cfg = config()
    assert "juiz" in cfg["modelos"], "falta 'juiz' em config_rag.json"
    # o desvio de fornecedor tem que acontecer
    j = cfg["modelos"]["juiz"]
    mesmo = j.split("/")[0] + "/qualquer-coisa"
    assert juiz_para(mesmo) != j, "juiz nao desviou do proprio fornecedor"
    assert juiz_para("anthropic/claude-sonnet-5") in (j, cfg["modelos"]["juiz_reserva"])
    print("juiz padrao:   ", j)
    print("juiz reserva:  ", cfg["modelos"]["juiz_reserva"])
    print("se o redator for do mesmo fornecedor do juiz ->", juiz_para(mesmo))
    print("\nself-check OK")
    print(json.dumps(list(CRITERIOS), ensure_ascii=False))
