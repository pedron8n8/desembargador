"""Entrada do segundo cérebro.

  python -m src.rag.cli caso.txt
  python -m src.rag.cli caso.txt --so-prognostico --classe "Apelação Cível"
"""
import argparse
import datetime as dt
import os
import re
import sys

from . import feedback, grafo, rerank, sinais
from .llm import SemChave, SemCredito

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = os.path.join(RAIZ, "output", "consultas")

AVISO = (
    "> **Este documento põe as evidências na mesa. Ele não decide.**\n"
    "> O que vem abaixo são decisões públicas do relator, contadas e ordenadas, "
    "mais uma minuta gerada por IA a partir delas. Não é a posição do "
    "desembargador e não deve ser apresentada como tal. Confira cada citação.\n"
    ">\n"
    "> Quando os dados não sustentam um prognóstico, este relatório diz **NÃO "
    "DECIDO** e mostra as evidências assim mesmo — é o comportamento correto, "
    "não uma falha."
)


def _procedencia(p, prec):
    """As cinco perguntas de procedência, respondidas com o que os dados dão —
    e explicitamente NÃO respondidas onde os dados não dão."""
    perfil = p.get("perfil") or {}
    contra = p.get("contra") or {}
    if not perfil.get("usos"):
        return []
    out = ["## Procedência dos argumentos", "",
           "### Quantas vezes esse argumento já foi usado", "",
           "**%d decisões de mérito**, de %s a %s. Reforma em **%s%%** delas."
           % (perfil["usos"], perfil["primeiro_ano"], perfil["ultimo_ano"],
              perfil["reforma_pct"]), ""]
    for rotulo, chave in (("Em que classes", "por_classe"),
                          ("Por qual câmara", "por_orgao"),
                          ("De que comarcas", "por_comarca")):
        if perfil.get(chave):
            out += ["- **%s:** %s" % (rotulo, "; ".join(
                "%s (%d)" % (v, n) for v, n in perfil[chave][:4]))]
    out += ["",
            "> \"Por quem\" aqui significa **qual câmara** — o acervo é de um "
            "relator só. Não há como comparar relatores com estes dados.", ""]

    out += ["### Vale em território nacional ou só estadual?", "",
            "**%d das %d** (%.0f%%) se ancoram em precedente de alcance nacional "
            "(súmula, tema repetitivo, IRDR ou repercussão geral)."
            % (perfil.get("com_ancora_nacional", 0), perfil["usos"],
               100 * perfil.get("com_ancora_nacional", 0) / perfil["usos"]), "",
            "> **\"Em quais estados\" não é respondível com estes dados.** O acervo "
            "é 100% TJSC. Um argumento ancorado em tema repetitivo do STJ vincula "
            "todo o país; um ancorado só em precedente da própria câmara não diz "
            "nada sobre os outros tribunais. É até aí que a fonte alcança.", ""]

    out += ["### Já existe contra-argumentação?", ""]
    if contra.get("empate"):
        out += ["**Empate.** Os %d precedentes de mérito recuperados se dividem "
                "metade a metade entre reformar e manter. Não há tendência a "
                "extrair daqui — o caso está na fronteira." % contra["de"], ""]
    elif contra.get("contra"):
        out += ["**Sim.** %d dos %d precedentes recuperados decidiram para o lado "
                "oposto ao majoritário (%s): %s."
                % (contra["contra"], contra["de"], contra["lado_majoritario"],
                   ", ".join(e["numero"] for e in contra.get("exemplos", []))), ""]
    else:
        out += ["Nenhum dos precedentes recuperados decidiu para o lado oposto. "
                "Isso é ausência de divergência **nesta busca**, não prova de que "
                "não exista.", ""]
    if perfil.get("nao_unanimes"):
        out += ["No acervo inteiro, **%d** decisões com esse argumento não foram "
                "unânimes (voto vencido ou maioria) — sustentação mais frágil."
                % perfil["nao_unanimes"], ""]

    out += ["### Efeito público posterior", ""]
    ef = [d for d in prec if d.get("efeito")]
    if ef:
        import json as _j
        marcas = {"transitou": 0, "subiu": 0, "sobrestado": 0}
        for d in ef:
            e = _j.loads(d["efeito"]) if isinstance(d["efeito"], str) else d["efeito"]
            for k in marcas:
                marcas[k] += bool(e.get(k))
        out += ["Dos %d precedentes usados, %d têm movimentação no Datajud: "
                "**%d transitaram em julgado**, %d subiram para STJ/STF, "
                "%d estão sobrestados."
                % (len(prec), len(ef), marcas["transitou"], marcas["subiu"],
                   marcas["sobrestado"]), "",
                "> Transitar em julgado é o sinal mais forte que estes dados dão de "
                "que a tese se sustentou: ninguém levou adiante. Não há aqui dado "
                "sobre condenação ou repercussão fora do processo.", ""]
    else:
        out += ["Nenhum dos precedentes usados tem movimentação registrada no "
                "Datajud (o cruzamento cobre 56% do acervo).", ""]
    return out


