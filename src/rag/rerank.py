"""Re-ranking: o BM25 diz o que PARECE com o caso; isto diz o que VALE mais.

O BM25 so' enxerga texto. Para ele, um acordao de 2011 revogado e um de 2025
ancorado em tema repetitivo sao a mesma coisa se as palavras baterem igual.
Aqui entram os sinais da ficha de procedencia (src/rag/sinais.py) como
multiplicadores em cima do score que ja' foi medido e ja' funciona.

    pontos = |bm25| * recencia * ancora * unanimidade * efeito * feedback

Nada nesta lista INVENTA relevancia — tudo modula a que o BM25 achou. E' de
proposito: o BM25 foi calibrado em 400 casos cegos, os multiplicadores abaixo
comecaram como chute. Com "rerank": {"ativo": false} no config, o modulo vira
identidade e o sistema volta a ser exatamente o da fase 2.

    python -m src.rag.rerank                      # self-check
    python -m src.rag.rerank "efeito suspensivo"  # ve o antes e o depois
"""
import datetime as dt
import json
import sys

from .llm import config

PADRAO = {
    "ativo": True,
    "meia_vida_anos": 6.0,      # decisao de 6 anos atras vale metade de uma de hoje
    "piso_recencia": 0.5,       # ... mas nunca menos que isso: lei velha ainda e' lei
    "ancora": {"vinculante": 1.35, "persuasiva": 1.15, "estadual": 1.0},
    "nao_unanime": 0.85,
    "transitou": 1.10,
    "subiu_sem_transito": 0.90,
    "sobrestado": 0.80,
}


def _cfg():
    c = dict(PADRAO)
    c.update(config().get("rerank") or {})
    return c


def _recencia(ano, cfg, ano_ref):
    if not ano:
        return 1.0
    idade = max(0, ano_ref - int(ano))
    return max(cfg["piso_recencia"], 0.5 ** (idade / cfg["meia_vida_anos"]))


def _efeito_fator(efeito, cfg):
    """Datajud: o que aconteceu com a decisao depois de publicada."""
    if not efeito:
        return 1.0, None
    if isinstance(efeito, str):
        try:
            efeito = json.loads(efeito)
        except ValueError:
            return 1.0, None
    if efeito.get("sobrestado"):
        return cfg["sobrestado"], "sobrestado"
    if efeito.get("subiu") and not efeito.get("transitou"):
        return cfg["subiu_sem_transito"], "subiu para STJ/STF sem trânsito"
    if efeito.get("transitou"):
        return cfg["transitou"], "transitou em julgado"
    return 1.0, None


def fatores(cand, cfg=None, ano_ref=None, boost=None):
    """Devolve {nome: fator} — o que empurrou o candidato para cima ou para baixo.

    Existe separado de pontuar() porque o relatorio precisa MOSTRAR o porque.
    Ranking que nao explica a propria ordem e' o mesmo problema que o RAG veio
    resolver."""
    cfg = cfg or _cfg()
    ano_ref = ano_ref or dt.date.today().year
    f = {}
    r = _recencia(cand.get("ano"), cfg, ano_ref)
    if abs(r - 1.0) > 1e-9:
        f["idade"] = r
    a = cfg["ancora"].get(cand.get("ancora") or "estadual", 1.0)
    if abs(a - 1.0) > 1e-9:
        f["âncora %s" % cand.get("ancora")] = a
    if cand.get("unanime") == 0:
        f["não unânime"] = cfg["nao_unanime"]
    e, rotulo = _efeito_fator(cand.get("efeito"), cfg)
    if rotulo:
        f[rotulo] = e
    if boost:
        b = boost.get(cand.get("id"))
        if b:
            f["seu feedback"] = b
    return f


def pontuar(cand, cfg=None, ano_ref=None, boost=None):
    """Quanto maior, melhor. O BM25 e' negativo (menor = melhor) — invertido aqui."""
    cfg = cfg or _cfg()
    base = max(0.1, -float(cand.get("score") or -1.0))
    if not cfg.get("ativo", True):
        return base
    p = base
    for v in fatores(cand, cfg, ano_ref, boost).values():
        p *= v
    return p


