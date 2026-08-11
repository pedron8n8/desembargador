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

from .. import cerebros
from .busca import RAG, _db
from .calibrar import MODELO, carregar
from .feedback import FB

MERITO = "resultado IN ('provido','parcialmente provido','desprovido')"
REFORMA = "resultado IN ('provido','parcialmente provido')"


def _rag(banco):
    """Leitura pura: aqui o default e' o cerebro padrao, e nao um erro.

    Diferente de busca.buscar — que responde consulta e onde acervo trocado e'
    dano — estas agregacoes so' alimentam telas, e cada chamador da web ja' passa
    o cerebro escolhido explicitamente.
    """
    return banco or cerebros.caminhos()["rag"]


def corpus(banco=None, minimo_ano=300):
    """O acervo que treinou o modelo, em numeros.

    `minimo_ano` corta os anos de amostra pequena da serie de reforma — e' o
    mesmo _MIN=300 do src/rag/deriva.py, e pela mesma razao. Sem ele, 2000 (3
    decisoes) e 2026 (ano em curso) fazem a serie ir de 5% a 78% e o grafico
    anuncia uma "deriva de 72 pp" que e' ruido de denominador. A deriva real
    medida entre anos com amostra e' de ~11 pp.
    """
    db = _db(_rag(banco))
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


def _por_campo(campo, minimo, banco=None):
    return [{"rotulo": v or "?", "n": n, "reforma_pct": round(p, 1)}
            for v, n, p in _db(_rag(banco)).execute(
        "SELECT %s, count(*) c, 100.0*sum(%s)/count(*) FROM decisao "
        "WHERE %s GROUP BY 1 HAVING c >= ? ORDER BY c DESC"
        % (campo, REFORMA, MERITO), (minimo,))]


def classes(minimo=300, banco=None):
    return _por_campo("classe", minimo, banco)


def orgaos(minimo=300, banco=None):
    """'Por quem' aqui e' QUAL CAMARA. Cada cerebro e' um relator so' — dentro de
    um acervo nao da' para comparar relatores, e o relatorio diz isso. Para
    comparar DOIS relatores, rode a mesma peca em dois cerebros."""
    return _por_campo("orgao", minimo, banco)


