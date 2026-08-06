"""Fazer o percentual significar o que ele diz.

O prognostico da fase 3 devolve um numero entre 0 e 100. Ele ORDENA bem — casos
com numero maior reformam mais — mas a ESCALA esta' torta. Medido em 400 casos
cegos, antes deste modulo:

    o sistema dizia 20-30%  ->  reformavam de verdade   4,0%
    o sistema dizia 30-40%  ->  reformavam de verdade  19,0%
    o sistema dizia 80-90%  ->  reformavam de verdade 100,0%

Um numero assim nao serve para decidir nada: "35%" nao quer dizer 35%. Como a
curva e' monotona (sobe sempre), da' para consertar a escala sem estragar a
ordem — e' exatamente o que a regressao isotonica faz.

CORTE TEMPORAL, e nao aleatorio: ajusta em 2024, valida em 2025. A auditoria em
src/rag/deriva.py mostrou deriva de epoca de ~11 pp entre anos (28,0% a 38,9%),
maior que boa parte do sinal. Calibrador ajustado com dado velho mede o tribunal
de outra epoca; validar em ano posterior e' a unica forma honesta de saber se
ele ainda vale.

  python -m src.rag.calibrar --ajustar        # gera output/calibrador.pkl
  python -m src.rag.calibrar                  # so' confere o que ja' existe
"""
import argparse
import os
import sqlite3
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAG = os.path.join(RAIZ, "output", "rag.db")
MODELO = os.path.join(RAIZ, "output", "calibrador.pkl")

ANO_AJUSTE = 2024
ANO_VALIDACAO = 2025

# Amostra minima por ano. Abaixo disto a curva de confiabilidade nao tem
# nenhuma faixa com n>=15, erro_max() cai no default e imprime "0,0%" — que
# parece calibracao perfeita e e' so' ausencia de medicao. E a regra de aceite
# (b_depois < b_antes) vira cara ou coroa: com poucas dezenas de casos a
# diferenca de Brier e' ruido, nao evidencia.
MIN_AJUSTE = 300
MIN_VALIDACAO = 300

_cache = {}


def carregar(caminho=MODELO):
    if caminho in _cache:
        return _cache[caminho]
    m = None
    if os.path.exists(caminho):
        try:
            import joblib
            m = joblib.load(caminho)
        except Exception as e:
            print("calibrador ignorado (%s)" % e, file=sys.stderr)
        # import local, como em pontos(): o topo deste arquivo so' importa
        # stdlib de proposito, para nao entrar na teia circular do pacote
        from .floresta import conferir_selo
        conferir_selo(m, "python -m src.rag.calibrar --ajustar", RAG)
    _cache[caminho] = m
    return m


def aplicar(p, caminho=MODELO):
    """Probabilidade bruta -> probabilidade calibrada.

    Identidade quando nao ha' calibrador: o sistema nunca quebra por falta dele,
    so' volta a imprimir um numero que e' ordenacao e nao probabilidade.
    """
    if p is None:
        return None
    m = carregar(caminho)
    if not m:
        return p
    # A isotonica satura: a faixa mais baixa vira 0,000 e a mais alta 1,000.
    # Imprimir "0% de chance de reforma" e' desonesto — o que os dados mostram
    # e' "nenhuma das ~150 decisoes parecidas reformou", que nao e' zero. O piso
    # e' a diferenca entre uma estimativa e uma promessa.
    return min(0.99, max(0.01, float(m["iso"].predict([p])[0])))


def calibrado(caminho=MODELO):
    return carregar(caminho) is not None


# --------------------------------------------------------- geracao dos pontos

def _amostra(ano, n, seed, banco=RAG):
    import random
    db = sqlite3.connect("file:%s?mode=ro" % banco.replace("\\", "/"), uri=True)
    linhas = db.execute(
        "SELECT id, numero, classe, resultado, confianca, ementa FROM decisao "
        "WHERE ano = ? AND resultado IN ('provido','parcialmente provido','desprovido') "
        "AND length(ementa) > 500 AND confianca = 'dispositivo'", (ano,)).fetchall()
    db.close()
    random.seed(seed)
    return random.sample(linhas, min(n, len(linhas)))


