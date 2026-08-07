"""Segundo estimador: Random Forest sobre as decisoes ja' rotuladas.

Por que um segundo. O prognostico da fase 2 e' um voto k-NN sobre os 8
precedentes que a busca trouxe. Ele e' auditavel — da' para apontar quais 8
decisoes produziram o numero — mas herda todo defeito da recuperacao: se o BM25
trouxe enviesado, nao ha' nada no sistema que discorde, e sem precedente nenhum
ele devolve "indeterminado".

A floresta nao depende da recuperacao. Le' o texto do caso e a classe, e chuta
sozinha. Serve para duas coisas:

  fallback     quando a busca nao trouxe precedente, ela ainda responde;
  divergencia  quando os dois discordam, isso e' informacao — a minuta precisa
               enfrentar os dois lados em vez de fingir que ha' consenso.

Ela NAO substitui o k-NN. Floresta e' opaca: nao da' para citar "os 400 galhos
que votaram assim" numa peca juridica. O k-NN continua sendo o numero primario.

  python -m src.rag.floresta --treinar     # treina e salva output/floresta.pkl
  python -m src.rag.floresta               # self-check no teste temporal

Corte temporal, nao aleatorio: treina ate' 2023, testa de 2024 em diante. Split
aleatorio inflaria o numero — o uso real e' prever o futuro, nao interpolar.
"""
import argparse
import os
import sqlite3
import sys

from .classificador import normaliza, sem_vazamento

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAG = os.path.join(RAIZ, "output", "rag.db")
MODELO = os.path.join(RAIZ, "output", "floresta.pkl")

ANO_CORTE = 2023
MERITO = ("provido", "parcialmente provido", "desprovido")

_cache = {}


# ------------------------------------------------- selo do indice que gerou o .pkl

def selo(banco=RAG):
    """Identidade do CONTEUDO do rag.db no instante em que o artefato foi salvo.

    Um .pkl nao carrega vinculo nenhum com o indice que o gerou: depois de
    reindexar, o artefato velho continua sendo carregado em silencio e preve
    pior — sem nenhum sinal de que envelheceu.

    Foi mtime + tamanho ate' descobrir que isso da' alarme falso: o lifespan da
    API abre o rag.db (WAL) a cada boot, e o mtime anda sem uma linha ter
    mudado. Alarme que dispara sozinho e' alarme que se aprende a ignorar — e o
    dia em que o indice mudar de verdade ninguem le'. Contagem e maior id
    mudam quando o acervo muda, e so' quando ele muda: reindexar o MESMO
    tjsc.db devolve o mesmo selo, e o modelo continua valido de fato.
    """
    try:
        n, maior = sqlite3.connect(
            "file:%s?mode=ro" % banco.replace("\\", "/"), uri=True).execute(
            "SELECT count(*), max(id) FROM decisao").fetchone()
        return {"indice_n": n, "indice_max_id": maior}
    except (OSError, sqlite3.Error):    # sem banco: nada a selar, e nada a avisar
        return {}


def conferir_selo(m, refazer, banco=RAG):
    """Avisa em stderr quando o indice MUDOU depois do modelo.

    Avisa e nao falha de proposito: um artefato defasado ainda responde, e
    derrubar a consulta inteira seria pior que o aviso. Artefato antigo, salvo
    antes deste selo existir (ou com o selo velho, por mtime), passa calado —
    nao ha' com o que comparar.
    """
    if not m or "indice_n" not in m:
        return
    atual = selo(banco)
    if not atual:
        return
    if (atual["indice_n"], atual["indice_max_id"]) != \
            (m["indice_n"], m["indice_max_id"]):
        print("AVISO: %s mudou depois deste modelo (%s decisões agora, %s no\n"
              "       treino) — as previsões podem estar piores que o medido.\n"
              "       Rode: %s"
              % (os.path.basename(banco), atual["indice_n"], m["indice_n"],
                 refazer), file=sys.stderr)