def calibracao(caminho=None):
    """A funcao de transferencia e, se o .pkl a tiver, a curva de confiabilidade.

    Calibradores gerados antes da fase 5 nao tem as curvas dentro (elas eram
    impressas e jogadas fora). Nesse caso devolve so' a transferencia e diz que
    falta — que e' honesto; regenerar exige rodar o pipeline cego duas vezes.
    """
    caminho = caminho or cerebros.caminhos()["calibrador"]
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
        "transferencia": [{"bruto": round(p, 3),
                           "calibrado": round(aplicar(p, caminho), 4)}
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


def abstencao(banco=FB, cerebro=None):
    """Com que frequencia o sistema CRAVOU, nas consultas que voce rodou.

    Nao e' o numero do benchmark. Aquele mede 400 casos cegos com gabarito;
    este mede o seu uso real, que tem outra distribuicao de casos.

    `cerebro` filtra por acervo. Sem ele, a pagina de estatisticas de um cerebro
    novo mostrava as consultas de OUTRO — "13 consultas, cravou em 0%" num
    acervo em que ninguem consultou nada ainda.
    """
    if not os.path.exists(banco):
        return {"n": 0, "observado": True}
    c = sqlite3.connect("file:%s?mode=ro" % banco.replace("\\", "/"), uri=True)
    try:
        linhas = [r[0] for r in c.execute(
            "SELECT prognostico_json FROM consulta WHERE prognostico_json IS NOT NULL "
            "AND (?1 IS NULL OR cerebro = ?1)", (cerebro,))]
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


def documentos(banco=None, tjsc=None):
    """Os documentos que alimentaram o indice: quantos, e quantos tem texto."""
    banco = _rag(banco)
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
    import argparse

    ap = argparse.ArgumentParser(description="Agregações sobre o acervo")
    cerebros.argumento(ap)
    a_ = ap.parse_args()
    cam = cerebros.caminhos(a_.cerebro)
    if not os.path.exists(cam["rag"]):
        raise SystemExit("índice de %s não existe — rode: python -m src.rag.indexar "
                         "--cerebro %s" % (cam["nome"], cam["slug"]))
    print("cérebro: %s\n" % cam["nome"])

    c = corpus(cam["rag"])
    # Consistencia interna: vale em acervo de qualquer tamanho. O que NAO se
    # afirma mais aqui e' um piso de tamanho — cerebro novo comeca pequeno, e
    # isso e' fato a relatar, nao defeito a reprovar. Quem cobra tamanho e' o
    # portao do prognostico (src/rag/grafo.py), que se recusa a cravar.
    assert c["primeiro_ano"] <= c["ultimo_ano"]
    soma = sum(x["n"] for x in c["por_resultado"])
    assert soma == c["total"], (soma, c["total"])
    assert all(0 <= x["reforma_pct"] <= 100 for x in c["por_ano"])
    assert all(x["n"] >= 300 for x in c["por_ano"]), \
        "amostra menor que o mínimo vazou para a série por ano"

    pcts = [x["reforma_pct"] for x in c["por_ano"]]
    if len(pcts) >= 2:
        # a deriva de epoca tem que aparecer — e tem que ser a de verdade
        # (~11 pp no acervo do Rubens), nao a inflada por anos de 3 decisoes
        assert 0 < max(pcts) - min(pcts) < 25, \
            ("deriva de %.1f pp: amostra pequena vazou para a série"
             % (max(pcts) - min(pcts)))
    else:
        print("AVISO: só %d ano(s) com n>=300 — sem série temporal para medir "
              "deriva neste acervo.\n" % len(pcts))

    cl = classes(banco=cam["rag"])
    assert all(x["n"] >= 300 for x in cl)
    org = orgaos(banco=cam["rag"])
    assert all(0 <= x["reforma_pct"] <= 100 for x in org)

    cal = calibracao(cam["calibrador"])
    if cal["calibrado"]:
        t = cal["transferencia"]
        assert all(t[i]["calibrado"] <= t[i + 1]["calibrado"] + 1e-9
                   for i in range(len(t) - 1)), "a transferência não é monótona"
        assert all(0.01 <= x["calibrado"] <= 0.99 for x in t)

    a = abstencao(cerebro=cam["slug"])
    assert a["observado"] is True
    if a["n"]:
        assert a["decide"] + a["nao_decide"] == a["n"]

    d = documentos(cam["rag"], cam["tjsc"])
    assert d["indexadas"] == c["total"]

    print("acervo: %d decisões, %d com inteiro teor, %s a %s"
          % (c["total"], c["com_inteiro_teor"], c["primeiro_ano"], c["ultimo_ano"]))
    if len(pcts) >= 2:
        print("reforma por ano: %.1f%% a %.1f%% (deriva de %.1f pp)"
              % (min(pcts), max(pcts), max(pcts) - min(pcts)))
    print("%d classes e %d câmaras com n>=300" % (len(cl), len(org)))
    # o numero que decide se vale treinar a floresta e se o prognostico pode cravar
    print("decisões de mérito: %d" % cerebros.saude(cam["slug"])["n_merito"])
    print("calibrador: %s%s"
          % ("sim" if cal["calibrado"] else "não",
             "" if not cal["calibrado"] else
             (", com curva de confiabilidade" if cal["tem_curva"]
              else ", SEM curva (gerado antes da fase 5 — reajuste para tê-la)")))
    print("documentos .rtf em disco: %s" % d["rtf"])
    print("consultas registradas: %d (cravou em %s)"
          % (a["n"], "—" if not a["n"] else "%.0f%%" % a["cobertura_pct"]))
    print("self-check OK — agregações fecham com o total e a transferência é monótona")
