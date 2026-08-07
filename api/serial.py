"""Estado do LangGraph -> JSON. Nada de logica nova: so' tradutor.

Regra que vale para o arquivo inteiro: quando o front precisa de um numero que o
sistema ja' calculou, ele vem da MESMA funcao que o grafo usou — rerank.fatores,
grafo.peso, sinais.resumir_ficha, calibrar.calibrado. Recalcular com formula
copiada aqui e' como o painel de pesos passa a mentir sem ninguem perceber.

A ordem dos campos e' a de cli.formatar, e ela nao e' estetica: evidencia antes
de veredito. Quem le' o percentual primeiro ancora nele e le' o resto procurando
confirmacao.

    python -m api.serial      # self-check com estado sintetico
"""
import json

from src.rag import calibrar, confianca, feedback, grafo, rerank, sinais
from src.rag.llm import config

# Campos de um precedente que o front usa. Recortar de proposito: `ementa` e
# `dispositivo` sao grandes e o estado tem 8 deles + ate' 88 candidatos.
_PRECEDENTE = ("id", "numero", "tipo", "classe", "orgao", "comarca", "data",
               "ano", "url", "resultado", "confianca", "tem_teor", "ancora",
               "unanime", "score", "pontos", "nota", "por_que",
               # veredito da triagem no modo tese: a_favor | contra | neutro.
               # Vazio no modo neutro, onde a pergunta nao e' feita.
               "lado")


def _json(v):
    """`efeito` e `ancoras_json` chegam do SQLite como texto JSON."""
    if isinstance(v, str):
        try:
            return json.loads(v) if v else None
        except ValueError:
            return None
    return v


def precedente(d, ementa_chars=1200):
    p = {k: d.get(k) for k in _PRECEDENTE}
    p["ementa"] = (d.get("ementa") or "")[:ementa_chars]
    p["ementa_truncada"] = len(d.get("ementa") or "") > ementa_chars
    p["ancoras"] = _json(d.get("ancoras_json")) or []
    p["efeito"] = _json(d.get("efeito"))
    p["ficha"] = sinais.resumir_ficha(d)
    # porque_rank e' o que o rerank fez NAQUELA consulta. Recalcular hoje daria
    # outro fator de idade — o painel mostraria um ranking que nunca existiu.
    p["porque_rank"] = d.get("porque_rank") or {}
    p["explicacao_rank"] = rerank.explicar(d)
    return p


def consulta(thread, estado, segundos=None, markdown=None):
    """O relatorio inteiro, na ordem do cli.formatar."""
    prec = estado.get("precedentes") or []
    custos = estado.get("custos") or []
    return {
        "thread": thread,
        "segundos": segundos,
        "caso": estado.get("caso") or "",
        "tese": estado.get("tese") or "neutra",
        "filtros": estado.get("filtros") or {},
        # --- leitura do caso
        "triagem": estado.get("triagem") or {},
        "consulta_fts": estado.get("consulta") or "",
        # --- EVIDENCIAS (vem antes; ver o docstring)
        "precedentes": [precedente(d) for d in prec],
        # No modo tese os PRECEDENTES ja' sao a sustentacao — a triagem so'
        # deixou passar quem sustenta o lado pedido. Nao ha' mais duas listas.
        # `descartados` e' a evidencia que sobrou dessa escolha: quantos
        # candidatos analogos decidiam CONTRA e por isso ficaram de fora.
        "sustentacao": [],   # mantido vazio: o front antigo espera a chave
        "descartados": estado.get("descartados") or {},
        "comuns": estado.get("comuns") or {},
        "perfil": estado.get("perfil") or {},
        "contra": estado.get("contra") or {},
        "n_candidatos": len(estado.get("candidatos") or []),
        # --- veredito
        "prognostico": estado.get("prognostico") or {},
        # --- minuta e criticas
        "minuta": estado.get("minuta") or "",
        "criticas": estado.get("criticas") or [],
        "julgamento": estado.get("julgamento") or {},
        # --- rastro
        "custos": [dict(c) for c in custos],
        "custo_total": round(sum(c.get("custo_usd", 0.0) for c in custos), 6),
        "markdown": markdown,
    }