def disponivel():
    """sklearn e' opcional: sem ele o grafo roda igual a' fase 2, so' sem a floresta."""
    try:
        import sklearn  # noqa: F401
        return True
    except ImportError:
        return False


# ------------------------------------------------------------------ dados

def _linhas(banco=RAG, ano_max=None, ano_min=None):
    db = sqlite3.connect("file:%s?mode=ro" % banco.replace("\\", "/"), uri=True)
    sql = ("SELECT ementa, classe, orgao, comarca, ano, ancora, unanime, resultado "
           "FROM decisao WHERE confianca='dispositivo' AND resultado IN (?,?,?) "
           "AND length(ementa) > 200")
    args = list(MERITO)
    if ano_max:
        sql += " AND ano <= ?"
        args.append(ano_max)
    if ano_min:
        sql += " AND ano >= ?"
        args.append(ano_min)
    r = db.execute(sql, args).fetchall()
    db.close()
    return r


def _texto(ementa, classe, orgao, comarca, ancora, cru=False):
    """Uma string so'. O TF-IDF pega o vocabulario juridico; os metadados entram
    como tokens artificiais para a floresta poder cortar por eles.

    A ementa passa por sem_vazamento() ANTES de virar feature. Sem isso a
    floresta so' aprende a ler o desfecho no fim do proprio texto: a primeira
    versao deste modulo marcou 93,9% de acerto e 99,6% de recall — numeros que
    nao existem em previsao judicial e que denunciavam a copia.

    `cru=True` so' na consulta, quando a entrada ja' e' um caso novo (jargao da
    triagem, sem desfecho nenhum para vazar).
    """
    ementa = ementa or ""
    if not cru:
        ementa = ". ".join(sem_vazamento(ementa))
    return "%s\n__classe_%s __orgao_%s __comarca_%s __ancora_%s" % (
        ementa,
        "_".join((classe or "?").split())[:40],
        "_".join((orgao or "?").split())[:40],
        "_".join((comarca or "?").split())[:30],
        ancora or "?")


def _xy(linhas):
    """linhas = (ementa, classe, orgao, comarca, ano, ancora, unanime, resultado)"""
    X = [_texto(l[0], l[1], l[2], l[3], l[5]) for l in linhas]
    y = [l[7] for l in linhas]
    return X, y


# ----------------------------------------------------------------- treino

def treinar(banco=RAG, destino=MODELO, ano_corte=ANO_CORTE, verboso=True):
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.pipeline import Pipeline
    import joblib

    treino = _linhas(banco, ano_max=ano_corte)
    teste = _linhas(banco, ano_min=ano_corte + 1)
    if verboso:
        print("treino: %d decisoes ate' %d | teste: %d de %d em diante"
              % (len(treino), ano_corte, len(teste), ano_corte + 1), flush=True)
    Xtr, ytr = _xy(treino)
    Xte, yte = _xy(teste)

    p = Pipeline([
        ("tfidf", TfidfVectorizer(min_df=5, ngram_range=(1, 2), sublinear_tf=True,
                                  strip_accents="unicode", max_features=60000)),
        # class_weight: 68% do corpus e' 'desprovido'. Sem isto a floresta
        # aprende a dizer sempre 'desprovido' e acerta 68% sem saber nada.
        ("rf", RandomForestClassifier(
            n_estimators=400, min_samples_leaf=3, class_weight="balanced",
            n_jobs=-1, random_state=7)),
    ])
    p.fit(Xtr, ytr)
    joblib.dump({"pipeline": p, "ano_corte": ano_corte,
                 "n_treino": len(treino), "classes": list(p.classes_),
                 **selo(banco)}, destino)
    if verboso:
        print("salvo em %s (%.1f MB)" % (destino, os.path.getsize(destino) / 1e6))
    return p, (Xte, yte)


