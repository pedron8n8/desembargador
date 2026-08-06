"""O grafo. Dois ciclos — e' o que justifica LangGraph em vez de um script.

    caso -> [triagem] -> [recuperar] -> [triar] -> ?suficiente? --nao--> [recuperar]
                                                        |sim
                                                  [prognostico]   (sem LLM)
                                                        v
                                            [redigir] <--nao-- ?aprovado?
                                                 v                   ^
                                             [revisar] --------------+
                                                 |sim
                                                FIM

O no de prognostico nao usa LLM DE PROPOSITO: e' contagem sobre os rotulos do
classificador, ja' validados na fase 1. E' a parte auditavel do sistema. A
minuta e' a parte que pode errar — por isso passa por um revisor de outro
fornecedor.
"""
import json
import operator
import os
import sqlite3
from typing import Annotated, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from . import busca, calibrar, confianca, feedback, floresta, juiz, rerank, sinais
from .classificador import MERITO, REFORMA
from .llm import chamar, config, json_da_resposta

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TJSC = os.path.join(RAIZ, "output", "tjsc.db")

# Peso de cada precedente no prognostico, pela confianca do classificador.
PESO_CONFIANCA = {"dispositivo": 1.0, "texto completo": 0.7, "ementa": 0.5, "-": 0.2}


# Linha de argumentacao pedida pelo usuario -> resultados que a sustentam.
# NAO existe "condenar/absolver" neste acervo: 18 decisoes criminais em 20.363.
# O eixo real do corpus e' reformar x manter, e e' nele que a busca opera.
TESES = {
    "reformar": ("provido", "parcialmente provido"),
    "manter": ("desprovido",),
    "neutra": (),
}
ROTULO_TESE = {"reformar": "reformar a decisão de origem (dar provimento)",
               "manter": "manter a decisão de origem (negar provimento)"}


class Estado(TypedDict, total=False):
    caso: str
    filtros: dict                       # classe / ano_min / ano_max / excluir
    tese: str                           # neutra | reformar | manter
    triagem: dict
    consulta: str
    candidatos: list
    precedentes: list
    sustentacao: list                   # precedentes do lado pedido (so' com --tese)
    comuns: dict                        # o que se repete entre eles
    perfil: dict                        # historico do argumento (sinais.perfil)
    contra: dict                        # quem discorda, dentro do que veio
    ciclo_busca: int
    prognostico: dict
    minuta: str
    criticas: list
    ciclo_revisao: int
    julgamento: dict
    decisao_real: str                   # só no bench: o gabarito para o juiz
    custos: Annotated[list, operator.add]


# --------------------------------------------------------------------- nós

P_TRIAGEM = """Você analisa peças do Tribunal de Justiça de Santa Catarina.

Leia o caso abaixo e devolva SOMENTE um JSON, sem comentários, com:
{
  "classe": "classe processual provável (ex.: Apelação Cível, Agravo de Instrumento)",
  "materia": "área e tema em até 8 palavras",
  "tese": "a tese central do recorrente em uma frase",
  "pedidos": ["pedido 1", "pedido 2"],
  "termos": ["6 a 10 expressões de busca"]
}

Os "termos" alimentam uma busca literal em ementas de acórdãos. Use o jargão
que apareceria na ementa ("prescrição intercorrente", "denunciação da lide",
"honorários recursais"), de 2 a 4 palavras cada. Não use palavras genéricas
sozinhas ("recurso", "apelação", "processo") — elas aparecem em tudo.

CASO:
"""

P_TRIAR = """Você separa precedentes úteis de ruído.

O caso em análise:
{caso}

Abaixo, {n} decisões do mesmo relator. Para cada uma, dê uma nota de analogia:
5 = mesma questão jurídica e situação de fato muito parecida
4 = mesma questão jurídica, fatos diferentes
3 = questão vizinha, o raciocínio ainda serve
2 = mesma área do direito, questão diferente
1 = só o vocabulário coincide
0 = não tem relação

A nota mede ANALOGIA com o caso — é isso que decide. Mas cada decisão vem com a
ficha do que a sustenta, e ela desempata entre precedentes igualmente análogos:

- âncora **vinculante** (tema repetitivo, IRDR, repercussão geral, súmula
  vinculante) obriga todo o país; **persuasiva** (súmula, precedente do STJ/STF)
  convence; **estadual** vale só como orientação da própria câmara.
- **por maioria / vencido** é precedente mais frágil que unânime.
- **transitou em julgado** indica tese que se sustentou; **subiu para STJ/STF**
  indica tese contestada; **sobrestado** indica controvérsia nacional em aberto.
- decisão antiga pode ter sido superada; confira se a tese ainda aparece nas
  recentes.

Entre duas decisões de mesma analogia, dê a nota maior à mais bem ancorada e mais
recente. NÃO suba a nota de um precedente pouco análogo só porque a ficha é boa:
âncora forte em questão jurídica diferente continua sendo 1 ou 2.

Devolva SOMENTE um JSON: {{"notas": [{{"id": 123, "nota": 4, "por_que": "até 12 palavras"}}]}}
Inclua todas as {n} decisões.

DECISÕES:
{lista}
"""

