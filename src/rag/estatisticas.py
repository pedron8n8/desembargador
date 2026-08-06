"""Agregacoes sobre o acervo, para a interface. Leitura pura, sem LLM, sem rede.

O que este modulo NAO faz: repetir numero de benchmark. `abstencao()` mede a
cobertura OBSERVADA nas consultas que voce de fato rodou, nao os 37,8% medidos
nos 400 casos cegos. Os dois numeros respondem perguntas diferentes e confundi-los
e' como o painel de um sistema de medida passa a se auto-elogiar.

    python -m src.rag.estatisticas
"""
import json
import os
import sqlite3

from .busca import RAG, _db
from .calibrar import MODELO, carregar
from .feedback import FB

MERITO = "resultado IN ('provido','parcialmente provido','desprovido')"
REFORMA = "resultado IN ('provido','parcialmente provido')"


def corpus(banco=RAG, minimo_ano=300):
    """O acervo que treinou o modelo, em numeros.

    `minimo_ano` corta os anos de amostra pequena da serie de reforma — e' o
    mesmo _MIN=300 do src/rag/deriva.py, e pela mesma razao. Sem ele, 2000 (3
    decisoes) e 2026 (ano em curso) fazem a serie ir de 5% a 78% e o grafico
    anuncia uma "deriva de 72 pp" que e' ruido de denominador. A deriva real
    medida entre anos com amostra e' de ~11 pp.
    """
    db = _db(banco)
    total, com_teor, ini, fim = db.execute(
        "SELECT count(*), sum(tem_teor), min(ano), max(ano) FROM decisao").fetchone()
    return {
        "total": total,
        "com_inteiro_teor": com_teor or 0,
        "primeiro_ano": ini, "ultimo_ano": fim,
        "por_resultado": [{"rotulo": r or "?", "n": n} for r, n in db.execute(
            "SELECT resultado, count(*) c FROM decisao GROUP BY 1 ORDER BY c DESC")],
        "por_ancora": [{"rotulo": a or "?", "n": n, "reforma_pct": round(p, 1)}
                       for a, n, p in db.execute(
            "SELECT ancora, count(*), 100.0*sum(%s)/count(*) FROM decisao "
            "WHERE %s GROUP BY 1 ORDER BY 2 DESC" % (REFORMA, MERITO))],
        "por_unanimidade": [{"rotulo": {1: "unânime", 0: "por maioria/vencido"}
                             .get(u, "não identificada"), "n": n}
                            for u, n in db.execute(
            "SELECT unanime, count(*) FROM decisao GROUP BY 1")],
        "por_ano": [{"ano": a, "n": n, "reforma_pct": round(p, 1)}
                    for a, n, p in db.execute(
            "SELECT ano, count(*) c, 100.0*sum(%s)/count(*) FROM decisao "
            "WHERE %s AND ano IS NOT NULL GROUP BY 1 HAVING c >= ? ORDER BY 1"
            % (REFORMA, MERITO), (minimo_ano,))],
        "minimo_ano": minimo_ano,
        # a serie acima esconde anos; o total nao pode esconder
        "anos_fora_da_serie": [{"ano": a, "n": n} for a, n in db.execute(
            "SELECT ano, count(*) c FROM decisao WHERE %s AND ano IS NOT NULL "
            "GROUP BY 1 HAVING c < ? ORDER BY 1" % MERITO, (minimo_ano,))],
    }


def _por_campo(campo, minimo, banco=RAG):
    return [{"rotulo": v or "?", "n": n, "reforma_pct": round(p, 1)}
            for v, n, p in _db(banco).execute(
        "SELECT %s, count(*) c, 100.0*sum(%s)/count(*) FROM decisao "
        "WHERE %s GROUP BY 1 HAVING c >= ? ORDER BY c DESC"
        % (campo, REFORMA, MERITO), (minimo,))]


def classes(minimo=300, banco=RAG):
    return _por_campo("classe", minimo, banco)


def orgaos(minimo=300, banco=RAG):
    """'Por quem' aqui e' QUAL CAMARA. O acervo e' de um relator so' — nao da'
    para comparar relatores com estes dados, e o relatorio diz isso."""
    return _por_campo("orgao", minimo, banco)


def calibracao(caminho=MODELO):
    """A funcao de transferencia e, se o .pkl a tiver, a curva de confiabilidade.

    Calibradores gerados antes da fase 5 nao tem as curvas dentro (elas eram
    impressas e jogadas fora). Nesse caso devolve so' a transferencia e diz que
    falta — que e' honesto; regenerar exige rodar o pipeline cego duas vezes.
    """
    m = carregar(caminho)
    if not m:
        return {"calibrado": False}
    from .calibrar import aplicar
    grade = [x / 50.0 for x in range(51)]
    return {
        "calibrado": True,
        "n": m.get("n"),
        "ano_ajuste": m.get("ano_ajuste"),
        "ano_validacao": m.get("ano_validacao"),
        "transferencia": [{"bruto": round(p, 3), "calibrado": round(aplicar(p), 4)}
                          for p in grade],
        "curva_antes": _curva(m.get("curva_antes")),
        "curva_depois": _curva(m.get("curva_depois")),
        "brier_antes": m.get("brier_antes"), "brier_depois": m.get("brier_depois"),
        "erro_antes": m.get("erro_antes"), "erro_depois": m.get("erro_depois"),
        "tem_curva": bool(m.get("curva_depois")),
    }