def formatar(estado, segundos):
    p = estado.get("prognostico") or {}
    prec = estado.get("precedentes") or []
    out = ["# Consulta — %s" % dt.datetime.now().strftime("%d/%m/%Y %H:%M"), "", AVISO, ""]

    t = estado.get("triagem") or {}
    out += ["## Leitura do caso", "",
            "- **Classe:** %s" % t.get("classe", "—"),
            "- **Matéria:** %s" % t.get("materia", "—"),
            "- **Tese:** %s" % t.get("tese", "—"),
            "- **Pedidos:** %s" % ("; ".join(t.get("pedidos") or []) or "—"), ""]

    # EVIDÊNCIA ANTES DO VEREDITO. A ordem não é estética: quem lê um percentual
    # primeiro ancora nele e lê o resto procurando confirmação. Os precedentes e
    # o que corta contra vêm primeiro justamente para que o número seja lido
    # como conclusão, e não como premissa.
    out += ["---", "", "# Evidências", ""]
    out += ["## Precedentes usados", ""]
    for d in prec:
        out += ["**%s** — %s, %s, %s — *%s* (analogia %d/5: %s)"
                % (d["numero"], d["classe"], d["comarca"], d["data"],
                   d["resultado"], d["nota"], d["por_que"]),
                "", "  Procedência: %s" % sinais.resumir_ficha(d),
                "  Ranking: %s" % rerank.explicar(d), "",
                "  " + (d["ementa"] or "(sem ementa)")[:400], "",
                "  <%s>" % d["url"], ""]
    if not prec:
        out += ["Nenhum precedente com analogia suficiente foi encontrado.", ""]

    out += _procedencia(p, prec)
    out += _veredito(p)
    return _fechar(out, estado, prec, segundos)


