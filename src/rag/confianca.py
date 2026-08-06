"""Saber quando nao saber.

Este e' o modulo que impede o sistema de decidir sozinho. Ele nao melhora a
previsao — ele separa as consultas em que a previsao vale das em que ela nao
vale, e nas segundas manda o sistema calar a boca e mostrar as evidencias.

Medido nos 400 casos cegos, JA' NA ESCALA CALIBRADA (a tabela que definiu o corte):

    corte |p-0,5|    decide em    acerta
      0,00 (antes)     100,0%      80,2%
      0,20              64,2%      89,5%
      0,25              46,0%      94,0%
      0,30              41,8%      95,2%
      0,35 (escolhido)  37,8%      96,7%
      0,45              29,0%      96,6%

Custo de chegar a 96%: nao responder em 62% das vezes. Foi a escolha do usuario,
e e' coerente com o proposito — por um dossie de evidencias na frente de quem
decide, nao um oraculo.

CUIDADO ao mexer no corte: a calibracao ESTICA a escala. O mesmo 0,20 pegava 37%
dos casos na escala bruta e pega 64% na calibrada. A primeira versao deste modulo
usava 0,20 medido no cru, e a regra de aceite (>=93% na faixa DECIDE) reprovou
com 89,5% — foi assim que o erro apareceu. Qualquer corte novo tem de ser medido
na escala em que o usuario vai ver o numero.

Quatro sinais foram testados por tercil de acerto. Tres funcionam:

    margem |p-0,5|            70,5% / 75,8% / 95,6%   <- o forte
    concordancia dos precs.   71,2% / 79,5% / 91,2%
    forca do melhor prec.     75,8% / 80,3% / 86,0%
    desacordo knn x floresta  87,9% / 79,0% / 75,0%   <- invertido, tambem serve

E um NAO funciona, apesar de ser o candidato obvio a barra de erro:

    desvio entre as 400 arvores   67,4% / 85,0% / 89,6%

Ele mede o CONTRARIO do esperado — arvores discordando muito acompanha mais
acerto, nao menos. Ficou de fora. O intervalo honesto vem de reamostragem sobre
os precedentes, que e' de onde a incerteza realmente vem.
"""
import random

from .llm import config

PADRAO = {
    "corte_margem": 0.35,       # |p-0,5| minimo para cravar (escala CALIBRADA)
    "min_precedentes": 3,       # abaixo disso nao ha' amostra para nada
    "concordancia_minima": 0.55,
    "desacordo_maximo": 0.45,   # knn e floresta longe demais um do outro
    "reamostragens": 400,
}


def _cfg():
    c = dict(PADRAO)
    c.update(config().get("confianca") or {})
    return c


def intervalo(precedentes, peso_de, reamostragens=None, semente=17):
    """Intervalo de 80% por reamostragem sobre os PRECEDENTES.

    A incerteza real nao esta' dentro do modelo — esta' no fato de a conta sair
    de 8 decisoes que poderiam ter sido outras 8. Reamostrar com reposicao
    responde exatamente isso: se a busca tivesse trazido um conjunto parecido,
    quanto o numero mudaria?

    Com poucos precedentes o intervalo sai largo, e tem de sair mesmo: e' a
    representacao correta de "nao da' para saber com 3 casos".
    """
    cfg = _cfg()
    b = reamostragens or cfg["reamostragens"]
    if len(precedentes) < 2:
        return (0.0, 1.0)
    rnd = random.Random(semente)
    amostras = []
    for _ in range(b):
        sorteio = [precedentes[rnd.randrange(len(precedentes))]
                   for _ in range(len(precedentes))]
        merito = reforma = 0.0
        for p in sorteio:
            w = peso_de(p)
            if p.get("resultado") in ("provido", "parcialmente provido", "desprovido"):
                merito += w
                if p["resultado"] != "desprovido":
                    reforma += w
        if merito:
            amostras.append(reforma / merito)
    if not amostras:
        return (0.0, 1.0)
    amostras.sort()
    return (amostras[int(0.10 * len(amostras))],
            amostras[min(len(amostras) - 1, int(0.90 * len(amostras)))])


def concordancia(precedentes, peso_de):
    """Fracao do peso que esta' no resultado majoritario. 1,0 = unanimidade."""
    pesos = {}
    for p in precedentes:
        pesos[p.get("resultado")] = pesos.get(p.get("resultado"), 0.0) + peso_de(p)
    total = sum(pesos.values())
    return (max(pesos.values()) / total) if total else 0.0