def carregar(caminho=MODELO):
    """None se sklearn nao estiver instalado ou o modelo nao tiver sido treinado."""
    if caminho in _cache:
        return _cache[caminho]
    m = None
    if disponivel() and os.path.exists(caminho):
        import joblib
        try:
            m = joblib.load(caminho)
        except Exception as e:                      # modelo de outra versao etc.
            print("floresta ignorada (%s)" % e, file=sys.stderr)
        conferir_selo(m, "python -m src.rag.floresta --treinar")
    _cache[caminho] = m
    return m


# -------------------------------------------------------------------- uso

def prever(texto, classe=None, orgao=None, comarca=None, ancora=None,
           caminho=MODELO):
    """{'resultado','p_reforma','probabilidades'} ou None se nao houver modelo.

    Fraqueza declarada: treinado em EMENTA, aplicado a texto de caso novo. E'
    deslocamento de distribuicao real. Por isso o que entra aqui, na consulta,
    sao os termos da triagem (jargao tipo-ementa) e nao a peca inteira.
    """
    m = carregar(caminho)
    if not m:
        return None
    p = m["pipeline"]
    probs = p.predict_proba(
        [_texto(texto, classe, orgao, comarca, ancora, cru=True)])[0]
    d = dict(zip(p.classes_, (float(x) for x in probs)))
    reforma = d.get("provido", 0.0) + d.get("parcialmente provido", 0.0)
    return {"resultado": max(d, key=d.get),
            "p_reforma": round(reforma, 3),
            "probabilidades": {k: round(v, 3) for k, v in sorted(
                d.items(), key=lambda kv: -kv[1])},
            "treinado_ate": m["ano_corte"], "n_treino": m["n_treino"]}


PESO_KNN = 0.5


def combinar(reforma_knn, p_reforma_rf, peso_knn=PESO_KNN):
    """A decisao mutua, no unico eixo em que os dois estimadores falam a mesma
    lingua: a probabilidade de REFORMA.

    Devolve (p_conjunto, acordo, fonte). Qualquer um dos dois pode faltar:

      so' k-NN   -> o de sempre (a fase 2 inteira era isto)
      so' RF     -> fallback, quando a busca nao trouxe precedente nenhum
      os dois    -> media ponderada, e `acordo=False` quando discordam de lado

    Discordancia nao e' erro a ser escondido: e' o caso em que a minuta precisa
    enfrentar os dois lados em vez de fingir consenso.
    """
    if p_reforma_rf is None and reforma_knn is None:
        return None, None, "nenhum"
    if p_reforma_rf is None:
        return reforma_knn, None, "knn"
    if reforma_knn is None:
        return p_reforma_rf, None, "floresta (sem precedente)"
    acordo = (reforma_knn >= 0.5) == (p_reforma_rf >= 0.5)
    return (peso_knn * reforma_knn + (1 - peso_knn) * p_reforma_rf,
            acordo, "conjunto")