P_REDIGIR = """Você redige uma minuta no estilo do Desembargador Rubens Schulz (TJSC),
imitando a estrutura, o vocabulário e o encadeamento das decisões dele que seguem.

REGRAS DURAS:
- O PROGNÓSTICO ABAIXO É INTERNO. Ele NUNCA aparece no texto da minuta: nem o
  percentual, nem a contagem de precedentes, nem as palavras "prognóstico",
  "estatística" ou "probabilidade". Nenhum acórdão real diz "a estatística
  indica reforma". Use-o só para calibrar a sua conclusão; fundamente com
  direito, fatos e precedentes citados pelo número.
- Fundamente APENAS com o que está nos precedentes abaixo e no caso. Não invente
  número de processo, súmula, tese de repetitivo, nem citação de outro tribunal.
- Não invente REGIME JURÍDICO: se o caso não diz qual lei rege o contrato, o
  título ou o procedimento, não afirme qual é. Trate como ponto a esclarecer.
- Enfrente TODOS os pedidos e preliminares, um a um. Omitir pedido é o erro mais
  comum medido nestas minutas (10 em 32).
- Ao citar um precedente, use exatamente o número que aparece no cabeçalho dele.
- O dispositivo deve ser coerente com o prognóstico estatístico informado. Se você
  discordar dele, escreva o dispositivo que a fundamentação sustenta e explique a
  divergência numa última seção "Divergência do prognóstico".
- Estrutura: RELATÓRIO (sintético) / VOTO — FUNDAMENTAÇÃO / DISPOSITIVO.

PROGNÓSTICO ESTATÍSTICO (calculado sobre os precedentes, sem IA):
{prognostico}
{divergencia}{procedencia}
CASO:
{caso}

PRECEDENTES DO RELATOR:
{precedentes}
{criticas}
Escreva a minuta em português jurídico brasileiro, em markdown."""

P_DIVERGENCIA = """
ATENÇÃO — OS DOIS ESTIMADORES DISCORDAM:
{divergencia}
Não escolha um lado em silêncio. A fundamentação tem de ENFRENTAR a tese
contrária: diga por que ela não prevalece neste caso concreto. Se, depois de
enfrentá-la, você concluir pelo lado minoritário, escreva assim mesmo e explique
na seção "Divergência do prognóstico".
"""

P_SEM_DECISAO = """
ATENÇÃO — O PROGNÓSTICO NÃO SE SUSTENTA NESTE CASO:
{por_que}

Nesta faixa o sistema acerta ~70%, contra ~95% quando a estimativa é firme.
Portanto:
- NÃO escreva que o resultado é "provável" nem cite percentual nenhum.
- Escreva a fundamentação dos DOIS caminhos possíveis, cada um com os
  precedentes que o sustentam, e diga o que faria a balança pender para cada
  lado (qual fato do caso, qual prova, qual tese).
- O DISPOSITIVO TEM DE SER CONDICIONAL, em dois cenários explícitos ("caso
  prevaleça A... nega-se provimento; caso prevaleça B... dá-se provimento").
  NÃO escreva um dispositivo definitivo escolhendo um lado: isso contradiz tudo
  o que vem acima e é o erro que o revisor mais pega neste modo.
- Feche com uma seção "O que decide este caso" apontando o ponto CONCRETO e
  verificável nos autos de que o resultado depende.
Quem decide é o desembargador; seu papel aqui é deixar a escolha informada.
"""

P_TESE = """
LINHA DE ARGUMENTAÇÃO PEDIDA: o usuário quer a sustentação para {lado}.

Escreva a fundamentação que sustenta esse lado, apoiada nos PRECEDENTES DE
SUSTENTAÇÃO abaixo e no que se repete entre eles.

Isto NÃO é licença para forçar nem para esconder:
- a contra-argumentação continua tendo de ser enfrentada pelo número;
- se o prognóstico neutro (que foi calculado SEM este filtro) apontar para o
  outro lado, escreva uma seção final "O que joga contra" dizendo isso com todas
  as letras e apontando o que precisaria ser provado nos autos para virar;
- não invente precedente, súmula nem tese que não esteja na lista.
{comuns}"""

P_REVISAR = """Você é o revisor. Não reescreva nada — aponte problemas.

Confira a minuta contra os precedentes e o prognóstico e verifique:
1. Toda citação de processo/precedente na minuta existe na lista fornecida?
2. O dispositivo é coerente com a fundamentação?
3. Há afirmação de direito sem apoio nos precedentes ou no caso (súmula, tema
   repetitivo, jurisprudência de outro tribunal inventada)?
4. Ficou faltando enfrentar algum pedido do caso?
5. A minuta MENCIONA o prognóstico, percentual, estatística, probabilidade ou a
   contagem de precedentes como se fosse argumento? Isso é erro grave: o
   prognóstico é interno e não pode aparecer no voto. Aponte o trecho.
6. A minuta AFIRMA um regime jurídico (qual lei rege o contrato, o título, o
   procedimento) que não está no caso nem nos precedentes? Inventar regime é
   pior que omitir — aponte.

Devolva SOMENTE um JSON:
{{"aprovado": true|false, "problemas": ["problema 1 e como corrigir", "..."]}}
Aprove se não houver problema grave. Seja específico; no máximo 5 problemas.

{modo}
PROGNÓSTICO: {prognostico}

NÚMEROS DE PRECEDENTE VÁLIDOS: {numeros}

CASO:
{caso}

MINUTA:
{minuta}
"""


