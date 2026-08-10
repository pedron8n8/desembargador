"""Qual modelo escrever a minuta? A pergunta só tem resposta medida.

O truque que torna isso barato e honesto: para casos que ele JÁ julgou, o
gabarito existe. Então o juiz não precisa opinar sobre qual minuta é mais
bonita — ele compara cada minuta com a decisão que o desembargador realmente
escreveu. Isso desarma as patologias do juiz-LLM (viés de tamanho, de posição,
autopreferência) porque a nota vira concordância com um fato.

  python -m src.rag.bench --listar               # candidatos e custo estimado
  python -m src.rag.bench -n 8 --confirmar       # roda de verdade (gasta)
  python -m src.rag.bench -n 8 --modelos z-ai/glm-4.7 moonshotai/kimi-k2.5 --confirmar

Entrada de cada caso = o RELATÓRIO da decisão real (a parte que descreve o caso,
entre 'RELATÓRIO' e 'é o relatório'), que fica ANTES da fundamentação e depois
da ementa — não vaza o desfecho. A própria decisão sai do índice.
"""
import argparse
import json
import os
import random
import re
import sqlite3
import statistics
import sys

from .. import cerebros
from . import grafo
from .classificador import normaliza
from .llm import SemCredito, config

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TJSC = os.path.join(RAIZ, "output", "tjsc.db")
RAG = os.path.join(RAIZ, "output", "rag.db")
CEREBRO = None          # preenchido pelo --cerebro; None = o padrao

_INICIO = re.compile(r"RELAT[ÓO]RIO")
_FIM = re.compile(r"(?i)[ée]\s+o\s+relat[óo]rio|\bVOTO\b")
# A fórmula "Vistos, relatados e discutidos estes autos" é o que separa a ementa
# do corpo do acórdão. Sem ancorar nela, uma ementa que contenha a palavra
# "RELATÓRIO" (p.ex. "RELATÓRIO MÉDICO E INDICAÇÃO DO TRATAMENTO") faz a
# extração começar dentro da própria ementa — e aí o desfecho vaza para o teste.
_POS_EMENTA = re.compile(r"(?i)VISTOS,?\s+RELATADOS\s+E\s+DISCUTIDOS[^.]{0,120}\.")


def extrair_relatorio(teor, minimo=900):
    """A parte que descreve o caso. '' se a decisão não tiver a marcação."""
    t = re.sub(r"\s+", " ", (teor or "").replace("\xa0", " "))
    corpo = _POS_EMENTA.search(t)
    if corpo:
        t = t[corpo.end():]
    m = _INICIO.search(t)
    if m:
        t = t[m.end():]
    elif not corpo:
        return ""
    f = _FIM.search(t)
    trecho = (t[:f.start()] if f else t[:12000]).strip()
    return trecho if len(trecho) >= minimo else ""


def casos(n, ano_min, seed):
    tj = sqlite3.connect("file:%s?mode=ro" % TJSC.replace("\\", "/"), uri=True)
    rg = sqlite3.connect("file:%s?mode=ro" % RAG.replace("\\", "/"), uri=True)
    ids = [r[0] for r in rg.execute(
        "SELECT id FROM decisao WHERE ano >= ? AND confianca='dispositivo' "
        "AND resultado IN ('provido','parcialmente provido','desprovido') "
        "AND tem_teor=1", (ano_min,))]
    random.seed(seed)
    random.shuffle(ids)
    saida = []
    for i in ids:
        teor, = tj.execute("SELECT inteiro_teor FROM decisoes WHERE id=?", (i,)).fetchone()
        rel = extrair_relatorio(teor)
        if not rel:
            continue
        num, res = rg.execute("SELECT numero, resultado FROM decisao WHERE id=?",
                              (i,)).fetchone()
        saida.append({"id": i, "numero": num, "resultado": res,
                      "relatorio": rel, "teor": teor})
        if len(saida) >= n:
            break
    tj.close()
    rg.close()
    return saida


CASOS_JSON = os.path.join(RAIZ, "output", "bench_casos.json")


def carregar_casos_feitos(caminho=CASOS_JSON):
    """[(modelo, numero)] ja' medidos e pagos, para nunca medir duas vezes."""
    if not os.path.exists(caminho):
        return []
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (ValueError, OSError):
        return []


