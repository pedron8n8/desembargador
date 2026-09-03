"""Entrada do segundo cérebro.

  python -m src.rag.cli caso.txt
  python -m src.rag.cli caso.txt --so-prognostico --classe "Apelação Cível"
"""
import argparse
import datetime as dt
import os
import re
import sys

from .. import cerebros
from . import extrair, feedback, grafo, rerank, sinais
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
            "> \"Por quem\" aqui significa **qual câmara** — este acervo é de um "
            "relator só. Para comparar dois relatores, rode a mesma peça em "
            "outro cérebro.", ""]

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


def _sustentacao(estado):
    """A linha de argumentação pedida: o que se repete no material do lado
    escolhido, e quanto o triador teve de descartar para chegar nele."""
    tese = estado.get("tese")
    if tese in (None, "neutra"):
        return []
    lado = {"reformar": "REFORMAR (dar provimento)",
            "manter": "MANTER (negar provimento)"}[tese]
    d = estado.get("descartados") or {}
    prec = estado.get("precedentes") or []
    out = ["---", "", "# Linha de argumentação pedida: %s" % lado, "",
           "> Os %d precedentes acima **não são uma amostra** — são o que sobrou "
           "depois de a triagem ler cada candidato e manter só os que sustentam "
           "este lado. Descartados: **%d** que decidem contra e **%d** neutros. "
           "Por isso não há prognóstico nesta consulta: contar resultado aqui "
           "mediria o filtro, não o tribunal."
           % (len(prec), d.get("contra", 0), d.get("neutro", 0)), "",
           "> O corte é semântico, não pelo rótulo `provido`/`desprovido`: esse "
           "rótulo só diz que o **recorrente daquele processo** venceu, e o "
           "recorrente de lá pode ser a parte contrária à sua.", ""]
    c = estado.get("comuns") or {}
    if c.get("n"):
        out += ["## O que se repete entre eles", ""]
        for rotulo, chave in (("Âncoras citadas por mais de um", "ancoras"),
                              ("Câmaras", "orgaos"), ("Classes", "classes")):
            if c.get(chave):
                # desempacota no for: o checkpoint devolve os pares como LISTA,
                # e "%s (%d)" % lista conta a lista como um argumento so'
                out.append("- **%s:** %s" % (rotulo, "; ".join(
                    "%s (%d)" % (v, n) for v, n in c[chave])))
        out += ["- **%d de %d unânimes**, %d transitaram em julgado, anos %s"
                % (c["unanimes"], c["n"], c["transitaram"],
                   "–".join(str(x) for x in (c["anos"][:1] + c["anos"][-1:]))), ""]
        if not c.get("ancoras"):
            out += ["> Nenhuma âncora aparece em mais de um deles: são decisões "
                    "que chegaram ao mesmo resultado por caminhos diferentes. "
                    "O ponto comum, se existir, está nos fatos — não há tese "
                    "única para citar.", ""]
    if not prec:
        out += ["**A triagem não achou precedente que sustente este lado.** Isso "
                "é um achado, não uma falha: no acervo deste relator, com estes "
                "termos de busca, não há material para essa linha. Rode em modo "
                "neutro para ver o que existe.", ""]
    return out


# Linguagem de tendencia: proibida quando a amostra foi filtrada pelo lado
# pedido, porque ali a contagem mede o filtro. O revisor ja' aponta, mas ele
# depende de sobrar ciclo de revisao — e no teste nao sobrou. Esta varredura
# nao depende de modelo nenhum.
_TENDENCIA = re.compile(
    r"(?i)\b(un[íi]sson\w*|pac[íi]fic\w*|consolidad\w*|majorit[áa]ri\w*"
    r"|iterativ\w*|remans\w*|torrencial|jurisprud[êe]ncia\s+(?:\w+\s+)?"
    r"(?:firme|dominante|assente)|entendimento\s+(?:firme|dominante|assente)"
    r"|reiterad\w+\s+decis|firmes?\s+em\s+afirmar)\b")


# A secao de fragilidade e' o unico lugar da minuta onde falar de jurisprudencia
# dominante e' legitimo — ela existe para dizer por onde a tese apanha ("...
# vulneravel a recurso especial que apele para a jurisprudencia dominante do
# STJ"). Sem esta excecao, TODA consulta no modo tese dispara o alerta, e alerta
# que sempre dispara e' alerta que ninguem le'.
_FRAGIL = re.compile(r"(?i)onde\s+esta\s+tese\s+[ée]\s+fr[áa]gil")