def _veredito(p):
    """O prognóstico — ou a recusa de dar um. Vem DEPOIS das evidências."""
    out = ["---", "", "# Prognóstico", ""]

    if p.get("decide") is False:
        out += ["## NÃO DECIDO", "",
                "Os dados não sustentam um prognóstico neste caso:", ""]
        out += ["- " + m for m in (p.get("confianca") or {}).get("por_que", [])]
        out += ["",
                "Nesta faixa o sistema acerta ~70%, contra ~95% quando a "
                "estimativa é firme. Um número aqui seria um palpite com cara de "
                "medição. **As evidências acima continuam válidas** — é com elas "
                "que se decide, não com o percentual.", ""]
    elif p.get("probabilidade_pct") is not None:
        faixa = ""
        if p.get("intervalo_pct"):
            faixa = "  (intervalo de 80%%: %.0f%% a %.0f%%)" % tuple(p["intervalo_pct"])
        out += ["## %.0f%% de chance de reforma%s"
                % (p["probabilidade_pct"], faixa), "",
                "Resultado mais provável: **%s**." % p.get("resultado_provavel", "—"),
                ""]
        if p.get("calibrado"):
            out += ["> Percentual **calibrado**: entre os casos em que o sistema "
                    "diz um número, essa é a fração que de fato reformou. "
                    "Aferido em 1.092 decisões de 2025 que não entraram no "
                    "ajuste — erro máximo de 5 pontos.", ""]
        else:
            out += ["> Sem calibrador treinado: este número **ordena** bem mas "
                    "não é uma probabilidade. Rode `python -m src.rag.calibrar "
                    "--ajustar`.", ""]

    if p.get("distribuicao"):
        out += ["| resultado | peso dos precedentes |", "|---|---:|"]
        out += ["| %s | %.1f%% |" % (r, w) for r, w in p["distribuicao"]]
        out.append("")

    # --- os dois estimadores, lado a lado
    rf = p.get("floresta")
    if rf or p.get("reforma_conjunta_pct") is not None:
        out += ["### Dois estimadores", "",
                "| estimador | P(reforma) | o que é |", "|---|---:|---|"]
        if p.get("reforma_nos_precedentes") is not None:
            out.append("| k-NN sobre precedentes | %.1f%% | auditável: sai dos %d "
                       "precedentes listados abaixo |"
                       % (p["reforma_nos_precedentes"], p.get("n_precedentes", 0)))
        if rf:
            out.append("| Random Forest | %.1f%% | opaco: treinado em %d decisões "
                       "até %d, não olha os precedentes |"
                       % (100 * rf["p_reforma"], rf["n_treino"], rf["treinado_ate"]))
        if p.get("reforma_conjunta_pct") is not None:
            out.append("| **conjunto** | **%.1f%%** | média ponderada (fonte: %s) |"
                       % (p["reforma_conjunta_pct"], p.get("fonte", "—")))
        out.append("")
        if p.get("acordo") is False:
            out += ["> **Os dois discordam.** %s Isso não é um defeito a ignorar: "
                    "é o sinal de que o caso está na fronteira. A minuta abaixo foi "
                    "instruída a enfrentar os dois lados." % p.get("divergencia", ""),
                    ""]
        elif p.get("acordo") is True:
            out += ["Os dois estimadores concordam no lado.", ""]
        if p.get("fonte") == "floresta (sem precedente)":
            out += ["> A busca não trouxe precedente análogo. O número acima vem "
                    "**só** do modelo estatístico, que é o estimador mais fraco "
                    "dos dois (precisão de 39% medida isoladamente). Trate como "
                    "indicação, não como prognóstico.", ""]
    if p.get("reforma_historica_classe") is not None:
        out += ["Base histórica de %s (%d decisões de mérito): **%.1f%%** de "
                "reforma. Só como referência de ordem de grandeza — a auditoria "
                "de deriva (`python -m src.rag.deriva`) mostra variação de ~11 "
                "pontos entre anos, então a média de duas décadas não descreve "
                "o tribunal de hoje."
                % (p.get("classe_base"), p.get("n_classe", 0),
                   p["reforma_historica_classe"]), ""]
    return out


def _fechar(out, estado, prec, segundos):
    """Minuta, revisor, juiz e o rastro de custo."""
    p = estado.get("prognostico") or {}
    if estado.get("minuta"):
        out += ["---", "", "# Minuta", ""]
        if p.get("decide") is False:
            out += ["> Escrita sob a instrução de **não afirmar um desfecho como "
                    "provável**: ela expõe os dois caminhos e o ponto concreto de "
                    "que o caso depende.", ""]
        out += [estado["minuta"], ""]
    if p.get("revisao_problemas"):
        out += ["### Ressalvas do revisor (não corrigidas)", ""]
        out += ["- " + c for c in p["revisao_problemas"]] + [""]

    j = estado.get("julgamento") or {}
    if j.get("notas"):
        out += ["### Nota do juiz automático — %s (%s)"
                % (j.get("media"), j.get("juiz", "?")), "",
                "| critério | 0–5 |", "|---|---:|"]
        out += ["| %s | %s |" % (k, v) for k, v in j["notas"].items()]
        out += ["", "> %s" % j.get("resumo", ""), ""]
        if j.get("modo") == "sem_referencia":
            out += ["Sem gabarito: isso mede coerência interna e fidelidade aos "
                    "precedentes, **não** se a decisão está juridicamente certa.", ""]

    custos = estado.get("custos") or []
    total = sum(c["custo_usd"] for c in custos)
    out += ["---", "", "## Custo e rastro", "",
            "| nó | modelo | tokens in/out | US$ |", "|---|---|---:|---:|"]
    out += ["| %s | %s | %d/%d | %.4f |"
            % (c["no"], c["modelo"], c["tokens_in"], c["tokens_out"], c["custo_usd"])
            for c in custos]
    out += ["| **total** | | | **%.4f** |" % total, "",
            "Busca FTS5: `%s`" % (estado.get("consulta") or "—"),
            "", "%d candidatos do BM25, %d aprovados na triagem, %.0fs."
            % (len(estado.get("candidatos") or []), len(prec), segundos), ""]
    return "\n".join(out), total