def rodar(modelo, casos_, verboso=True, feitos=None, ao_salvar=None):
    """Roda o grafo em cada caso com `modelo` no no 'redigir'.

    `feitos` sao registros ja' medidos (pulados sem gastar), e `ao_salvar` e'
    chamado DEPOIS DE CADA CASO. A granularidade e' por caso de proposito: uma
    execucao anterior foi interrompida no meio e perdeu tres modelos ja' pagos
    porque so' gravava no fim. Nenhuma chamada paga pode morrer sem registro.
    """
    cfg = config()
    original = cfg["modelos"]["redigir"]
    cfg["modelos"]["redigir"] = modelo
    # ABSTENCAO DESLIGADA AQUI, de proposito. O bench pergunta "qual modelo
    # escreve a melhor minuta?", e o criterio e' se o dispositivo bateu com o
    # real. Com a abstencao ligada, ~60% dos casos viram minuta de dois caminhos
    # sem desfecho definido: a coluna 'disp' perde o sentido e o texto dobra de
    # tamanho (na primeira tentativa, 4 de 8 minutas estouraram o teto de tokens
    # e cada refacao dobrou o custo do caso). Abster-se e' recurso de produto,
    # nao modo de bancada.
    conf_orig = cfg.get("confianca") or {}
    cfg["confianca"] = {**conf_orig, "corte_margem": 0.0, "min_precedentes": 0,
                        "concordancia_minima": 0.0, "desacordo_maximo": 1.0}
    app = grafo.construir()          # sem checkpoint: cada rodada é independente
    ja = {r["numero"] for r in (feitos or []) if r["modelo"] == modelo}
    linhas = [r for r in (feitos or []) if r["modelo"] == modelo]
    try:
        for k, c in enumerate(casos_, 1):
            if c["numero"] in ja:
                if verboso:
                    print("  [%s] %d/%d %s — já medido, pulando"
                          % (modelo, k, len(casos_), c["numero"]), flush=True)
                continue
            if verboso:
                print("  [%s] %d/%d %s" % (modelo, k, len(casos_), c["numero"]),
                      flush=True)
            e = app.invoke(
                {"caso": c["relatorio"], "custos": [], "criticas": [],
                 "ciclo_revisao": 0, "decisao_real": c["teor"],
                 "cerebro": CEREBRO or cerebros.padrao(),
                 "filtros": {"excluir": (c["id"],)}},
                config={"recursion_limit": 30})
            j = e.get("julgamento") or {}
            linhas.append({
                "modelo": modelo,
                "numero": c["numero"], "real": c["resultado"],
                "previsto": (e.get("prognostico") or {}).get("resultado_provavel"),
                "notas": j.get("notas") or {}, "media": j.get("media"),
                "resumo": j.get("resumo", ""),
                "custo": sum(x["custo_usd"] for x in e.get("custos") or []),
                "custo_redigir": sum(x["custo_usd"] for x in e.get("custos") or []
                                     if x["no"] == "redigir"),
            })
            if ao_salvar:
                ao_salvar(linhas[-1])
    finally:
        cfg["modelos"]["redigir"] = original
        cfg["confianca"] = conf_orig
    return linhas


def resumir(modelo, linhas):
    ok = [l for l in linhas if l["media"] is not None]
    med = lambda c: statistics.mean([l["notas"][c] for l in ok if c in l["notas"]] or [0])
    return {
        "modelo": modelo, "n": len(ok),
        "media": round(statistics.mean([l["media"] for l in ok]), 2) if ok else 0,
        "dispositivo": round(med("dispositivo"), 2),
        "fundamentos": round(med("fundamentos"), 2),
        "fidelidade": round(med("fidelidade"), 2),
        "acerto_prognostico": round(
            100 * sum(l["previsto"] == l["real"] for l in linhas) / len(linhas), 1)
        if linhas else 0,
        "custo_total": round(sum(l["custo"] for l in linhas), 4),
        "custo_redigir": round(sum(l["custo_redigir"] for l in linhas), 4),
    }