def avaliar(p, precedentes, peso_de, knn=None, rf=None, largura=None):
    """Decide se o sistema deve cravar. Devolve o dossie da propria confianca.

    A margem e' o portao principal (foi ela que mediu 95,3%). Os outros tres
    sinais so' REBAIXAM — nunca promovem um caso que a margem reprovou. Um
    sinal fraco nao deve poder autorizar o que o sinal forte negou.
    """
    cfg = _cfg()
    if p is None:
        return {"decide": False, "faixa": "sem_estimativa",
                "por_que": ["nenhum estimador respondeu"]}

    margem = abs(p - 0.5)
    conc = concordancia(precedentes, peso_de) if precedentes else 0.0
    desac = abs(knn - rf) if (knn is not None and rf is not None) else 0.0

    motivos = []
    if margem < cfg["corte_margem"]:
        motivos.append(
            "a estimativa (%.0f%%) está perto demais do meio — nesta faixa o "
            "sistema acerta ~70%%, contra 96,7%% quando a margem é folgada"
            % (100 * p))
    if len(precedentes) < cfg["min_precedentes"]:
        motivos.append("só %d precedente(s) análogo(s): amostra pequena demais"
                       % len(precedentes))
    if precedentes and conc < cfg["concordancia_minima"]:
        motivos.append("os precedentes se dividem (%.0f%% no lado majoritário)"
                       % (100 * conc))
    if desac > cfg["desacordo_maximo"]:
        motivos.append("os dois estimadores discordam demais (%.0f pontos)"
                       % (100 * desac))
    if largura is not None and largura > 0.60:
        motivos.append("o intervalo é largo demais (%.0f pontos)" % (100 * largura))

    return {"decide": not motivos,
            "faixa": "decide" if not motivos else "nao_decide",
            "margem": round(margem, 3),
            "concordancia": round(conc, 3),
            "desacordo": round(desac, 3),
            "n_precedentes": len(precedentes),
            "por_que": motivos}


if __name__ == "__main__":
    peso = lambda p: p.get("peso", 1.0)
    forte = [{"resultado": "provido"}] * 7 + [{"resultado": "desprovido"}]
    dividido = [{"resultado": "provido"}] * 4 + [{"resultado": "desprovido"}] * 4

    # --- o portao principal: margem
    d = avaliar(0.95, forte, peso, knn=0.95, rf=0.92)
    assert d["decide"] and d["faixa"] == "decide", d
    d = avaliar(0.52, forte, peso, knn=0.52, rf=0.50)
    assert not d["decide"] and "perto demais do meio" in d["por_que"][0], d

    # --- margem folgada NAO salva precedentes divididos nem amostra minuscula
    assert not avaliar(0.95, dividido, peso)["decide"]
    assert not avaliar(0.95, [{"resultado": "provido"}] * 2, peso)["decide"]
    # --- nem estimadores brigando
    assert not avaliar(0.95, forte, peso, knn=0.99, rf=0.40)["decide"]
    # --- e um sinal secundario bom nao promove o que a margem reprovou
    assert not avaliar(0.51, forte, peso, knn=0.51, rf=0.51)["decide"]

    assert avaliar(None, [], peso)["faixa"] == "sem_estimativa"

    # --- intervalo: divididos tem que ser mais largo que unanimes
    lo1, hi1 = intervalo([{"resultado": "provido"}] * 8, peso)
    lo2, hi2 = intervalo(dividido, peso)
    assert hi1 - lo1 < hi2 - lo2, ((lo1, hi1), (lo2, hi2))
    assert hi1 - lo1 < 0.05, "unanimidade deveria dar intervalo quase nulo"
    # --- 1 precedente nao pode devolver intervalo estreito
    assert intervalo([{"resultado": "provido"}], peso) == (0.0, 1.0)
    # --- e o intervalo tem que conter a estimativa pontual
    lo, hi = intervalo(forte, peso)
    assert lo <= 7 / 8 <= hi, (lo, hi)

    d = avaliar(0.95, forte, peso, knn=0.95, rf=0.92)
    print("faixa DECIDE  : margem %.2f · %d precedentes · %.0f%% de concordância"
          % (d["margem"], d["n_precedentes"], 100 * d["concordancia"]))
    print("faixa NÃO DEC.: %s" % avaliar(0.52, dividido, peso)["por_que"][0][:70])
    print("intervalo unânimes %.2f–%.2f  vs  divididos %.2f–%.2f"
          % (lo1, hi1, lo2, hi2))
    print("self-check OK — o portão é a margem; os outros sinais só rebaixam")