def pontos(casos, k=8, verboso=True):
    """[(p_bruto, reformou)] pelo mesmo caminho cego da avaliacao.

    Import local de propósito: `avaliar` importa `grafo`, e `grafo` importa este
    modulo. No topo do arquivo isso seria uma referencia circular.
    """
    from . import avaliar, floresta
    from .classificador import REFORMA
    saida = []
    for i, (id_, _num, cls, real, _conf, ementa) in enumerate(casos, 1):
        termos = avaliar.termos_sem_vazamento(ementa)
        _rot, knn = avaliar.prognostico_bm25(termos, id_, None, k, usar_rerank=True)
        rf = floresta.prever(" ".join(termos), classe=cls)
        p, _acordo, _fonte = floresta.combinar(knn, rf["p_reforma"] if rf else None)
        if p is not None:
            saida.append((p, real in REFORMA))
        if verboso and i % 200 == 0:
            print("  %d/%d..." % (i, len(casos)), flush=True)
    return saida


# ---------------------------------------------------------------- diagnostico

def brier(pontos_):
    return sum((p - e) ** 2 for p, e in pontos_) / len(pontos_) if pontos_ else 0.0


def confiabilidade(pontos_, faixas=5):
    """[(inicio, fim, n, previsto_medio, real)] — a curva que diz se o numero mente."""
    saida = []
    for i in range(faixas):
        lo, hi = i / faixas, (i + 1) / faixas
        g = [x for x in pontos_ if lo <= x[0] < hi or (i == faixas - 1 and x[0] == 1.0)]
        if not g:
            continue
        saida.append((lo, hi, len(g),
                      sum(p for p, _ in g) / len(g),
                      sum(e for _, e in g) / len(g)))
    return saida


def erro_max(curva, minimo=15):
    """Maior distancia da diagonal, ignorando faixa com amostra pequena."""
    uteis = [c for c in curva if c[2] >= minimo]
    return max((abs(prev - real) for _l, _h, _n, prev, real in uteis), default=0.0)


def imprimir_curva(titulo, curva):
    print("\n%s" % titulo)
    print("  faixa prevista      n   previsto   real     erro")
    for lo, hi, n, prev, real in curva:
        print("  %3.0f-%3.0f%%        %5d     %5.1f%%  %5.1f%%   %+5.1f pp"
              % (100 * lo, 100 * hi, n, 100 * prev, 100 * real,
                 100 * (prev - real)))