def _curva(c):
    """calibrar.confiabilidade devolve tuplas (lo, hi, n, previsto, real)."""
    return [{"lo": lo, "hi": hi, "n": n, "previsto": prev, "real": real}
            for lo, hi, n, prev, real in (c or [])]


def abstencao(banco=FB):
    """Com que frequencia o sistema CRAVOU, nas consultas que voce rodou.

    Nao e' o numero do benchmark. Aquele mede 400 casos cegos com gabarito;
    este mede o seu uso real, que tem outra distribuicao de casos.
    """
    if not os.path.exists(banco):
        return {"n": 0, "observado": True}
    c = sqlite3.connect("file:%s?mode=ro" % banco.replace("\\", "/"), uri=True)
    try:
        linhas = [r[0] for r in c.execute(
            "SELECT prognostico_json FROM consulta WHERE prognostico_json IS NOT NULL")]
    finally:
        c.close()
    decide = nao = 0
    faixas = {}
    for bruto in linhas:
        try:
            p = json.loads(bruto or "{}")
        except ValueError:
            continue
        if not p:
            continue
        if p.get("decide"):
            decide += 1
        else:
            nao += 1
        pct = p.get("probabilidade_pct")
        if pct is not None:
            faixas.setdefault(int(pct // 10) * 10, 0)
            faixas[int(pct // 10) * 10] += 1
    n = decide + nao
    return {"n": n, "decide": decide, "nao_decide": nao, "observado": True,
            "cobertura_pct": round(100 * decide / n, 1) if n else None,
            "distribuicao": [{"faixa": f, "n": q} for f, q in sorted(faixas.items())]}


def documentos(banco=RAG, tjsc=None):
    """Os documentos que alimentaram o indice: quantos, e quantos tem texto."""
    db = _db(banco)
    n, teor = db.execute("SELECT count(*), sum(tem_teor) FROM decisao").fetchone()
    saida = {"indexadas": n, "com_inteiro_teor": teor or 0, "rtf": None}
    tjsc = tjsc or os.path.join(os.path.dirname(banco), "tjsc.db")
    if os.path.exists(tjsc):
        c = sqlite3.connect("file:%s?mode=ro" % tjsc.replace("\\", "/"), uri=True)
        try:
            saida["rtf"] = c.execute(
                "SELECT count(*) FROM decisoes WHERE doc_path IS NOT NULL "
                "AND doc_path <> ''").fetchone()[0]
            saida["por_fonte"] = [{"fonte": f or "?", "n": q} for f, q in c.execute(
                "SELECT fonte, count(*) FROM decisoes GROUP BY 1 ORDER BY 2 DESC")]
        except sqlite3.OperationalError:
            pass
        finally:
            c.close()
    return saida


if __name__ == "__main__":
    if not os.path.exists(RAG):
        raise SystemExit("índice não existe — rode: python -m src.rag.indexar")

    c = corpus()
    assert c["total"] > 10000, c["total"]
    assert c["primeiro_ano"] < c["ultimo_ano"]
    soma = sum(x["n"] for x in c["por_resultado"])
    assert soma == c["total"], (soma, c["total"])
    assert all(0 <= x["reforma_pct"] <= 100 for x in c["por_ano"])
    # a deriva de epoca tem que aparecer — e tem que ser a de verdade (~11 pp),
    # nao a inflada por anos de 3 decisoes
    pcts = [x["reforma_pct"] for x in c["por_ano"]]
    assert all(x["n"] >= 300 for x in c["por_ano"])
    assert 5 < max(pcts) - min(pcts) < 25, \
        "deriva de %.1f pp: amostra pequena vazou para a série" % (max(pcts) - min(pcts))

    cl = classes()
    assert cl and cl[0]["n"] >= 300 and all(x["n"] >= 300 for x in cl)
    org = orgaos()
    assert org and all(0 <= x["reforma_pct"] <= 100 for x in org)

    cal = calibracao()
    if cal["calibrado"]:
        t = cal["transferencia"]
        assert all(t[i]["calibrado"] <= t[i + 1]["calibrado"] + 1e-9
                   for i in range(len(t) - 1)), "a transferência não é monótona"
        assert all(0.01 <= x["calibrado"] <= 0.99 for x in t)

    a = abstencao()
    assert a["observado"] is True
    if a["n"]:
        assert a["decide"] + a["nao_decide"] == a["n"]

    d = documentos()
    assert d["indexadas"] == c["total"]

    print("acervo: %d decisões, %d com inteiro teor, %s a %s"
          % (c["total"], c["com_inteiro_teor"], c["primeiro_ano"], c["ultimo_ano"]))
    print("reforma por ano: %.1f%% a %.1f%% (deriva de %.1f pp)"
          % (min(pcts), max(pcts), max(pcts) - min(pcts)))
    print("%d classes e %d câmaras com n>=300" % (len(cl), len(org)))
    print("calibrador: %s%s"
          % ("sim" if cal["calibrado"] else "não",
             "" if not cal["calibrado"] else
             (", com curva de confiabilidade" if cal["tem_curva"]
              else ", SEM curva (gerado antes da fase 5 — reajuste para tê-la)")))
    print("documentos .rtf em disco: %s" % d["rtf"])
    print("consultas registradas: %d (cravou em %s)"
          % (a["n"], "—" if not a["n"] else "%.0f%%" % a["cobertura_pct"]))
    print("self-check OK — agregações fecham com o total e a transferência é monótona")