def tendencia_no_texto(minuta, limite=6):
    """Trechos da minuta que afirmam tendência jurisprudencial. [] se limpa."""
    minuta = minuta or ""
    corte = _FRAGIL.search(minuta)
    if corte:
        minuta = minuta[:corte.start()]
    achados = []
    for m in _TENDENCIA.finditer(minuta):
        ini = max(0, m.start() - 70)
        achados.append("…%s…" % " ".join(minuta[ini:m.end() + 70].split()))
        if len(achados) >= limite:
            break
    return achados


def formatar(estado, segundos, quando=None):
    """`quando` existe para reformatar consulta antiga sem carimbar a data de
    hoje no cabeçalho — a web relê threads de meses atrás."""
    p = estado.get("prognostico") or {}
    prec = estado.get("precedentes") or []
    # QUEM julgou vai no cabecalho, e nao no rodape: com mais de um cerebro no
    # sistema, dois relatorios da mesma peca sao documentos diferentes, e quem
    # abre um .md solto precisa saber de qual acervo ele saiu antes de ler.
    try:
        cam = cerebros.caminhos(estado.get("cerebro"))
        quem = "%s %s (%s)" % (cam["titulo"], cam["nome"], cam["tribunal"])
    except cerebros.Desconhecido:
        quem = estado.get("cerebro") or "—"
    out = ["# Consulta — %s" % (quando or dt.datetime.now()).strftime("%d/%m/%Y %H:%M"),
           "", "**Acervo consultado:** %s" % quem, "", AVISO, ""]

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
    out += _sustentacao(estado)
    if estado.get("caso_cortado"):
        # abstencao honesta: se o caso foi cortado, o usuario tem de saber
        # que parte dele nunca chegou aos nos de LLM — antes do prognostico,
        # nao depois, para nao ler o numero como se tivesse visto tudo. O
        # limite e' lido do config (mesmo default de grafo.recortar_caso),
        # e nao de uma constante — o corte pode ter sido reconfigurado.
        limite = grafo.config()["busca"].get("max_chars_caso", 20000)
        out += ["> AVISO: o caso passou de %d caracteres e foi cortado. O que "
                "ficou de fora não foi analisado." % limite, ""]
    out += _veredito(p, estado.get("tese"))
    return _fechar(out, estado, prec, segundos)


def _veredito(p, tese=None):
    """O prognóstico — ou a recusa de dar um. Vem DEPOIS das evidências."""
    out = ["---", "", "# Prognóstico", ""]

    if p.get("enviesado"):
        out += ["## SEM PROGNÓSTICO — você pediu um lado", "",
                "Os precedentes acima foram escolhidos por sustentarem a linha "
                "que você pediu. Qualquer percentual tirado deles mediria a "
                "própria escolha.", "",
                "Para o número calibrado, rode a mesma consulta em **modo "
                "neutro** — é a única em que a amostra não foi escolhida por "
                "você.", ""]
        rf = p.get("floresta")
        if rf:
            out += ["> Único estimador que sobrevive: a **floresta** aponta "
                    "%.0f%% de chance de reforma. Ela lê o caso, não a busca, "
                    "então o filtro não a contamina — mas sai **crua**: a "
                    "calibração foi ajustada sobre a escala do conjunto, que "
                    "aqui não existe. Ordena, não é probabilidade."
                    % (100 * rf["p_reforma"]), ""]
    elif p.get("faixa") == "acervo_pequeno":
        # recusa por falta de ACERVO, nao por duvida sobre este caso. Sao coisas
        # diferentes e o texto do "NAO DECIDO" (que fala de faixas de acerto
        # medidas) nao se aplica: aqui nao houve medicao nenhuma.
        out += ["## SEM PROGNÓSTICO — acervo pequeno demais", "",
                "Este cérebro ainda não tem histórico suficiente para que um "
                "percentual signifique alguma coisa:", ""]
        out += ["- " + m for m in (p.get("confianca") or {}).get("por_que", [])]
        out += ["",
                "**As evidências acima continuam válidas** — os precedentes são "
                "decisões reais deste relator, e é com elas que se trabalha. O "
                "que falta é base para transformá-las em probabilidade. Para o "
                "número, rode a mesma peça num cérebro com acervo completo.", ""]
    elif p.get("decide") is False:
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

    # --- os dois estimadores, lado a lado (no modo tese a floresta ja' saiu
    # sozinha lá em cima, e o k-NN nem existe)
    rf = None if p.get("enviesado") else p.get("floresta")
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
        if p.get("enviesado"):
            # A trava fica ANTES do texto, e é regex: o revisor também pega
            # isto, mas ele depende de sobrar ciclo de revisão — num teste real
            # não sobrou e a minuta saiu com "os precedentes são uníssonos".
            tend = tendencia_no_texto(estado["minuta"])
            if tend:
                out += ["> ⚠️ **A minuta afirma tendência jurisprudencial, e "
                        "nesta consulta ela não pode.** A amostra foi escolhida "
                        "por sustentar o seu lado — a contagem mede o filtro. "
                        "Corrija estes trechos antes de usar:", ""]
                out += ["> - `%s`" % t for t in tend]
                out += [""]
            else:
                out += ["> Varredura de linguagem de tendência: **limpa**.", ""]
        elif p.get("decide") is False:
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