def ordenar(candidatos, limite=None, boost=None, ano_ref=None):
    """Reordena no lugar-conceitual: devolve lista nova com 'pontos' e 'porque_rank'."""
    cfg = _cfg()
    ano_ref = ano_ref or dt.date.today().year
    saida = []
    for c in candidatos:
        f = fatores(c, cfg, ano_ref, boost) if cfg.get("ativo", True) else {}
        d = dict(c)
        d["pontos"] = pontuar(c, cfg, ano_ref, boost)
        d["porque_rank"] = f
        saida.append(d)
    saida.sort(key=lambda d: -d["pontos"])
    return saida[:limite] if limite else saida


def explicar(cand):
    """'2019 · âncora vinculante · transitou · 1.42x' para o relatorio."""
    f = cand.get("porque_rank") or {}
    if not f:
        return "sem ajuste (só BM25)"
    total = 1.0
    for v in f.values():
        total *= v
    return "%s → %.2fx" % (
        " · ".join("%s %.2f" % (k, v) for k, v in f.items()), total)


if __name__ == "__main__":
    from . import busca

    # --- identidade quando desligado
    base = [{"id": 1, "score": -5.0, "ano": 2011, "ancora": "estadual", "unanime": 0},
            {"id": 2, "score": -4.0, "ano": 2025, "ancora": "vinculante",
             "efeito": '{"transitou": true}'}]
    desligado = dict(PADRAO, ativo=False)
    assert [c["id"] for c in sorted(base, key=lambda c: -pontuar(c, desligado))] == [1, 2]

    # --- o caso que motivou o modulo: mesmo BM25, procedencias opostas
    velho = {"id": 1, "score": -5.0, "ano": 2011, "ancora": "estadual", "unanime": 0}
    novo = {"id": 2, "score": -5.0, "ano": 2025, "ancora": "vinculante",
            "unanime": 1, "efeito": '{"transitou": true}'}
    r = ordenar([velho, novo], ano_ref=2026)
    assert r[0]["id"] == 2, r
    assert pontuar(velho, ano_ref=2026) < pontuar(novo, ano_ref=2026)
    # e o BM25 sozinho os empataria
    assert velho["score"] == novo["score"]

    # --- piso: decisao de 2000 nao pode ser zerada
    antiga = {"id": 3, "score": -10.0, "ano": 2000}
    assert pontuar(antiga, ano_ref=2026) >= 10.0 * PADRAO["piso_recencia"] - 1e-9

    # --- sobrestado perde para transitado com o mesmo texto e a mesma idade
    a = {"id": 4, "score": -5.0, "ano": 2024, "efeito": '{"sobrestado": true}'}
    b = {"id": 5, "score": -5.0, "ano": 2024, "efeito": '{"transitou": true}'}
    assert pontuar(a, ano_ref=2026) < pontuar(b, ano_ref=2026)

    # --- feedback do usuario continua funcionando, agora aqui
    r = ordenar([{"id": 9, "score": -1.0, "ano": 2024},
                 {"id": 8, "score": -9.0, "ano": 2024}], boost={9: 1.3})
    assert r[0]["id"] == 8, "o feedback nao pode virar o jogo sozinho (teto ±30%)"
    r = ordenar([{"id": 9, "score": -8.0, "ano": 2024},
                 {"id": 8, "score": -9.0, "ano": 2024}], boost={9: 1.3})
    assert r[0]["id"] == 9, "feedback nao promoveu um empate tecnico"

    # --- dados reais: a ordem muda, e da' para explicar por que
    q = busca.montar_consulta(sys.argv[1:] or ["prescrição intercorrente",
                                               "honorários recursais"])
    bruto = busca.buscar(q, limite=40)
    assert bruto, "indice vazio? rode: python -m src.rag.indexar"
    novo_ = ordenar(bruto, limite=8)
    antes = [c["id"] for c in bruto[:8]]
    depois = [c["id"] for c in novo_]
    print("consulta: %s\n" % q)
    print("%-4s %-24s %-6s %-12s %-4s %s"
          % ("#", "numero", "ano", "âncora", "un.", "por que subiu/desceu"))
    for i, c in enumerate(novo_, 1):
        print("%-4d %-24s %-6s %-12s %-4s %s"
              % (i, c["numero"][:24], c["ano"], (c["ancora"] or "?")[:12],
                 {1: "sim", 0: "NÃO"}.get(c["unanime"], "?"), explicar(c)))
    trocas = sum(a != b for a, b in zip(antes, depois))
    print("\ntop-8 do BM25 puro:  %s" % antes)
    print("top-8 reordenado:    %s" % depois)
    print("%d posições mudaram." % trocas)
    print("self-check OK — rerank ordena e explica; desligado, é identidade")
