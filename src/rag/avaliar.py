"""Teste de honestidade: o prognostico acerta o resultado real?

Sorteia decisoes ja' julgadas, esconde cada uma do indice, alimenta o sistema
com a parte da ementa que descreve o caso (sem o desfecho) e compara.

  python -m src.rag.avaliar --offline -n 300   # so' BM25, custo zero
  python -m src.rag.avaliar -n 30              # grafo completo ate' o prognostico

O modo --offline mede a espinha do RAG (recuperacao + contagem) sem gastar
nada. E' o numero que vale citar: se ele for ruim, nenhum LLM salva.
"""
import argparse
import random
import sqlite3
from collections import Counter

from .. import cerebros
from . import busca, calibrar, confianca, floresta, rerank
from .classificador import MERITO, REFORMA, sem_vazamento
from .grafo import PESO_CONFIANCA

# Segmentos da ementa que ja' entregam o desfecho saem da consulta (senao o
# teste vira trapaca). Mora no classificador, junto dos padroes de onde o rotulo
# saiu — a floresta usa o mesmo filtro para nao treinar copiando a resposta.
termos_sem_vazamento = lambda ementa, maximo=10: sem_vazamento(ementa, limite=maximo)


def prognostico_bm25(termos, alvo_id, classe=None, k=8, usar_rerank=False,
                     cam=None, alvo_numero=None):
    """Mesma ponderacao do no de prognostico do grafo, sem a nota da triagem
    (que exige LLM). Devolve (rotulo_mais_pesado, fracao_de_reforma_no_merito).

    `alvo_numero` tira do indice TODAS as linhas do mesmo processo, nao so' a
    linha avaliada — ver o self-check de busca.py.
    """
    cam = cam or cerebros.caminhos()
    q = busca.montar_consulta(termos)
    cand = busca.buscar(q, limite=k * 3, classe=classe, excluir=(alvo_id,),
                        excluir_numeros=(alvo_numero,) if alvo_numero else (),
                        banco=cam["rag"])
    if usar_rerank:
        cand = rerank.ordenar(cand, limite=k)
    else:
        cand = cand[:k]
    pesos = {}
    for c in cand:
        w = PESO_CONFIANCA.get(c["confianca"], 0.5) * (
            c["pontos"] if usar_rerank else max(0.1, -c["score"]))
        pesos[c["resultado"]] = pesos.get(c["resultado"], 0.0) + w
    if not pesos:
        return None, None
    merito = sum(w for r, w in pesos.items() if r in MERITO)
    reforma = sum(w for r, w in pesos.items() if r in REFORMA)
    return max(pesos, key=pesos.get), (reforma / merito if merito else 0.0)


def amostra(n, ano_min, seed, banco=None):
    banco = banco or cerebros.caminhos()["rag"]
    db = sqlite3.connect("file:%s?mode=ro" % banco.replace("\\", "/"), uri=True)
    linhas = db.execute(
        "SELECT id, numero, classe, resultado, confianca, ementa FROM decisao "
        "WHERE ano >= ? AND resultado IN ('provido','parcialmente provido','desprovido') "
        "AND length(ementa) > 500 AND confianca = 'dispositivo'", (ano_min,)).fetchall()
    db.close()
    random.seed(seed)
    return random.sample(linhas, min(n, len(linhas)))


def rodar_offline(casos, k=8, classe=False, arranjo="knn", corte=None, cam=None):
    """arranjo: knn | knn+rerank | floresta | conjunto | conjunto+rerank

    O caso avaliado sai do indice (`excluir`), e a consulta e' montada so' com
    segmentos da ementa que nao revelam o desfecho. Sem isso o numero mede
    copia, nao previsao.

    `corte` liga a abstencao: o sistema so' e' cobrado nos casos em que a margem
    |p-0,5| passa do corte. `cobertura` diz em quantos ele respondeu.
    """
    cam = cam or cerebros.caminhos()
    usar_rr = arranjo.endswith("+rerank")
    usa_knn = arranjo != "floresta"
    usa_rf = arranjo.startswith(("floresta", "conjunto"))
    exatos = vazios = tp = fp = fn = tn = respondidos_so_pela_rf = 0
    decididos = acertos_decididos = 0
    matriz = Counter()
    for id_, num, cls, real, _conf, ementa in casos:
        termos = termos_sem_vazamento(ementa)
        prev = frac = None
        if usa_knn:
            prev, frac = prognostico_bm25(termos, id_, cls if classe else None,
                                          k, usar_rerank=usar_rr, cam=cam,
                                          alvo_numero=num)
        rf = (floresta.prever(" ".join(termos), classe=cls, caminho=cam["floresta"])
              if usa_rf else None)
        p, _acordo, fonte = floresta.combinar(frac, rf["p_reforma"] if rf else None)
        if p is None:
            vazios += 1
            continue
        if corte is not None:
            # a margem e' medida na escala CALIBRADA: e' a que o usuario ve'
            pc = calibrar.aplicar(p, caminho=cam["calibrador"])
            if abs(pc - 0.5) >= corte:
                decididos += 1
                acertos_decididos += (pc >= 0.5) == (real in REFORMA)
        if prev is None:
            prev = rf["resultado"]
            respondidos_so_pela_rf += 1
        exatos += prev == real
        matriz[(real, prev)] += 1
        diz, e = p >= 0.5, real in REFORMA
        tp += diz and e
        fp += diz and not e
        fn += (not diz) and e
        tn += (not diz) and not e
    n = len(casos) - vazios
    prec = tp / (tp + fp) if tp + fp else 0
    rec = tp / (tp + fn) if tp + fn else 0
    return {"n": n, "sem_precedente": vazios, "matriz": matriz,
            "salvos_pela_floresta": respondidos_so_pela_rf,
            "cobertura": decididos / n if n else 0,
            "acerto_quando_decide": (acertos_decididos / decididos
                                     if decididos else 0),
            "exato": exatos / n if n else 0,
            "precisao_reforma": prec, "recall_reforma": rec,
            "f1_reforma": 2 * prec * rec / (prec + rec) if prec + rec else 0}