def ajustar(pts, destino=MODELO, meta=None):
    from sklearn.isotonic import IsotonicRegression
    from .floresta import selo          # import local: ver carregar()
    import joblib
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit([p for p, _ in pts], [float(e) for _, e in pts])
    joblib.dump({"iso": iso, "n": len(pts), **selo(RAG), **(meta or {})}, destino)
    _cache.pop(destino, None)
    return iso


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Calibra o prognóstico (isotônica)")
    ap.add_argument("--ajustar", action="store_true")
    ap.add_argument("-n", type=int, default=1200, help="casos por ano")
    ap.add_argument("--seed", type=int, default=11)
    a = ap.parse_args()

    if a.ajustar:
        # import local, como em pontos(): o topo deste arquivo so' importa stdlib
        from . import floresta

        # O que se calibra aqui e' o CONJUNTO (pontos() chama floresta.prever),
        # e a floresta treina com ano <= ANO_CORTE. Se o ano de ajuste estiver
        # dentro do treino, a isotônica e' ajustada sobre previsões que a
        # floresta decorou — otimistas demais — e o mapeamento resultante não
        # vale para caso novo. Hoje passa por acidente (2023 < 2024).
        if ANO_AJUSTE <= floresta.ANO_CORTE:
            print("ABORTADO: ANO_AJUSTE=%d não é posterior ao ANO_CORTE=%d da\n"
                  "floresta. A calibração sairia de previsões in-sample (a\n"
                  "floresta viu esses casos no treino) e mediria a memória dela,\n"
                  "não a escala real. Suba ANO_AJUSTE/ANO_VALIDAÇÃO ou baixe o\n"
                  "ANO_CORTE em src/rag/floresta.py."
                  % (ANO_AJUSTE, floresta.ANO_CORTE), file=sys.stderr)
            raise SystemExit(1)

        print("ajuste em %d, validação em %d — corte temporal, por causa da\n"
              "deriva de época medida em src/rag/deriva.py\n"
              % (ANO_AJUSTE, ANO_VALIDACAO))
        print("gerando previsões cegas de %d..." % ANO_AJUSTE, flush=True)
        pts_aj = pontos(_amostra(ANO_AJUSTE, a.n, a.seed))
        print("gerando previsões cegas de %d..." % ANO_VALIDACAO, flush=True)
        pts_val = pontos(_amostra(ANO_VALIDACAO, a.n, a.seed + 1))

        # Antes de qualquer número: sem amostra não há medida. Com poucos casos
        # o "maior erro da diagonal 0,0%" abaixo seria falta de faixa medível, e
        # a regra de aceite seria sorteio. Aborta ANTES de salvar o .pkl.
        if len(pts_aj) < MIN_AJUSTE or len(pts_val) < MIN_VALIDACAO:
            print("ABORTADO: amostra insuficiente — %d casos de ajuste (mínimo %d)\n"
                  "e %d de validação (mínimo %d). Abaixo disso a curva de\n"
                  "confiabilidade não tem nenhuma faixa com n>=15, o erro da\n"
                  "diagonal sai 0,0%% por falta de medição e o aceite pelo Brier\n"
                  "vira ruído. Aumente -n ou indexe mais decisões desses anos."
                  % (len(pts_aj), MIN_AJUSTE, len(pts_val), MIN_VALIDACAO),
                  file=sys.stderr)
            raise SystemExit(1)

        antes = confiabilidade(pts_val)
        b_antes, e_antes = brier(pts_val), erro_max(antes)
        imprimir_curva("ANTES — %d casos de %d (fora do ajuste)"
                       % (len(pts_val), ANO_VALIDACAO), antes)

        iso = ajustar(pts_aj, meta={"ano_ajuste": ANO_AJUSTE})
        cal = [(float(iso.predict([p])[0]), e) for p, e in pts_val]
        depois = confiabilidade(cal)
        b_depois, e_depois = brier(cal), erro_max(depois)
        imprimir_curva("DEPOIS — mesmos casos, escala corrigida", depois)

        print("\n%-28s %8s %8s" % ("", "antes", "depois"))
        print("%-28s %8.4f %8.4f" % ("Brier (menor é melhor)", b_antes, b_depois))
        print("%-28s %7.1f%% %7.1f%%" % ("maior erro da diagonal",
                                         100 * e_antes, 100 * e_depois))
        print("\najustado em %d casos de %d, salvo em %s"
              % (len(pts_aj), ANO_AJUSTE, MODELO))

        # regra de aceite escrita ANTES de rodar (ver o plano da fase 4)
        if b_depois >= b_antes:
            print("\nREPROVADO: a calibração não baixou o Brier em ano posterior.\n"
                  "Apagando o calibrador — o número bruto continua, sem fingir\n"
                  "que é probabilidade.", file=sys.stderr)
            os.remove(MODELO)
            raise SystemExit(1)
        print("\nAPROVADO: Brier caiu %.1f%% e o maior erro da diagonal caiu de\n"
              "%.1f pp para %.1f pp, em dados que não entraram no ajuste."
              % (100 * (1 - b_depois / b_antes), 100 * e_antes, 100 * e_depois))
        raise SystemExit(0)

    # --- self-check offline, sem rodar o harness inteiro
    m = carregar()
    if not m:
        print("sem calibrador — aplicar() é identidade (é o comportamento correto)")
        assert aplicar(0.37) == 0.37
        print("rode: python -m src.rag.calibrar --ajustar")
        raise SystemExit(0)

    print("calibrador ajustado em %s com %d casos" % (m.get("ano_ajuste", "?"), m["n"]))
    vals = [aplicar(x / 20.0) for x in range(21)]
    assert all(vals[i] <= vals[i + 1] + 1e-9 for i in range(len(vals) - 1)), \
        "a isotônica deixou de ser monótona — a ordenação foi destruída"
    assert all(0.01 <= v <= 0.99 for v in vals), \
        "certeza absoluta (0%% ou 100%%) não é estimativa, é promessa"
    assert aplicar(None) is None
    # a calibracao tem que MEXER em alguma coisa; identidade seria inutil
    assert max(abs(aplicar(x / 20.0) - x / 20.0) for x in range(21)) > 0.02
    print("  bruto 0,20 -> calibrado %.3f" % aplicar(0.20))
    print("  bruto 0,50 -> calibrado %.3f" % aplicar(0.50))
    print("  bruto 0,80 -> calibrado %.3f" % aplicar(0.80))
    print("self-check OK — monótona, dentro de [0,1] e não é identidade")