def resumo(estado, thread=None):
    """A linha da lista de consultas. So' o que cabe numa tabela."""
    p = estado.get("prognostico") or {}
    t = estado.get("triagem") or {}
    return {
        "thread": thread,
        "materia": t.get("materia") or "",
        "classe": t.get("classe") or "",
        "tese": estado.get("tese") or "neutra",
        "decide": p.get("decide"),
        "probabilidade_pct": p.get("probabilidade_pct"),
        "resultado_provavel": p.get("resultado_provavel"),
        "n_precedentes": len(estado.get("precedentes") or []),
        "custo_usd": round(sum(c.get("custo_usd", 0.0)
                               for c in (estado.get("custos") or [])), 6),
        "tem_minuta": bool(estado.get("minuta")),
    }


# ------------------------------------------------------------------- pesos

def pesos(estado):
    """Todo multiplicador que produziu o prognostico, com o numero na mao.

    E' o painel que justifica a interface existir: o relatorio em markdown ja'
    dizia "1.42x", mas nao dizia de onde vinham os fatores nem quanto cada
    precedente pesou no total.
    """
    prec = estado.get("precedentes") or []
    prog = estado.get("prognostico") or {}
    cfg = config()

    linhas = []
    for d in prec:
        fat = d.get("porque_rank") or {}
        produto = 1.0
        for v in fat.values():
            produto *= v
        pc = grafo.PESO_CONFIANCA.get(d.get("confianca"), 0.5)
        nota_norm = d.get("nota", 5) / 5.0
        linhas.append({
            "id": d.get("id"), "numero": d.get("numero"),
            "resultado": d.get("resultado"), "ano": d.get("ano"),
            "bm25": d.get("score"),
            "base": max(0.1, -float(d.get("score") or -1.0)),
            "fatores": fat,
            "produto_fatores": round(produto, 4),
            "pontos": d.get("pontos"),
            "peso_confianca": pc,
            "rotulo_confianca": d.get("confianca") or "-",
            "nota": d.get("nota"), "nota_norm": nota_norm,
            "peso_final": grafo.peso(d),
        })
    total = sum(l["peso_final"] for l in linhas)
    for l in linhas:
        l["fracao_do_total"] = round(l["peso_final"] / total, 4) if total else 0.0

    rf = prog.get("floresta") or {}
    return {
        "config": {
            "rerank": rerank._cfg(),
            "peso_confianca": grafo.PESO_CONFIANCA,
            "peso_knn": cfg.get("floresta", {}).get("peso_knn"),
            "confianca": confianca._cfg(),
            "calibrado": calibrar.calibrado(),
        },
        "precedentes": linhas,
        "agregacao": {
            "knn": prog.get("reforma_nos_precedentes"),
            "floresta": round(100 * rf["p_reforma"], 1) if rf else None,
            "conjunto": prog.get("reforma_conjunta_pct"),
            "calibrado": prog.get("probabilidade_pct"),
            "intervalo": prog.get("intervalo_pct"),
            "fonte": prog.get("fonte"),
            "acordo": prog.get("acordo"),
            "decide": prog.get("decide"),
            "confianca": prog.get("confianca") or {},
        },
    }


# ---------------------------------------------------------------- historico

# feedback.historico devolve TUPLAS, por posicao, e nao dicts. O mapeamento vive
# colado no SQL que o produz (src/rag/feedback.py:115-125); se aquele SELECT
# mudar de ordem, isto quebra em silencio — por isso o self-check confere.
def historico(termo=None, n=20):
    h = feedback.historico(termo, n)
    return {
        "consultas": [{"thread": t, "criado_em": q, "caso": c, "custo_usd": u}
                      for t, q, c, u in h["consultas"]],
        "precedentes": [{"numero": num, "id": i, "vezes": v, "ultima": q,
                         "uteis": ut or 0, "inuteis": inu or 0}
                        for num, i, v, q, ut, inu in h["precedentes"]],
    }