def imprimir(r, base, base_ref):
    print("\navaliados: %d  (sem precedente: %d)" % (r["n"], r["sem_precedente"]))
    print("\n-- acerto do rotulo (metrica fraca: o prior domina) --")
    print("acerto exato ..................... %.1f%%" % (100 * r["exato"]))
    print("chutar sempre o mais comum ....... %.1f%%" % (100 * base))
    print("\n-- previsao de REFORMA (e' aqui que esta o sinal) --")
    print("quando o sistema diz 'reforma',")
    print("  ele acerta (precisao) .......... %.1f%%" % (100 * r["precisao_reforma"]))
    print("taxa real de reforma na amostra .. %.1f%%   <- a linha de base honesta"
          % (100 * base_ref))
    print("ganho sobre a base ............... %.2fx"
          % (r["precisao_reforma"] / base_ref if base_ref else 0))
    print("das reformas reais, quantas ele")
    print("  pega (recall) .................. %.1f%%" % (100 * r["recall_reforma"]))
    print("F1 ............................... %.1f%%" % (100 * r["f1_reforma"]))
    print("\nmatriz  (real -> previsto):")
    reais = sorted({k[0] for k in r["matriz"]})
    prevs = sorted({k[1] for k in r["matriz"]})
    print("%-24s %s" % ("", " ".join("%12s" % p[:12] for p in prevs)))
    for real in reais:
        tot = sum(v for (a, _), v in r["matriz"].items() if a == real)
        print("%-24s %s   (n=%d)" % (
            real[:24], " ".join("%12d" % r["matriz"].get((real, p), 0) for p in prevs), tot))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=300)
    ap.add_argument("--ano-min", type=int, default=2024)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("-k", type=int, default=8, help="precedentes por caso")
    ap.add_argument("--com-classe", action="store_true",
                    help="filtra por classe (medido: nao ajuda)")
    ap.add_argument("--offline", action="store_true",
                    help="sem LLM: termos vem da propria ementa (custo zero)")
    ap.add_argument("--comparar", action="store_true",
                    help="os cinco arranjos nos MESMOS casos (k-NN, rerank, floresta, conjunto)")
    cerebros.argumento(ap)
    a = ap.parse_args()
    cam = cerebros.caminhos(a.cerebro)
    print("cérebro: %s" % cam["nome"])

    if not a.offline:
        print("So' existe o modo --offline aqui: e' ele que mede a espinha do RAG\n"
              "(recuperacao + contagem) sem gastar nada. Para uma consulta unica\n"
              "com o grafo completo:  python -m src.rag.cli caso.txt --so-prognostico")
        raise SystemExit(1)

    # --- a avaliacao nao pode mais ver o proprio processo
    db = sqlite3.connect("file:%s?mode=ro" % cam["rag"].replace("\\", "/"), uri=True)
    alvo = db.execute(
        "SELECT id, numero, ementa FROM decisao WHERE numero IN "
        "(SELECT numero FROM decisao WHERE numero != '' GROUP BY numero "
        " HAVING count(*) > 1) AND length(ementa) > 500 LIMIT 1").fetchone()
    db.close()
    assert alvo, "sem processo repetido no indice"
    q = busca.montar_consulta(termos_sem_vazamento(alvo[2]))
    vistos = busca.buscar(q, limite=24, excluir=(alvo[0],),
                          excluir_numeros=(alvo[1],), banco=cam["rag"])
    assert all(v["numero"] != alvo[1] for v in vistos)
    print("OK: excluir_numeros tira do indice todas as linhas do processo %s "
          "(self-check da avaliacao)." % alvo[1])

    casos = amostra(a.n, a.ano_min, a.seed, banco=cam["rag"])
    print("amostra: %d decisoes de merito de %d em diante, todas classificadas "
          "pelo dispositivo" % (len(casos), a.ano_min))

    # duas linhas de base honestas: chutar o rotulo mais comum, e a taxa de
    # reforma da propria amostra (o que voce acertaria dizendo 'reforma' no chute)
    base = Counter(x[3] for x in casos).most_common(1)[0][1] / len(casos)
    base_ref = sum(1 for x in casos if x[3] in REFORMA) / len(casos)

    if not a.comparar:
        r = rodar_offline(casos, k=a.k, classe=a.com_classe, cam=cam)
        imprimir(r, base, base_ref)
        assert r["precisao_reforma"] > base_ref * 1.5, \
            "o prognostico deixou de bater a linha de base — algo regrediu"
        print("\nOK: a precisao da previsao de reforma bate a linha de base com folga.")
        raise SystemExit(0)

    if not floresta.carregar(cam["floresta"]):
        print("floresta nao treinada — rode: python -m src.rag.floresta --treinar")
        raise SystemExit(1)

    ARRANJOS = ["knn", "knn+rerank", "floresta", "conjunto", "conjunto+rerank"]
    print("\ntaxa real de reforma na amostra: %.1f%%  <- a linha de base a bater\n"
          % (100 * base_ref))
    print("%-18s %5s %6s %8s %8s %6s %7s"
          % ("arranjo", "n", "exato", "precisão", "recall", "F1", "ganho"))
    res = {}
    for arr in ARRANJOS:
        r = res[arr] = rodar_offline(casos, k=a.k, classe=a.com_classe, arranjo=arr,
                                     cam=cam)
        print("%-18s %5d %5.1f%% %7.1f%% %7.1f%% %5.1f%% %6.2fx"
              % (arr, r["n"], 100 * r["exato"], 100 * r["precisao_reforma"],
                 100 * r["recall_reforma"], 100 * r["f1_reforma"],
                 r["precisao_reforma"] / base_ref if base_ref else 0))

    # --- abstencao: quanto se ganha desistindo dos casos duvidosos
    print("\n-- e se o sistema pudesse dizer 'não sei'? --")
    print("%-34s %10s %9s" % ("regime", "responde", "acerta"))
    # margens medidas na escala CALIBRADA — que e' a que o usuario ve'. Medir no
    # cru dava outra tabela e foi o que fez a primeira versao reprovar aqui.
    # o corte EFETIVO vem de _cfg(), nao de PADRAO: config_rag.json sobrepoe a
    # constante, e' isso que a producao usa, e validar o hardcoded deixaria
    # passar uma mudanca feita so' no config. O corte efetivo entra sempre na
    # lista testada (set: nao duplica se ja' for um dos fixos) — senao
    # faixa_decide ficaria sem atribuicao e o assert abaixo estouraria NameError.
    corte_efetivo = confianca._cfg()["corte_margem"]
    for corte in sorted({0.0, 0.20, 0.25, 0.30, 0.35, 0.45, corte_efetivo}):
        rotulo = ("responde sempre (fase 3)" if corte == 0.0
                  else ("margem >= %.2f" % corte).replace(".", ","))
        if corte == corte_efetivo:
            rotulo += "  <- efetivo"
        d = rodar_offline(casos, k=a.k, classe=a.com_classe,
                          arranjo="conjunto+rerank", corte=corte, cam=cam)
        print("%-34s %9.1f%% %8.1f%%"
              % (rotulo, 100 * d["cobertura"], 100 * d["acerto_quando_decide"]))
        if corte == corte_efetivo:
            faixa_decide = d
    assert faixa_decide["acerto_quando_decide"] >= 0.93, \
        ("a faixa DECIDE caiu para %.1f%% no corte efetivo %.2f — abaixo dos 93%% "
         "de aceite; suba o corte ou desligue a faixa"
         % (100 * faixa_decide["acerto_quando_decide"], corte_efetivo))

    knn, conj = res["knn"], res["conjunto"]
    print("\nsem precedente (o k-NN não responderia): %d casos; a floresta cobriu %d"
          % (knn["sem_precedente"], conj["salvos_pela_floresta"]))
    print("\n-- o que fica ligado --")
    for nome, base_, novo in (("rerank", res["knn"], res["knn+rerank"]),
                              ("floresta (conjunto)", res["knn"], res["conjunto"])):
        d_p = 100 * (novo["precisao_reforma"] - base_["precisao_reforma"])
        d_f = 100 * (novo["f1_reforma"] - base_["f1_reforma"])
        veredito = "LIGAR" if novo["f1_reforma"] > base_["f1_reforma"] else "DESLIGAR"
        print("%-22s precisão %+5.1f pp | F1 %+5.1f pp -> %s"
              % (nome, d_p, d_f, veredito))
    print("\nRegra escrita antes de rodar: o que não melhorar o F1 fica desligado\n"
          "no config_rag.json, e o número ruim vai para o README assim mesmo.")
    assert knn["precisao_reforma"] > base_ref * 1.5, \
        "o k-NN deixou de bater a linha de base — algo regrediu"