def no_triagem(estado):
    txt, custo = chamar("triagem", [{"role": "user",
                                     "content": P_TRIAGEM + estado["caso"][:20000]}])
    t = json_da_resposta(txt, padrao={})
    if not t.get("termos"):
        # sem termos nao ha' busca: cai para as palavras mais longas do caso
        t["termos"] = sorted(set(p for p in estado["caso"].split() if len(p) > 7),
                             key=len, reverse=True)[:10]
    return {"triagem": t, "custos": [custo], "ciclo_busca": 0}


def no_recuperar(estado):
    cfg = config()["busca"]
    ciclo = estado.get("ciclo_busca", 0)
    f = estado.get("filtros") or {}
    t = estado["triagem"]
    termos = list(t.get("termos") or [])
    if ciclo == 0:
        # Filtrar por classe NAO ajuda: medido nos mesmos 400 casos, a precisao
        # com e sem filtro fica igual ou levemente melhor sem ele — o filtro
        # descarta casos analogos que vieram por outra via recursal. So' filtra
        # se o usuario pedir explicitamente (--classe).
        classe = f.get("classe")
        limite = cfg["candidatos"]
    else:
        # 2a volta: abre o leque — sem filtro de classe, mais candidatos e a
        # materia/tese entram como termos
        classe = None
        limite = cfg["candidatos"] * 2
        termos += [t.get("materia") or "", t.get("tese") or ""]
    consulta = busca.montar_consulta(termos)
    fb = feedback.boost() if config()["busca"].get("usar_feedback") else None
    # Busca o dobro e reordena pela ficha de procedencia antes de cortar: o LLM
    # de triagem passa a ver os N melhores de 2N, e nao os 2N primeiros do BM25.
    # Custo de LLM identico — quem paga o dobro e' o SQLite, em milissegundos.
    comum = dict(classe=classe, ano_min=f.get("ano_min"), ano_max=f.get("ano_max"),
                 excluir=f.get("excluir") or ())
    cand = busca.buscar(consulta, limite=limite * 2, **comum)
    cand = rerank.ordenar(cand, limite=limite, boost=fb)
    for c in cand:
        c["neutro"] = True   # so' estes contam no prognostico

    # Linha de argumentacao: uma SEGUNDA busca, restrita ao lado pedido, para
    # achar sustentacao que nao cabia no top-N neutro. As duas listas seguem
    # separadas de proposito — a neutra alimenta o prognostico calibrado, esta
    # alimenta a minuta. Custo de LLM: so' as linhas novas na triagem.
    lado = TESES.get(estado.get("tese") or "neutra", ())
    if lado:
        vistos = {c["id"] for c in cand}
        extra = busca.buscar(consulta, limite=limite * 2, resultados=lado, **comum)
        extra = [c for c in rerank.ordenar(extra, boost=fb) if c["id"] not in vistos]
        cand += extra[:max(8, limite // 2)]
    return {"consulta": consulta, "candidatos": cand, "ciclo_busca": ciclo + 1,
            "perfil": sinais.perfil(consulta),
            "contra": sinais.contra_argumentacao([c for c in cand if c.get("neutro")])}


def no_triar(estado):
    cfg = config()["busca"]
    cand = estado["candidatos"]
    if not cand:
        return {"precedentes": []}
    lista = "\n\n".join(
        "id %d | %s | %s | %s | resultado: %s\nficha: %s\n%s"
        % (c["id"], c["numero"], c["data"], c["classe"], c["resultado"],
           sinais.resumir_ficha(c),
           (c["ementa"] or c["dispositivo"] or "")[:900])
        for c in cand)
    msg = [{"role": "user", "content": P_TRIAR.format(
        caso=estado["caso"][:6000], n=len(cand), lista=lista)}]
    txt, custo = chamar("triar", msg)
    custos = [custo]
    if custo["cortado"]:
        # A resposta e' uma nota por candidato: no 2o ciclo sao 80 candidatos e o
        # JSON nao cabe no teto. Truncado, ele vira JSON invalido, o parser
        # devolve vazio e NENHUM precedente passa — o sistema fica sem evidencia
        # nenhuma e o relatorio sai oco. Foi exatamente o que aconteceu numa
        # consulta real. Refaz uma vez com o dobro de espaco.
        teto = config().get("max_tokens", {}).get("triar", 2000)
        print("  triagem cortada no teto de %d tokens — refazendo com %d"
              % (teto, teto * 2), flush=True)
        txt2, custo2 = chamar("triar", msg, max_tokens=teto * 2)
        custos.append(custo2)
        if len(txt2) > len(txt):
            txt = txt2
    notas = {n.get("id"): n for n in json_da_resposta(txt, padrao={}).get("notas", [])
             if isinstance(n, dict)}
    escolhidos = []
    for c in cand:
        n = notas.get(c["id"])
        if n and (n.get("nota") or 0) >= cfg["nota_minima"]:
            escolhidos.append({**c, "nota": n["nota"], "por_que": n.get("por_que", "")})
    # a nota do LLM manda (e' ela que veta o que nao e' analogo); o rerank so'
    # desempata dentro da mesma nota
    escolhidos.sort(key=lambda c: (-c["nota"], -c.get("pontos", 0.0)))
    if cand and not notas:
        print("  AVISO: a triagem não devolveu nota nenhuma para %d candidatos "
              "— o prognóstico vai sair vazio" % len(cand), flush=True)

    # A LISTA DO PROGNOSTICO E' SO' A NEUTRA. Deixar a busca da tese entrar aqui
    # empurraria a contagem para o lado pedido — o sistema responderia o que o
    # usuario quer ouvir, com a cara de numero calibrado. E' o oposto do que ele
    # serve para fazer.
    prec = [c for c in escolhidos if c.get("neutro")][:cfg["precedentes"]]
    lado = TESES.get(estado.get("tese") or "neutra", ())
    sust = ([c for c in escolhidos if c["resultado"] in lado][:cfg["precedentes"]]
            if lado else [])
    return {"precedentes": prec, "custos": custos, "sustentacao": sust,
            "comuns": sinais.comuns(sust),
            "contra": sinais.contra_argumentacao(prec)}


def _suficiente(estado):
    cfg = config()["busca"]
    if len(estado.get("precedentes") or []) >= 3:
        return "prognostico"
    if estado.get("ciclo_busca", 0) < cfg["max_ciclos_busca"]:
        return "recuperar"
    return "prognostico"


def _peso(p):
    """Peso de um precedente no voto.

    O BM25 entra: medido em 400 casos cegos, ponderar pelo score sobe a precisao
    da previsao de reforma de 69% para 72-76%, contra ~31% de taxa base.
    Ponderar por posicao no ranking (1/i) foi pior. `pontos` e' esse mesmo score
    depois do rerank (idade, ancora, efeito); cai para o BM25 cru quando o
    rerank esta' desligado.
    """
    return (PESO_CONFIANCA.get(p.get("confianca"), 0.5) * (p.get("nota", 5) / 5.0)
            * p.get("pontos", max(0.1, -p.get("score", -1.0))))


def no_prognostico(estado):
    """Sem LLM. Dois estimadores independentes, e a divergencia deles a' vista.

    k-NN     voto ponderado sobre os precedentes recuperados. Auditavel: da'
             para apontar quais 8 decisoes produziram o numero.
    floresta Random Forest treinado nas 7.545 decisoes ate' 2023. Nao depende da
             recuperacao — por isso responde quando ela falha, e por isso a
             discordancia entre os dois significa alguma coisa.
    """
    prec = estado.get("precedentes") or []
    pesos = {}
    for p in prec:
        w = _peso(p)
        pesos[p["resultado"]] = pesos.get(p["resultado"], 0.0) + w
    total = sum(pesos.values())
    ordenado = sorted(pesos.items(), key=lambda kv: -kv[1])
    t = estado.get("triagem") or {}
    classe = (estado.get("filtros") or {}).get("classe") or t.get("classe")
    n_base, taxa_base = busca.taxa_da_classe(classe)

    merito = sum(w for r, w in pesos.items() if r in MERITO)
    reforma = sum(w for r, w in pesos.items() if r in REFORMA)
    reforma_knn = (reforma / merito) if merito else None

    # a floresta le' o jargao da triagem, nao a peca inteira: foi treinada em
    # ementa, e termo de ementa e' o que mais se parece com isso
    rf = floresta.prever(
        " ".join(list(t.get("termos") or []) + [t.get("materia") or "",
                                                t.get("tese") or ""]),
        classe=classe)
    p_conj, acordo, fonte = floresta.combinar(
        reforma_knn, rf["p_reforma"] if rf else None,
        config().get("floresta", {}).get("peso_knn", floresta.PESO_KNN))

    # A escala bruta ordena bem mas mente: o sistema dizia 20-30% em casos que
    # reformavam 4%. A isotonica corrige a escala sem estragar a ordem — medido
    # em 1092 casos de 2025 que nao entraram no ajuste: maior erro da diagonal
    # de 21,9 pp para 5,0 pp.
    p_cal = calibrar.aplicar(p_conj)
    lo, hi = confianca.intervalo(prec, _peso) if prec else (None, None)
    if lo is not None:
        lo, hi = calibrar.aplicar(lo), calibrar.aplicar(hi)
    conf = confianca.avaliar(p_cal, prec, _peso, knn=reforma_knn,
                             rf=rf["p_reforma"] if rf else None,
                             largura=(hi - lo) if lo is not None else None)

    prog = {
        "resultado_provavel": ordenado[0][0] if ordenado else (
            rf["resultado"] if rf else "indeterminado"),
        "confianca_pct": round(100 * ordenado[0][1] / total, 1) if total else 0.0,
        "distribuicao": [(r, round(100 * w / total, 1)) for r, w in ordenado] if total else [],
        "n_precedentes": len(prec),
        "reforma_nos_precedentes": round(100 * reforma / merito, 1) if merito else None,
        "classe_base": classe,
        "n_classe": n_base,
        "reforma_historica_classe": round(100 * taxa_base, 1) if taxa_base else None,
        # --- decisao mutua
        "fonte": fonte,
        "acordo": acordo,
        "reforma_conjunta_pct": round(100 * p_conj, 1) if p_conj is not None else None,
        "floresta": rf,
        "contra": estado.get("contra"),
        "perfil": estado.get("perfil"),
        # --- calibracao e abstencao
        "probabilidade_pct": round(100 * p_cal, 1) if p_cal is not None else None,
        "calibrado": calibrar.calibrado(),
        "intervalo_pct": ([round(100 * lo, 1), round(100 * hi, 1)]
                          if lo is not None else None),
        "decide": conf["decide"],
        "faixa": conf["faixa"],
        "confianca": conf,
    }
    if acordo is False:
        # o redator recebe isto no prompt e e' obrigado a enfrentar os dois lados
        prog["divergencia"] = (
            "Os dois estimadores discordam: os precedentes recuperados apontam "
            "%.0f%% de reforma, e o modelo treinado no histórico aponta %.0f%%."
            % (100 * reforma_knn, 100 * rf["p_reforma"]))
    return {"prognostico": prog}


def _texto_precedente(db, p, limite):
    (teor,) = db.execute("SELECT inteiro_teor FROM decisoes WHERE id=?",
                         (p["id"],)).fetchone() or ("",)
    teor = teor or ""
    if len(teor) > limite:
        # o comeco e' o relatorio (os fatos) e o fim e' fundamentacao+dispositivo;
        # o miolo e' o que sobra quando precisa cortar
        teor = teor[:limite // 4] + "\n[...]\n" + teor[-(limite - limite // 4):]
    return ("### %s — %s — %s (%s)\nResultado: %s | analogia %d/5 (%s)\n"
            "Procedência: %s\nEMENTA: %s\n\nTEXTO:\n%s\n"
            % (p["numero"], p["classe"], p["data"], p["comarca"], p["resultado"],
               p["nota"], p["por_que"], sinais.resumir_ficha(p),
               (p["ementa"] or "(sem ementa)")[:1500],
               teor or p["dispositivo"] or "(inteiro teor indisponível)"))


def _bloco_procedencia(estado):
    """O historico do argumento, para o redator saber com o que esta' lidando."""
    p = estado.get("perfil") or {}
    c = estado.get("contra") or {}
    if not p.get("usos"):
        return ""
    linhas = ["\nHISTÓRICO DO ARGUMENTO no acervo do relator (fato, não opinião):",
              "- usado em %d decisões de mérito, de %s a %s; reforma em %s%%"
              % (p["usos"], p["primeiro_ano"], p["ultimo_ano"], p["reforma_pct"]),
              "- %d delas se ancoram em precedente nacional (súmula/tema/IRDR)"
              % p.get("com_ancora_nacional", 0)]
    if p.get("por_orgao"):
        linhas.append("- câmaras: %s" % "; ".join(
            "%s (%d)" % (o, n) for o, n in p["por_orgao"][:3]))
    if c.get("empate"):
        linhas.append(
            "- CONTRA-ARGUMENTAÇÃO: os %d precedentes se dividem METADE A METADE "
            "entre reformar e manter. Não há maioria. A fundamentação tem de "
            "explicar por que este caso cai de um lado e não do outro." % c["de"])
    elif c.get("contra"):
        linhas.append(
            "- CONTRA-ARGUMENTAÇÃO: %d dos %d precedentes usados decidiram para o "
            "lado oposto (%s). Enfrente-os pelo número, não os ignore: %s"
            % (c["contra"], c["de"], c["lado_majoritario"],
               ", ".join(e["numero"] for e in c.get("exemplos", []))))
    if c.get("nao_unanimes"):
        linhas.append("- %d precedente(s) não foram unânimes: valem menos como "
                      "sustentação" % c["nao_unanimes"])
    return "\n".join(linhas) + "\n"


def _bloco_comuns(c):
    """O que se repete entre os precedentes do lado pedido — material bruto."""
    if not c.get("n"):
        return ""
    l = ["\nO QUE SE REPETE nos %d precedentes de sustentação (contagem, não "
         "opinião):" % c["n"]]
    for rotulo, chave in (("âncoras citadas por mais de um", "ancoras"),
                          ("câmaras", "orgaos"), ("classes", "classes")):
        if c.get(chave):
            l.append("- %s: %s" % (rotulo, "; ".join("%s (%d)" % t for t in c[chave])))
    l.append("- %d de %d unânimes; %d transitaram em julgado; anos %s"
             % (c["unanimes"], c["n"], c["transitaram"],
                "-".join(str(a) for a in (c["anos"][:1] + c["anos"][-1:]))))
    return "\n".join(l) + "\n"


def no_redigir(estado):
    cfg = config()["busca"]
    prec = estado.get("precedentes") or []
    vistos = {p["id"] for p in prec}
    sust = [p for p in (estado.get("sustentacao") or []) if p["id"] not in vistos][:4]
    db = sqlite3.connect("file:%s?mode=ro" % TJSC.replace("\\", "/"), uri=True)
    try:
        blocos = [_texto_precedente(db, p, cfg["chars_por_precedente"]) for p in prec]
        if sust:
            blocos.append("\n## PRECEDENTES DE SUSTENTAÇÃO (recuperados já "
                          "filtrados pelo lado pedido — não servem de amostra "
                          "para medir tendência, servem de material)\n")
            blocos += [_texto_precedente(db, p, cfg["chars_por_precedente"])
                       for p in sust]
    finally:
        db.close()
    criticas = estado.get("criticas") or []
    bloco_criticas = ""
    if criticas:
        bloco_criticas = ("\nO revisor apontou estes problemas na versão anterior. "
                          "Corrija todos:\n- " + "\n- ".join(criticas) + "\n")
    prog = estado["prognostico"]
    # o perfil e a ficha ja' vao no bloco de procedencia; repeti-los no JSON so'
    # gastaria contexto
    enxuto = {k: v for k, v in prog.items()
              if k not in ("perfil", "contra", "floresta", "confianca")}
    if prog.get("decide") is False:
        aviso = P_SEM_DECISAO.format(
            por_que="; ".join(prog.get("confianca", {}).get("por_que") or ["—"]))
    elif prog.get("divergencia"):
        aviso = P_DIVERGENCIA.format(divergencia=prog["divergencia"])
    else:
        aviso = ""
    if ROTULO_TESE.get(estado.get("tese")):
        aviso += P_TESE.format(lado=ROTULO_TESE[estado["tese"]],
                               comuns=_bloco_comuns(estado.get("comuns") or {}))
    msg = [{"role": "user", "content": P_REDIGIR.format(
        prognostico=json.dumps(enxuto, ensure_ascii=False),
        divergencia=aviso,
        procedencia=_bloco_procedencia(estado),
        caso=estado["caso"][:20000],
        precedentes="\n\n".join(blocos) or "(nenhum precedente análogo encontrado)",
        criticas=bloco_criticas)}]
    txt, custo = chamar("redigir", msg)
    custos = [custo]
    if custo["cortado"]:
        # Minuta cortada no meio da frase: e' teto de max_tokens, nao erro de
        # conteudo. Mandar isso para o revisor queima um ciclo inteiro a toa
        # (foi o que aconteceu no primeiro teste: US$ 0,19 em duas minutas
        # truncadas). Refaz uma vez com o dobro de espaco.
        teto = config().get("max_tokens", {}).get("redigir", 3500)
        print("  minuta cortada no teto de %d tokens — refazendo com %d"
              % (teto, teto * 2), flush=True)
        txt2, custo2 = chamar("redigir", msg, max_tokens=teto * 2)
        custos.append(custo2)
        if not custo2["cortado"] or len(txt2) > len(txt):
            txt = txt2
    return {"minuta": txt, "custos": custos,
            "ciclo_revisao": estado.get("ciclo_revisao", 0) + 1}


R_SEM_DECISAO = """
MODO SEM PROGNÓSTICO: os dados não sustentavam previsão neste caso, e o redator
foi instruído a NÃO cravar um desfecho. Então, aqui:
- dispositivo condicional em dois cenários é o CORRETO — não aponte como erro;
- dispositivo DEFINITIVO escolhendo um lado é erro grave — aponte-o;
- tem de existir uma seção final apontando o ponto concreto que decide o caso.
"""


def no_revisar(estado):
    # a sustentacao entra: sao numeros que o redator recebeu e pode citar com
    # razao. Fora daqui, o revisor os acusaria de inventados.
    numeros = list(dict.fromkeys(
        p["numero"] for p in ((estado.get("precedentes") or [])
                              + (estado.get("sustentacao") or []))))
    absteve = (estado.get("prognostico") or {}).get("decide") is False
    txt, custo = chamar("revisar", [{"role": "user", "content": P_REVISAR.format(
        modo=R_SEM_DECISAO if absteve else "",
        prognostico=json.dumps(estado["prognostico"], ensure_ascii=False),
        numeros=", ".join(numeros) or "(nenhum)",
        caso=estado["caso"][:8000], minuta=estado["minuta"])}])
    d = json_da_resposta(txt, padrao={"aprovado": True, "problemas": []})
    problemas = [str(p) for p in (d.get("problemas") or [])][:5]
    return {"criticas": problemas if not d.get("aprovado") else [],
            "custos": [custo],
            "prognostico": {**estado["prognostico"],
                            "revisao_aprovou": bool(d.get("aprovado")),
                            "revisao_problemas": problemas}}


def no_julgar(estado):
    """Nota automatica da minuta, para comparar com a sua e com outros modelos.

    Sem gabarito (caso novo), so' checa coerencia e fidelidade a fonte — nao
    diz se a decisao esta juridicamente certa. `decisao_real` so' aparece no
    bench, onde o gabarito existe."""
    minuta = estado.get("minuta") or ""
    if not minuta.strip():
        return {}
    redator = next((c["modelo"] for c in reversed(estado.get("custos") or [])
                    if c["no"] == "redigir"), None)
    d, custo = juiz.avaliar(
        minuta, list(dict.fromkeys(
            p["numero"] for p in ((estado.get("precedentes") or [])
                                  + (estado.get("sustentacao") or [])))),
        caso=estado.get("caso"), decisao_real=estado.get("decisao_real"),
        modelo_redator=redator,
        absteve=(estado.get("prognostico") or {}).get("decide") is False)
    return {"julgamento": d, "custos": [custo]}


def _aprovado(estado):
    cfg = config()["busca"]
    if estado.get("criticas") and \
            estado.get("ciclo_revisao", 0) < cfg["max_ciclos_revisao"]:
        return "redigir"
    return "julgar" if config().get("julgar_consultas") else END


# ------------------------------------------------------------------ montagem

def construir(checkpoint=None, so_prognostico=False):
    g = StateGraph(Estado)
    g.add_node("triagem", no_triagem)
    g.add_node("recuperar", no_recuperar)
    g.add_node("triar", no_triar)
    g.add_node("prognostico", no_prognostico)
    g.add_edge(START, "triagem")
    g.add_edge("triagem", "recuperar")
    g.add_edge("recuperar", "triar")
    g.add_conditional_edges("triar", _suficiente,
                            {"recuperar": "recuperar", "prognostico": "prognostico"})
    if so_prognostico:
        g.add_edge("prognostico", END)
    else:
        g.add_node("redigir", no_redigir)
        g.add_node("revisar", no_revisar)
        g.add_node("julgar", no_julgar)
        g.add_edge("prognostico", "redigir")
        g.add_edge("redigir", "revisar")
        g.add_conditional_edges("revisar", _aprovado,
                                {"redigir": "redigir", "julgar": "julgar", END: END})
        g.add_edge("julgar", END)
    saver = None
    if checkpoint:
        saver = SqliteSaver(sqlite3.connect(checkpoint, check_same_thread=False))
    return g.compile(checkpointer=saver)


if __name__ == "__main__":
    # self-check offline: a topologia e o no que nao usa LLM.
    app = construir()
    assert "prognostico" in app.get_graph().nodes

    falso = {
        "precedentes": [
            {"id": 1, "resultado": "desprovido", "confianca": "dispositivo", "nota": 5},
            {"id": 2, "resultado": "desprovido", "confianca": "dispositivo", "nota": 5},
            {"id": 3, "resultado": "provido", "confianca": "ementa", "nota": 3},
        ],
        "triagem": {"classe": "Apelação Cível"}, "filtros": {},
    }
    p = no_prognostico(falso)["prognostico"]
    assert p["resultado_provavel"] == "desprovido", p
    # 2 x 1,0 contra 1 x 0,5 x 0,6 => bem acima de 80%
    assert p["confianca_pct"] > 85, p
    assert p["reforma_nos_precedentes"] < 20, p
    assert p["n_classe"] > 1000 and 30 < p["reforma_historica_classe"] < 45, p

    # o BM25 tem que pesar: o mesmo trio, mas com o "provido" muito mais
    # proximo do caso, vira maioria
    perto = {**falso, "precedentes": [
        {**falso["precedentes"][0], "score": -2.0},
        {**falso["precedentes"][1], "score": -2.0},
        {**falso["precedentes"][2], "score": -30.0},
    ]}
    assert no_prognostico(perto)["prognostico"]["resultado_provavel"] == "provido"

    # --- decisao mutua: os quatro ramos da tabela
    tem_rf = floresta.carregar() is not None
    p = no_prognostico(falso)["prognostico"]
    assert p["fonte"] == ("conjunto" if tem_rf else "knn"), p["fonte"]
    if tem_rf:
        assert p["acordo"] in (True, False) and p["floresta"], p
        assert p["reforma_conjunta_pct"] is not None
        # divergencia so' aparece quando ela existe, e traz os dois numeros
        assert (p.get("divergencia") is None) == (p["acordo"] is True)
    else:
        assert p["acordo"] is None and p["floresta"] is None

    # sem precedente: quem responde e' a floresta (o fallback), ou ninguem
    vazio = no_prognostico({"precedentes": [], "triagem":
                            {"classe": "Apelação Cível", "termos": ["dano moral"]},
                            "filtros": {}})["prognostico"]
    if tem_rf:
        assert vazio["fonte"] == "floresta (sem precedente)", vazio["fonte"]
        assert vazio["resultado_provavel"] != "indeterminado", vazio
    else:
        assert vazio["resultado_provavel"] == "indeterminado"

    # o rerank tem que mudar o peso: 'pontos' manda sobre o bm25 cru
    com_pontos = {**falso, "precedentes": [
        {**falso["precedentes"][0], "score": -9.0, "pontos": 1.0},
        {**falso["precedentes"][1], "score": -9.0, "pontos": 1.0},
        {**falso["precedentes"][2], "score": -1.0, "pontos": 40.0},
    ]}
    assert no_prognostico(com_pontos)["prognostico"]["resultado_provavel"] == "provido"

    # --- abstencao: o sistema tem que saber calar
    # 8 precedentes unanimes, no MESMO lado que a floresta aponta -> crava.
    # (Precisa ser o mesmo lado: 8 precedentes fabricados contra a floresta
    # geram recusa por desacordo, e isso tambem esta' certo — foi o que este
    # teste pegou quando o fixture apontava para o lado oposto.)
    lado = floresta.prever("dano moral", classe="Apelação Cível")
    lado = ("provido" if not lado or lado["p_reforma"] >= 0.5 else "desprovido")
    firme = {**falso, "precedentes": [
        {"id": i, "resultado": lado, "confianca": "dispositivo",
         "nota": 5, "pontos": 20.0} for i in range(8)]}
    pf = no_prognostico(firme)["prognostico"]
    assert pf["decide"] is True, pf["confianca"]
    assert pf["intervalo_pct"] and pf["intervalo_pct"][0] <= pf["intervalo_pct"][1]

    # o mesmo conjunto, mas apontando contra a floresta -> recusa por desacordo
    contra_rf = {**falso, "precedentes": [
        {**p, "resultado": "desprovido" if lado == "provido" else "provido"}
        for p in firme["precedentes"]]}
    pc = no_prognostico(contra_rf)["prognostico"]
    assert pc["decide"] is False and "discordam" in " ".join(pc["confianca"]["por_que"])

    # metade a metade -> nao crava, e diz por que
    dividido = {**falso, "precedentes": [
        {"id": i, "resultado": "provido" if i % 2 else "desprovido",
         "confianca": "dispositivo", "nota": 5, "pontos": 20.0} for i in range(8)]}
    pd = no_prognostico(dividido)["prognostico"]
    assert pd["decide"] is False and pd["faixa"] == "nao_decide", pd
    assert pd["confianca"]["por_que"], "recusou sem explicar o motivo"

    # dois precedentes -> amostra pequena demais, nao crava nem com unanimidade
    poucos = {**falso, "precedentes": [
        {"id": i, "resultado": "desprovido", "confianca": "dispositivo",
         "nota": 5, "pontos": 20.0} for i in range(2)]}
    assert no_prognostico(poucos)["prognostico"]["decide"] is False

    # o bloco de procedencia so' aparece quando ha' o que dizer
    assert _bloco_procedencia({}) == ""
    b = _bloco_procedencia({"perfil": {"usos": 300, "primeiro_ano": 2015,
                                       "ultimo_ano": 2025, "reforma_pct": 22.0,
                                       "com_ancora_nacional": 40,
                                       "por_orgao": [("Segunda Câmara", 100)]},
                            "contra": {"contra": 2, "de": 8, "nao_unanimes": 1,
                                       "lado_majoritario": "manutencao",
                                       "exemplos": [{"numero": "123"}]}})
    assert "300 decisões" in b and "CONTRA-ARGUMENTAÇÃO" in b and "123" in b, b

    # --- linha de argumentacao: puxa material do lado pedido SEM mexer no
    # prognostico. E' a invariante que sustenta o resto do sistema — se a busca
    # enviesada vazar para a contagem, o percentual calibrado vira propaganda.
    fake = [{"id": i, "numero": "n%d" % i, "resultado": r, "confianca": "dispositivo",
             "nota": 5, "pontos": 10.0, "ano": 2024, "orgao": "Segunda Câmara",
             "classe": "Apelação Cível", "unanime": 1,
             "ancoras_json": '["Tema 1059/STJ"]', "neutro": n}
            for i, (r, n) in enumerate([("desprovido", True)] * 6
                                       + [("provido", False)] * 4)]
    base = {"triagem": {"classe": "Apelação Cível"}, "filtros": {}}
    neutros = [c for c in fake if c["neutro"]]
    p_neutro = no_prognostico({**base, "precedentes": neutros})["prognostico"]
    assert p_neutro["reforma_nos_precedentes"] == 0.0, p_neutro

    prec = [c for c in fake if c.get("neutro")][:8]
    lado = TESES["reformar"]
    sust = [c for c in fake if c["resultado"] in lado][:8]
    assert len(prec) == 6 and len(sust) == 4, (len(prec), len(sust))
    assert no_prognostico({**base, "precedentes": prec})["prognostico"][
        "reforma_nos_precedentes"] == 0.0, "a busca da tese vazou para a contagem"

    c = sinais.comuns(sust)
    assert c["n"] == 4 and c["ancoras"] == [("Tema 1059/STJ", 4)], c
    assert sinais.comuns([]) == {}
    assert "Tema 1059/STJ" in _bloco_comuns(c) and _bloco_comuns({}) == ""
    assert TESES["neutra"] == () and set(TESES) == {"neutra", "reformar", "manter"}

    assert _suficiente({"precedentes": [1, 2, 3], "ciclo_busca": 1}) == "prognostico"
    assert _suficiente({"precedentes": [1], "ciclo_busca": 1}) == "recuperar"
    assert _suficiente({"precedentes": [], "ciclo_busca": 2}) == "prognostico"
    fim = "julgar" if config().get("julgar_consultas") else END
    assert _aprovado({"criticas": [], "ciclo_revisao": 1}) == fim
    assert _aprovado({"criticas": ["x"], "ciclo_revisao": 1}) == "redigir"
    assert _aprovado({"criticas": ["x"], "ciclo_revisao": 2}) == fim
    assert "julgar" in construir().get_graph().nodes
    print("self-check OK — grafo monta e o prognóstico fecha a conta sem LLM")