def finalizar(thread, estado, segundos, quando=None):
    """O que TEM de acontecer quando uma consulta termina, venha ela da CLI ou
    da web: formata, grava o .md, registra no feedback.db e guarda a nota do
    juiz. Existe como função porque duplicar isso nos dois lados garantia que
    um dia eles divergiriam em silêncio — e o feedback.db é o que alimenta o
    boost da recuperação.

    Devolve (texto_markdown, custo_total, caminho_do_md).
    """
    texto, total = formatar(estado, segundos, quando=quando)
    os.makedirs(SAIDA, exist_ok=True)
    caminho = os.path.join(SAIDA, re.sub(r"[^\w-]", "", thread) + ".md")
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(texto)
    feedback.registrar_consulta(thread, estado.get("caso") or "", estado, total)
    j = estado.get("julgamento") or {}
    if j.get("media") is not None:
        feedback.registrar_avaliacao(thread, "juiz", j["media"], j)
    return texto, total, caminho


MENU = """
Que análise você quer deste caso?

  1) neutra     — o que o acervo diz, sem lado. É a única em que o percentual
                  vale como probabilidade.
  2) reformar   — puxa também os precedentes que DERAM provimento, para achar o
                  que eles têm em comum e você poder usar.
  3) manter     — o mesmo, do lado que NEGOU provimento.
  4) histórico  — processos e consultas que você já usou.

Em 2 e 3 o prognóstico continua sendo calculado na busca NEUTRA: o sistema
monta a sustentação que você pediu, mas não mente sobre para que lado a
jurisprudência pende.

Escolha [1]: """