def metricas(p, Xte, yte):
    """Precisao/recall de REFORMA. Acerto exato nao serve: o prior de 68%
    'desprovido' faz um modelo burro parecer bom."""
    probs = p.predict_proba(Xte)
    idx = {c: i for i, c in enumerate(p.classes_)}
    ref = [probs[i][idx.get("provido", 0)] + probs[i][idx.get("parcialmente provido", 0)]
           for i in range(len(Xte))]
    tp = fp = fn = tn = exato = 0
    prev = p.predict(Xte)
    for i, real in enumerate(yte):
        exato += prev[i] == real
        diz, e = ref[i] >= 0.5, real != "desprovido"
        tp += diz and e
        fp += diz and not e
        fn += (not diz) and e
        tn += (not diz) and not e
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    base = sum(y != "desprovido" for y in yte) / len(yte)
    return {"n": len(yte), "exato": exato / len(yte),
            "precisao_reforma": prec, "recall_reforma": rec,
            "f1_reforma": 2 * prec * rec / (prec + rec) if prec + rec else 0.0,
            "base_reforma": base,
            "ganho": prec / base if base else 0.0}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Random Forest — segundo estimador")
    ap.add_argument("--treinar", action="store_true")
    ap.add_argument("--ano-corte", type=int, default=ANO_CORTE)
    a = ap.parse_args()

    if not disponivel():
        print("scikit-learn nao instalado. O sistema roda sem ele (so' sem a\n"
              "floresta). Para ter o segundo estimador:\n"
              "  .venv\\Scripts\\pip install scikit-learn", file=sys.stderr)
        raise SystemExit(1)

    # --- teste de vazamento, ANTES de olhar qualquer metrica. Metrica alta com
    # vazamento e' pior que metrica baixa sem: parece que funciona.
    from .classificador import _VAZA
    # segue o corte pedido, e nao um ano cravado: com ANO_CORTE diferente, o ano
    # fixo passaria a amostrar dado de TREINO e o teste deixaria de valer
    amostra = _linhas(ano_min=a.ano_corte + 1)[:600]
    vazou = sum(bool(_VAZA.search(normaliza(x))) for x in _xy(amostra)[0])
    print("vazamento: %d de %d exemplos de treino ainda revelam o desfecho"
          % (vazou, len(amostra)))
    assert vazou == 0, "a ementa esta' entregando a resposta para o modelo"

    if a.treinar or not os.path.exists(MODELO):
        p, (Xte, yte) = treinar(ano_corte=a.ano_corte)
    else:
        m = carregar()
        p = m["pipeline"]
        Xte, yte = _xy(_linhas(ano_min=m["ano_corte"] + 1))
        print("modelo ja' treinado (ate' %d, %d exemplos). --treinar refaz."
              % (m["ano_corte"], m["n_treino"]))

    r = metricas(p, Xte, yte)
    print("\n-- teste temporal: %d decisoes posteriores ao treino --" % r["n"])
    print("acerto exato ..................... %.1f%%" % (100 * r["exato"]))
    print("quando diz 'reforma', acerta ..... %.1f%%" % (100 * r["precisao_reforma"]))
    print("taxa real de reforma no teste .... %.1f%%   <- linha de base"
          % (100 * r["base_reforma"]))
    print("ganho sobre a base ............... %.2fx" % r["ganho"])
    print("recall ........................... %.1f%%" % (100 * r["recall_reforma"]))
    print("F1 ............................... %.1f%%" % (100 * r["f1_reforma"]))

    d = prever("prescrição intercorrente execução fiscal arquivamento",
               classe="Apelação Cível")
    assert d and 0.0 <= d["p_reforma"] <= 1.0, d
    print("\nexemplo: %s  (P(reforma)=%.2f)" % (d["resultado"], d["p_reforma"]))
    assert r["precisao_reforma"] > r["base_reforma"], \
        "a floresta nao bate nem a linha de base — nao serve como estimador"

    # --- o selo. Ele existe para pegar reindexacao, e NAO pode gritar so'
    # porque alguem abriu o banco: era o que o selo por mtime fazia, e o
    # lifespan da API disparava o aviso a cada boot.
    s = selo()
    assert set(s) == {"indice_n", "indice_max_id"} and s["indice_n"] > 0, s
    import io
    from contextlib import redirect_stderr
    for caso, meta in (("igual", dict(s)),
                       ("artefato velho, sem selo", {"pipeline": 1}),
                       ("sem meta", None)):
        buf = io.StringIO()
        with redirect_stderr(buf):
            conferir_selo(meta, "refaz")
        assert buf.getvalue() == "", "alarme falso em: %s" % caso
    buf = io.StringIO()
    with redirect_stderr(buf):
        conferir_selo({**s, "indice_n": s["indice_n"] - 7}, "refaz")
    assert "mudou depois deste modelo" in buf.getvalue(), buf.getvalue()

    print("\nself-check OK — a floresta bate a base em %.2fx e o selo só grita "
          "quando o índice muda de verdade" % r["ganho"])