def main(argv=None):
    ap = argparse.ArgumentParser(description="Segundo cérebro — Des. Rubens Schulz")
    ap.add_argument("arquivo", nargs="?", help="arquivo .txt com o caso")
    ap.add_argument("--so-prognostico", action="store_true",
                    help="para antes de redigir a minuta (mais barato)")
    ap.add_argument("--classe", help="força a classe processual no filtro")
    ap.add_argument("--ano-min", type=int, help="só precedentes a partir deste ano")
    ap.add_argument("--excluir", type=int, nargs="*", default=[],
                    help="ids de decisão a esconder do índice (teste cego)")
    ap.add_argument("--thread", default=None,
                    help="id da consulta; repetir retoma do checkpoint")
    a = ap.parse_args(argv)

    if a.arquivo:
        with open(a.arquivo, encoding="utf-8", errors="replace") as f:
            caso = f.read()
    else:
        print("Cole o caso e termine com uma linha só com FIM:\n")
        linhas = []
        for linha in sys.stdin:
            if linha.strip() == "FIM":
                break
            linhas.append(linha)
        caso = "".join(linhas)
    if not caso.strip():
        print("Caso vazio.", file=sys.stderr)
        return 2

    os.makedirs(SAIDA, exist_ok=True)
    ckpt = os.path.join(RAIZ, "output", "rag_runs.db")
    app = grafo.construir(checkpoint=ckpt, so_prognostico=a.so_prognostico)
    thread = a.thread or dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    print("consulta %s — rodando..." % thread, flush=True)

    cfg_run = {"configurable": {"thread_id": thread}, "recursion_limit": 30}
    entrada = {"caso": caso, "custos": [], "criticas": [], "ciclo_revisao": 0,
               "filtros": {"classe": a.classe, "ano_min": a.ano_min,
                           "excluir": tuple(a.excluir)}}
    # Retomar exige invoke(None): mandar o input de novo reinicia o grafo do
    # zero e repaga as chamadas que ja' sairam.
    anterior = app.get_state(cfg_run)
    if anterior.next:
        print("  retomando do nó '%s' (checkpoint)" % anterior.next[0], flush=True)
        entrada = None

    t0 = dt.datetime.now()
    try:
        estado = app.invoke(entrada, config=cfg_run)
    except (SemChave, SemCredito) as e:
        print("\n" + str(e), file=sys.stderr)
        print("\n(o que já rodou está no checkpoint: repita com --thread %s "
              "para continuar de onde parou)" % thread, file=sys.stderr)
        return 3
    seg = (dt.datetime.now() - t0).total_seconds()

    texto, total = formatar(estado, seg)
    nome = re.sub(r"[^\w-]", "", thread) + ".md"
    caminho = os.path.join(SAIDA, nome)
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(texto)
    print(texto)

    feedback.registrar_consulta(thread, caso, estado, total)
    j = estado.get("julgamento") or {}
    if j.get("media") is not None:
        feedback.registrar_avaliacao(thread, "juiz", j["media"], j)
    print("\n>>> salvo em %s  —  US$ %.4f" % (caminho, total))
    print(">>> qualifique esta resposta:  qualificar.bat --thread %s" % thread)
    return 0


if __name__ == "__main__":
    sys.exit(main())