def _perguntar_tese():
    """A pergunta do enunciado. Só em terminal — script nenhum trava por isso."""
    if not sys.stdin.isatty():
        return "neutra"
    while True:
        print(MENU, end="", flush=True)
        try:
            r = input().strip().lower()
        except EOFError:
            return "neutra"
        if r in ("", "1", "neutra"):
            return "neutra"
        if r in ("2", "reformar"):
            return "reformar"
        if r in ("3", "manter"):
            return "manter"
        if r in ("4", "historico", "histórico"):
            print("termo (número de processo, tema, ou enter para tudo): ",
                  end="", flush=True)
            feedback.imprimir_historico(input().strip() or None)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Segundo cérebro — consulta a um acervo")
    ap.add_argument("arquivo", nargs="?",
                    help="arquivo com o caso (.pdf, .docx, .txt ou .md)")
    cerebros.argumento(ap, "quem julga o caso (ver: python -m src.cerebros)")
    ap.add_argument("--tese", choices=("neutra", "reformar", "manter"),
                    help="linha de argumentação. Sem isto, o sistema pergunta.")
    ap.add_argument("--historico", nargs="?", const="", default=None, metavar="TERMO",
                    help="só consulta o que você já usou e sai (não gasta nada)")
    ap.add_argument("--so-prognostico", action="store_true",
                    help="para antes de redigir a minuta (mais barato)")
    ap.add_argument("--classe", help="força a classe processual no filtro")
    ap.add_argument("--ano-min", type=int, help="só precedentes a partir deste ano")
    ap.add_argument("--excluir", type=int, nargs="*", default=[],
                    help="ids de decisão a esconder do índice (teste cego)")
    ap.add_argument("--thread", default=None,
                    help="id da consulta; repetir retoma do checkpoint")
    a = ap.parse_args(argv)

    try:
        cam = cerebros.caminhos(a.cerebro)
    except cerebros.Desconhecido as e:
        print(e, file=sys.stderr)
        return 2

    if a.historico is not None:
        feedback.imprimir_historico(a.historico or None)
        return 0

    if not os.path.exists(cam["rag"]):
        print("o cérebro %s ainda não tem índice — rode:\n"
              "  python -m src.rag.indexar --cerebro %s"
              % (cam["nome"], cam["slug"]), file=sys.stderr)
        return 2

    if a.arquivo:
        # o mesmo extrator da web: .pdf e .docx entram aqui tambem, e um binario
        # errado para com mensagem em vez de virar caractere de substituicao
        try:
            caso, _ = extrair.de_arquivo(a.arquivo)
        except extrair.NaoSuportado as e:
            print("Não deu para ler %s: %s" % (a.arquivo, e), file=sys.stderr)
            return 2
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

    tese = a.tese or _perguntar_tese()

    os.makedirs(SAIDA, exist_ok=True)
    ckpt = os.path.join(RAIZ, "output", "rag_runs.db")
    app = grafo.construir(checkpoint=ckpt, so_prognostico=a.so_prognostico)
    thread = a.thread or dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    print("consulta %s — %s julgando..." % (thread, cam["nome"]), flush=True)

    cfg_run = {"configurable": {"thread_id": thread}, "recursion_limit": 30}
    entrada = {"caso": caso, "custos": [], "criticas": [], "ciclo_revisao": 0,
               "tese": tese, "cerebro": cam["slug"],
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

    texto, total, caminho = finalizar(thread, estado, seg)
    print(texto)
    print("\n>>> salvo em %s  —  US$ %.4f" % (caminho, total))
    print(">>> qualifique esta resposta:  qualificar.bat --thread %s" % thread)
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        sys.exit(main())

    # self-check offline da varredura de tendencia. As frases positivas sao
    # trechos REAIS da minuta que passou pelo revisor e saiu com eles mesmo
    # assim — foi esse teste que motivou a trava.
    for frase in ("Os precedentes desta Corte são uníssonos em distinguir",
                  "os precedentes são firmes em afirmar que",
                  "trata-se de jurisprudência pacífica no tribunal",
                  "o entendimento está consolidado nesta Câmara",
                  "conforme a orientação majoritária da Segunda Câmara",
                  "a jurisprudência é firme nesse sentido"):
        assert tendencia_no_texto(frase), frase
    for limpa in ("Ante o exposto, dou provimento ao recurso.",
                  "O precedente 0002830-89.2013 tratou de caso análogo.",
                  "A perícia judicial não constatou perda da existência "
                  "independente, o que afasta a cobertura de IFPD.",
                  # 'consolidação' de dívida nao e' tendencia jurisprudencial
                  "houve consolidação da propriedade em nome do credor"):
        assert not tendencia_no_texto(limpa), limpa
    # o trecho volta com contexto dos dois lados, para dar para achar no texto
    t = tendencia_no_texto("x" * 200 + " os julgados são uníssonos " + "y" * 200)
    assert len(t) == 1 and "uníssonos" in t[0] and t[0].count("x") >= 40

    # a secao de fragilidade nao conta: falar de jurisprudencia dominante ali e'
    # o proposito dela. Trecho real da minuta de v2-manter.
    assert not tendencia_no_texto(
        "Dou provimento.\n**ONDE ESTA TESE É FRÁGIL**\n1. Âncora local, o que a "
        "torna vulnerável a recurso especial que apele para a jurisprudência "
        "dominante do STJ.")
    # mas o que vem ANTES da seção continua contando
    assert tendencia_no_texto(
        "os precedentes são uníssonos.\nOnde esta tese é frágil\njurisprudência "
        "dominante do STJ")

    # o cabecalho da tese so' aparece no modo extremo
    assert _sustentacao({"tese": "neutra"}) == [] and _sustentacao({}) == []
    s = "\n".join(_sustentacao({"tese": "reformar", "precedentes": [1, 2],
                                "descartados": {"contra": 5, "neutro": 3},
                                "comuns": {"n": 2, "ancoras": [], "unanimes": 2,
                                           "transitaram": 1, "anos": [2020, 2024]}}))
    assert "REFORMAR" in s and "**5**" in s and "**3**" in s, s
    assert "caminhos diferentes" in s, "sem âncora comum, tem que dizer isso"
    # com âncora, e no formato em que o checkpoint devolve: pares como LISTA.
    # O caso acima passava com "ancoras": [] e por isso o "%s (%d)" nunca rodou —
    # em produção o relatório inteiro morria com "not enough arguments".
    com_ancora = "\n".join(_sustentacao(
        {"tese": "reformar", "precedentes": [1, 2],
         "descartados": {"contra": 5, "neutro": 3},
         "comuns": {"n": 2, "ancoras": [["Tema 1059/STJ", 2]], "orgaos": [],
                    "classes": [], "unanimes": 2, "transitaram": 1,
                    "anos": [2020, 2024]}}))
    assert "Tema 1059/STJ (2)" in com_ancora, com_ancora
    vazio = "\n".join(_sustentacao({"tese": "manter", "precedentes": [],
                                    "descartados": {"contra": 9, "neutro": 2}}))
    assert "não achou precedente que sustente" in vazio
    print("self-check OK — varredura de tendência e cabeçalho da tese")