if __name__ == "__main__":
    falso = {
        "caso": "Apelação sobre prescrição intercorrente.",
        "tese": "reformar",
        "triagem": {"classe": "Apelação Cível", "materia": "prescrição",
                    "tese": "x", "pedidos": ["a"], "termos": ["prescrição"]},
        "consulta": '"prescrição intercorrente"',
        "candidatos": [{}] * 40,
        "precedentes": [
            {"id": 1, "numero": "A", "resultado": "provido", "confianca": "dispositivo",
             "nota": 5, "score": -9.0, "pontos": 12.0, "ano": 2024, "classe": "Ap",
             "ancora": "vinculante", "unanime": 1, "ementa": "e" * 3000,
             "ancoras_json": '["Tema 1059/STJ"]', "efeito": '{"transitou": true}',
             "porque_rank": {"âncora vinculante": 1.35, "transitou em julgado": 1.10}},
            {"id": 2, "numero": "B", "resultado": "desprovido", "confianca": "ementa",
             "nota": 3, "score": -4.0, "pontos": 3.0, "ano": 2011, "classe": "Ap",
             "ancora": "estadual", "unanime": 0, "ementa": "f",
             "porque_rank": {"idade": 0.5, "não unânime": 0.85}},
        ],
        "prognostico": {"probabilidade_pct": 71.0, "decide": True,
                        "reforma_nos_precedentes": 80.0,
                        "reforma_conjunta_pct": 71.0,
                        "floresta": {"p_reforma": 0.62}, "intervalo_pct": [55.0, 85.0]},
        "minuta": "# RELATÓRIO", "custos": [
            {"no": "triagem", "modelo": "m", "tokens_in": 10, "tokens_out": 5,
             "custo_usd": 0.01}],
    }

    c = consulta("t1", falso, segundos=12.0)
    # ordem dos campos = ordem do relatorio: evidencia antes de veredito
    chaves = list(c)
    assert chaves.index("precedentes") < chaves.index("prognostico") < \
        chaves.index("minuta"), chaves
    assert c["n_candidatos"] == 40 and c["custo_total"] == 0.01
    p0 = c["precedentes"][0]
    assert p0["ementa_truncada"] and len(p0["ementa"]) == 1200
    assert p0["ancoras"] == ["Tema 1059/STJ"] and p0["efeito"]["transitou"] is True
    assert "vinculante" in p0["ficha"] and "1.49x" in p0["explicacao_rank"], p0
    # o estado nao pode vazar inteiro: ementa/dispositivo grandes ficam de fora
    assert "dispositivo" not in p0 and "ancoras_json" not in p0

    # --- pesos: os numeros tem que fechar
    w = pesos(falso)
    a, b = w["precedentes"]
    assert abs(a["produto_fatores"] - 1.35 * 1.10) < 1e-9, a
    assert a["peso_confianca"] == 1.0 and b["peso_confianca"] == 0.5
    # peso_final = PESO_CONFIANCA x (nota/5) x pontos, e tem que bater com o grafo
    assert abs(a["peso_final"] - 1.0 * 1.0 * 12.0) < 1e-9, a
    assert abs(b["peso_final"] - 0.5 * 0.6 * 3.0) < 1e-9, b
    assert abs(sum(l["fracao_do_total"] for l in w["precedentes"]) - 1.0) < 1e-3
    assert w["agregacao"]["floresta"] == 62.0 and w["agregacao"]["knn"] == 80.0
    assert w["config"]["peso_confianca"]["dispositivo"] == 1.0

    # sem precedente nenhum, nada de divisao por zero
    vazio = pesos({"precedentes": [], "prognostico": {}})
    assert vazio["precedentes"] == [] and vazio["agregacao"]["knn"] is None

    r = resumo(falso, "t1")
    assert r["decide"] is True and r["n_precedentes"] == 2 and r["tem_minuta"]

    # --- o mapeamento por posicao do feedback.historico
    h = historico()
    assert set(h) == {"consultas", "precedentes"}
    for x in h["consultas"]:
        assert set(x) == {"thread", "criado_em", "caso", "custo_usd"}
        assert isinstance(x["custo_usd"], (float, int, type(None))), x
    for x in h["precedentes"]:
        assert isinstance(x["id"], int) and isinstance(x["vezes"], int), x

    print("self-check OK — estado vira JSON na ordem do relatório, e os pesos fecham")