def main(argv=None):
    cfg = config()
    cands = list(cfg["_candidatos_redigir"])
    cands = [c for c in cands if not c.startswith("_")]

    ap = argparse.ArgumentParser(description="Compara modelos no nó 'redigir'")
    ap.add_argument("-n", type=int, default=6, help="casos por modelo")
    ap.add_argument("--ano-min", type=int, default=2024)
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--modelos", nargs="*", default=None)
    ap.add_argument("--listar", action="store_true")
    ap.add_argument("--continuar", action="store_true",
                    help="aproveita output/bench.json e só mede o que falta")
    ap.add_argument("--confirmar", action="store_true",
                    help="obrigatório: sem isso não gasta nada")
    cerebros.argumento(ap, "acervo do qual tirar os casos com gabarito")
    a = ap.parse_args(argv)
    modelos = a.modelos or cands

    # o bench le' gabarito do acervo: os dois bancos e a persona vem do cerebro
    global TJSC, RAG, CEREBRO
    cam = cerebros.caminhos(a.cerebro)
    TJSC, RAG, CEREBRO = cam["tjsc"], cam["rag"], cam["slug"]
    print("cérebro: %s\n" % cam["nome"])

    # Custo do resto do grafo por caso, MEDIDO — nao estimado. Um caso real do
    # bench custou US$ 0,0495 no total com US$ 0,0031 de 'redigir': o resto sao
    # US$ 0,046 fixos por caso, independentes do modelo testado. A maior parte e'
    # o juiz, que no bench le' a decisao real inteira alem da minuta.
    FIXO = 0.017            # triagem + triar + revisar
    JUIZ = 0.029            # juiz com gabarito (bem mais caro que sem)
    tabela = cfg["_candidatos_redigir"]
    est = {m: (tabela.get(m, {}).get("por_chamada_usd", 0.03) + FIXO + JUIZ) * a.n
           for m in modelos}

    print("Bench do nó 'redigir' — %d casos por modelo, juiz com gabarito\n" % a.n)
    print("%-32s %12s %12s" % ("modelo", "US$/chamada", "estimado"))
    for m in modelos:
        print("%-32s %12.4f %12.4f"
              % (m, tabela.get(m, {}).get("por_chamada_usd", 0), est[m]))
    print("%-32s %12s %12.4f" % ("TOTAL", "", sum(est.values())))

    if a.listar:
        return 0
    if not a.confirmar:
        print("\nNada foi gasto. Para rodar de verdade, repita com --confirmar.")
        return 0

    cs = casos(a.n, a.ano_min, a.seed)
    if len(cs) < a.n:
        print("Só %d casos tinham relatório extraível." % len(cs), file=sys.stderr)
    print("\n%d casos, todos escondidos do índice na sua própria consulta.\n" % len(cs))

    caminho = os.path.join(RAIZ, "output", "bench.json")
    # Persistencia POR CASO. Gravar so' no fim ja' custou tres modelos pagos
    # numa execucao interrompida; gravar por modelo ainda perderia ate' quatro
    # casos. Cada caso vai para o disco assim que e' medido, e nada e' medido
    # duas vezes.
    feitos = carregar_casos_feitos() if a.continuar else []
    if feitos:
        por_modelo = {}
        for r in feitos:
            por_modelo[r["modelo"]] = por_modelo.get(r["modelo"], 0) + 1
        print("já pagos e no disco: %s\n"
              % "; ".join("%s (%d)" % kv for kv in sorted(por_modelo.items())))

    def salvar_caso(_linha=None):
        with open(CASOS_JSON, "w", encoding="utf-8") as f:
            json.dump(feitos, f, ensure_ascii=False, indent=2)

    erros = []
    for m in modelos:
        try:
            rodar(m, cs, feitos=feitos,
                  ao_salvar=lambda linha: (feitos.append(linha), salvar_caso()))
        except SemCredito as e:
            print("\n%s\n" % e, file=sys.stderr)
            break
        except KeyboardInterrupt:
            print("\ninterrompido — cada caso medido já está em %s" % CASOS_JSON,
                  file=sys.stderr)
            break
        except Exception as e:                      # um modelo ruim nao derruba o bench
            print("  [%s] falhou: %s" % (m, e), file=sys.stderr)
            erros.append({"modelo": m, "n": 0, "media": 0, "erro": str(e)[:80]})

    salvar_caso()
    por_modelo = {}
    for r in feitos:
        por_modelo.setdefault(r["modelo"], []).append(r)
    resultados = [resumir(m, ls) for m, ls in por_modelo.items()] + erros
    resultados.sort(key=lambda r: -r["media"])
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(resultados, f, ensure_ascii=False, indent=2)
    print("\n%-32s %5s %6s %6s %6s %6s %9s %9s"
          % ("modelo", "n", "média", "disp", "fund", "fidel", "US$ tot", "US$/nota"))
    for r in resultados:
        if not r["n"]:
            print("%-32s   -- %s" % (r["modelo"], r.get("erro", "sem resultado")))
            continue
        print("%-32s %5d %6.2f %6.2f %6.2f %6.2f %9.4f %9.4f"
              % (r["modelo"], r["n"], r["media"], r["dispositivo"], r["fundamentos"],
                 r["fidelidade"], r["custo_total"], r["custo_total"] / max(r["media"], .01)))

    print("\nsalvo em %s" % caminho)
    print("disp = o desfecho bateu com o real. É o critério que mais importa —\n"
          "uma minuta linda com o dispositivo trocado é pior que inútil.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        sys.exit(main())

    # self-check offline: o relatorio extraido nao pode conter a ementa, que e'
    # onde o desfecho do recurso aparece.
    tj = sqlite3.connect("file:%s?mode=ro" % TJSC.replace("\\", "/"), uri=True)
    linhas = tj.execute(
        "SELECT ementa, inteiro_teor FROM decisoes WHERE categoria='acordaos' "
        "AND length(inteiro_teor) > 6000 AND length(ementa) > 600 LIMIT 400").fetchall()
    tj.close()

    n = vaz = 0
    for ementa, teor in linhas:
        rel = extrair_relatorio(teor)
        if not rel:
            continue
        n += 1
        # a conclusao da ementa (ultimos 120 chars) e' a frase que entrega tudo
        cauda = normaliza(re.sub(r"\(TJSC.*$", "", ementa))[-120:].strip()
        if len(cauda) > 60 and cauda in normaliza(rel):
            vaz += 1
    assert n > 200, "amostra pequena demais para concluir (%d)" % n
    assert vaz == 0, "%d de %d relatorios continham a conclusao da ementa" % (vaz, n)
    print("self-check OK — %d relatorios extraidos, 0 com a ementa dentro" % n)

    # --- persistencia: nenhuma chamada paga pode ser repetida ou perdida.
    # Se todos os casos ja' estao no disco, rodar() nao pode tocar a rede — o
    # teste seria caro se estivesse errado, e e' de graca se estiver certo.
    falsos = [{"id": 1, "numero": "111", "resultado": "provido",
               "relatorio": "r", "teor": "t"},
              {"id": 2, "numero": "222", "resultado": "desprovido",
               "relatorio": "r", "teor": "t"}]
    ja_feitos = [{"modelo": "x/y", "numero": n_, "real": "provido",
                  "previsto": "provido", "notas": {"dispositivo": 5}, "media": 5.0,
                  "custo": 0.01, "custo_redigir": 0.01} for n_ in ("111", "222")]
    salvos = []
    devolvidas = rodar("x/y", falsos, verboso=False, feitos=list(ja_feitos),
                       ao_salvar=salvos.append)
    assert salvos == [], "gastou de novo em caso ja' medido"
    assert len(devolvidas) == 2, devolvidas

    # um caso novo entre os ja' feitos: o callback tem que disparar por CASO,
    # nao so' no fim do modelo
    import inspect
    fonte = inspect.getsource(rodar)
    assert "ao_salvar(linhas[-1])" in fonte, \
        "a gravacao saiu de dentro do laco — voltaria a perder casos pagos"
    assert carregar_casos_feitos("nao_existe.json") == []
    print("persistência OK — caso já medido não é remedido, e cada caso novo"
          "\n  vai ao disco assim que termina")
    print("cobertura: %d de %d decisoes tinham a marcacao de relatorio (%.0f%%)"
          % (n, len(linhas), 100 * n / len(linhas)))
