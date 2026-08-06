"""A rede dos precedentes: o que liga uma decisao a outra, e por que.

Duas naturezas de aresta, ambas explicaveis — que e' o ponto do sistema inteiro:

  ancora   as duas se apoiam no MESMO precedente vinculante (Tema 1059/STJ,
           Sumula 54, IRDR). E' a afirmacao juridica util, e o rotulo vai na
           aresta. Sai de decisao.ancoras_json, que ja' existe no indice.

  texto    as ementas se parecem (TF-IDF cosseno). E' o sinal fraco, e vem
           tracejado: dizer "0,31 parecidas" nao e' argumento, e' pista.

NORMALIZACAO NAO E' DETALHE. Medido no rag.db: 7.311 decisoes com ancora e 1.941
rotulos distintos, porque o mesmo precedente aparece como "Súmula 54 do STJ",
"SÚMULA 54 DO STJ", "Súmula n. 54" e "Súmula 54". Sem canonizar, as arestas de
ancora simplesmente nao aparecem — e o grafo sai vazio sem erro nenhum, que e' o
pior modo de falhar.

Calculado SOB DEMANDA por consulta, sobre os <=40 candidatos que ja' estao no
estado (<=88 no 2o ciclo). Nunca sobre o corpus inteiro: 20 mil nos nao sao uma
visualizacao, sao um borrao.

NAO usa embeddings de proposito — ver a secao "Por que nao tem banco vetorial"
no README. O sqlite-vec esta' instalado no venv e continua sem servir para isto:
nao ha' modelo de embedding no projeto.

    python -m src.rag.rede                 # self-check
    python -m src.rag.rede "dano moral"    # roda sobre uma busca de verdade
"""
import json
import re
import sys
import unicodedata

# Rotulo canonico: (tipo, numero, corte). "Súmula n. 54 do STJ" e "SUMULA 54/STJ"
# tem que virar a mesma chave, senao a aresta some.
_TIPOS = (("sumula vinculante", "sumula-vinculante"), ("sumula", "sumula"),
          ("temas", "tema"), ("tema", "tema"), ("irdr", "irdr"), ("iac", "iac"))
_ORDINAL = re.compile(r"\bn[.ºo°]*\s*", re.I)
_NUM = re.compile(r"\d{1,4}")
_CORTE = re.compile(r"\bst[jf]\b", re.I)


def canonizar(rotulo):
    """'Súmula n. 54 do STJ' -> 'sumula:54:stj'. None se nao reconhecer nada."""
    if not rotulo:
        return None
    t = unicodedata.normalize("NFKD", str(rotulo))
    t = "".join(c for c in t if not unicodedata.combining(c)).casefold()
    t = _ORDINAL.sub(" ", t)
    t = re.sub(r"[^\w\s/]", " ", t)
    t = " ".join(t.split())
    tipo = next((canon for chave, canon in _TIPOS if t.startswith(chave)), None)
    if tipo is None:
        return None
    num = _NUM.search(t)
    if not num:
        # "IRDR" ou "Súmula" sem número não IDENTIFICA um precedente. Juntar
        # todos num nó só afirmaria que decisões se apoiam na mesma coisa quando
        # tudo o que se sabe é que as duas citam algum incidente. A natureza
        # vinculante já está em decisao.ancora; aqui só entra o que dá para
        # apontar com o dedo.
        return None
    if tipo in ("irdr", "iac"):
        return "%s:%s" % (tipo, num.group(0))
    corte = _CORTE.search(t)
    return "%s:%s:%s" % (tipo, num.group(0), corte.group(0).lower() if corte else "?")


def ancoras(d):
    """Conjunto canonico das ancoras de uma decisao."""
    bruto = d.get("ancoras_json")
    if isinstance(bruto, str):
        try:
            bruto = json.loads(bruto or "[]")
        except ValueError:
            bruto = []
    saida = {}
    for a in (bruto or []):
        c = canonizar(a)
        if c:
            saida.setdefault(c, a)      # guarda o primeiro rotulo legivel visto
    return saida


def resolver_corte(chaves):
    """{chave_ambigua: chave_resolvida} — 'sumula:150:?' -> 'sumula:150:stf'.

    Metade das citações não nomeia o tribunal ("Súmula 150"), a outra metade
    nomeia ("Súmula 150/STF"). Tratadas como coisas diferentes, o mesmo verbete
    vira dois nós e o grafo conta a mesma sustentação duas vezes — foi o que
    apareceu na primeira medição (Súmula 150 com 22 decisões AO LADO de Súmula
    150/STF com 15).

    Só resolve quando não há dúvida: se o mesmo número aparece com DOIS
    tribunais no conjunto, a citação sem tribunal fica separada. Nesse caso
    escolher seria inventar de qual corte é o precedente.
    """
    cortes = {}
    for c in chaves:
        p = c.split(":")
        if len(p) == 3 and p[2] != "?":
            cortes.setdefault((p[0], p[1]), set()).add(p[2])
    saida = {}
    for c in chaves:
        p = c.split(":")
        if len(p) == 3 and p[2] == "?":
            candidatos = cortes.get((p[0], p[1]), set())
            if len(candidatos) == 1:
                saida[c] = "%s:%s:%s" % (p[0], p[1], next(iter(candidatos)))
    return saida


def _jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _tfidf(textos):
    """Matriz de similaridade cosseno entre ementas. sklearn se houver."""
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
    except ImportError:
        return None
    try:
        v = TfidfVectorizer(strip_accents="unicode", sublinear_tf=True,
                            ngram_range=(1, 2), min_df=1, max_features=20000)
        x = v.fit_transform(textos)
    except ValueError:                  # vocabulario vazio
        return None
    return (x @ x.T).toarray()


_PALAVRA = re.compile(r"\w{4,}", re.U)


def _similar_puro(textos):
    """Fallback sem sklearn: Jaccard de palavras. Pior, mas nao mente sobre isso."""
    toks = []
    for t in textos:
        n = unicodedata.normalize("NFKD", t or "")
        n = "".join(c for c in n if not unicodedata.combining(c)).casefold()
        toks.append(set(_PALAVRA.findall(n)))
    return [[_jaccard(a, b) for b in toks] for a in toks]


def montar(candidatos, limiar=0.12, max_por_no=4, usar_texto=True):
    """{nos, arestas, resumo}. `candidatos` sao dicts do busca.buscar/rerank."""
    cands = [c for c in candidatos if c.get("id") is not None]
    # o mesmo id pode vir da busca neutra E da busca da tese
    vistos, unicos = set(), []
    for c in cands:
        if c["id"] not in vistos:
            vistos.add(c["id"])
            unicos.append(c)
    cands = unicos

    nos = [{"id": c["id"], "tipo": "decisao",
            "numero": c.get("numero"), "classe": c.get("classe"),
            "orgao": c.get("orgao"), "ano": c.get("ano"), "data": c.get("data"),
            "resultado": c.get("resultado"), "nota": c.get("nota"),
            "pontos": c.get("pontos"), "ancora": c.get("ancora"),
            "unanime": c.get("unanime"),
            "precedente": bool(c.get("_precedente")),
            "sustentacao": bool(c.get("_sustentacao")),
            "ancoras": sorted(ancoras(c).values())}
           for c in cands]

    mapa = [ancoras(c) for c in cands]
    # 'Súmula 150' e 'Súmula 150/STF' são o mesmo verbete; ver resolver_corte
    equiv = resolver_corte({k for m in mapa for k in m})
    if equiv:
        mapa = [{equiv.get(k, k): v for k, v in m.items()} for m in mapa]
        for n, m in zip(nos, mapa):
            n["ancoras"] = sorted(m.values())
    arestas = []

    # --- (a) ancora compartilhada: a ANCORA VIRA NO'.
    #
    # A forma obvia seria ligar decisao a decisao quando as duas citam a mesma
    # sumula. Medido: 40 candidatos deram 466 arestas, porque 20 decisoes que
    # citam a Sumula 150 formam uma clique de 190. Isso e' um novelo, e pior,
    # esconde o fato que interessa — QUAL precedente as segura. Como no', a
    # mesma informacao custa 20 arestas em vez de 190, e a leitura vira
    # "estas 20 decisoes se apoiam na Sumula 150", que e' a frase juridica.
    usos = {}
    for i, m in enumerate(mapa):
        for chave, rotulo in m.items():
            usos.setdefault(chave, {"rotulo": rotulo, "indices": []})
            usos[chave]["indices"].append(i)
    for chave, u in usos.items():
        if len(u["indices"]) < 2:
            continue            # ancora citada por uma decisao so' nao liga nada
        nos.append({"id": "anc:" + chave, "tipo": "ancora",
                    "rotulo": u["rotulo"], "chave": chave,
                    "grau": len(u["indices"]),
                    "vinculante": chave.startswith(("tema", "sumula-vinculante",
                                                    "irdr", "iac"))})
        for i in u["indices"]:
            arestas.append({"de": cands[i]["id"], "para": "anc:" + chave,
                            "tipo": "ancora", "peso": 1.0, "rotulo": u["rotulo"]})

    # --- (b) semelhanca de ementa: tracejada, e podada
    if usar_texto and len(cands) > 1:
        textos = [(c.get("ementa") or c.get("dispositivo") or "") for c in cands]
        if any(t.strip() for t in textos):
            sim = _tfidf(textos)
            if sim is None:
                sim = _similar_puro(textos)
            ja = set()
            # top-k por no': o grafo completo de 40 nos e' um novelo, nao um mapa
            for i in range(len(cands)):
                vizinhos = sorted(
                    ((float(sim[i][j]), j) for j in range(len(cands)) if j != i),
                    reverse=True)[:max_por_no]
                for peso, j in vizinhos:
                    if peso < limiar:
                        continue
                    a, b = sorted((cands[i]["id"], cands[j]["id"]))
                    if (a, b) in ja:
                        continue
                    ja.add((a, b))
                    arestas.append({"de": a, "para": b, "tipo": "texto",
                                    "peso": round(peso, 4), "rotulo": None})

    ligados = {a["de"] for a in arestas} | {a["para"] for a in arestas}
    return {
        "nos": nos,
        "arestas": arestas,
        "resumo": {
            "n_decisoes": len(cands),
            "n_ancoras": sum(n["tipo"] == "ancora" for n in nos),
            "n_arestas": len(arestas),
            "por_ancora": sum(a["tipo"] == "ancora" for a in arestas),
            "por_texto": sum(a["tipo"] == "texto" for a in arestas),
            "isolados": sum(c["id"] not in ligados for c in cands),
            "ancoras_distintas": len({k for m in mapa for k in m}),
        },
    }


if __name__ == "__main__":
    # --- canonizacao: os quatro jeitos de escrever a mesma sumula
    for v in ("Súmula 54 do STJ", "SÚMULA 54 DO STJ", "Súmula n. 54 do STJ",
              "Sumula 54/STJ", "súmula nº 54 do stj"):
        assert canonizar(v) == "sumula:54:stj", (v, canonizar(v))
    assert canonizar("Tema 1059/STJ") == canonizar("tema 1059 do STJ") == "tema:1059:stj"
    assert canonizar("Súmula Vinculante n. 13") == "sumula-vinculante:13:?"
    assert canonizar("Súmula 54") == "sumula:54:?"
    # sumula 54 do STJ e sumula 54 do STF NAO sao a mesma coisa
    assert canonizar("Súmula 54 do STJ") != canonizar("Súmula 54 do STF")
    assert canonizar("precedente desta Câmara") is None
    assert canonizar("") is None and canonizar(None) is None
    # sem numero nao identifica precedente nenhum
    assert canonizar("IRDR") is None and canonizar("Súmula do STJ") is None
    assert canonizar("IRDR n. 12") == "irdr:12"

    # --- resolucao de corte: so' quando nao ha' duvida
    assert resolver_corte({"sumula:150:?", "sumula:150:stf"}) == \
        {"sumula:150:?": "sumula:150:stf"}
    # dois tribunais com o mesmo numero: escolher seria inventar
    assert resolver_corte({"sumula:150:?", "sumula:150:stf", "sumula:150:stj"}) == {}
    # nada a resolver
    assert resolver_corte({"sumula:150:stf"}) == {} == resolver_corte(set())
    # e nao mistura tipos: tema 150 nao resolve sumula 150
    assert resolver_corte({"sumula:150:?", "tema:150:stj"}) == {}

    # --- a ancora vira no', e as duas grafias caem no mesmo
    fake = [
        {"id": 1, "numero": "A", "ano": 2024, "resultado": "provido",
         "ancoras_json": '["S\\u00famula 54 do STJ", "Tema 1059/STJ"]',
         "ementa": "responsabilidade civil juros de mora dano moral"},
        {"id": 2, "numero": "B", "ano": 2023, "resultado": "provido",
         "ancoras_json": '["S\\u00daMULA N. 54 DO STJ"]',
         "ementa": "responsabilidade civil juros de mora dano moral acidente"},
        {"id": 3, "numero": "C", "ano": 2020, "resultado": "desprovido",
         "ancoras_json": "[]",
         "ementa": "prescrição intercorrente execução fiscal arquivamento"},
    ]
    r = montar(fake, limiar=0.05)
    hubs = [n for n in r["nos"] if n["tipo"] == "ancora"]
    assert len(hubs) == 1, hubs                 # Tema 1059 tem 1 uso so': não vira nó
    assert hubs[0]["chave"] == "sumula:54:stj" and hubs[0]["grau"] == 2, hubs
    anc = [a for a in r["arestas"] if a["tipo"] == "ancora"]
    assert len(anc) == 2, anc                   # 2 arestas, não uma clique
    assert {a["de"] for a in anc} == {1, 2}
    assert all(a["para"] == "anc:sumula:54:stj" for a in anc)
    assert r["resumo"]["ancoras_distintas"] == 2, r["resumo"]

    # o ganho que motivou a forma bipartida: N decisões com a mesma âncora dão
    # N arestas, não N*(N-1)/2
    muitas = [{"id": i, "numero": str(i), "ancoras_json": '["Tema 1059/STJ"]',
               "ementa": "texto %d" % i} for i in range(20)]
    rm = montar(muitas, usar_texto=False)
    assert rm["resumo"]["por_ancora"] == 20, rm["resumo"]

    # --- invariantes que a visualizacao depende
    ids = {n["id"] for n in r["nos"]}
    for a in r["arestas"]:
        assert a["de"] != a["para"], "laço próprio"
        assert a["de"] in ids and a["para"] in ids, "aresta para nó inexistente"
    pares = [(a["de"], a["para"], a["tipo"]) for a in r["arestas"]]
    assert len(pares) == len(set(pares)), "aresta duplicada"
    for a in r["arestas"]:
        if a["tipo"] == "texto":
            assert a["de"] < a["para"], "aresta de texto não canônica"

    # --- id repetido (busca neutra + busca da tese) vira um nó só
    assert montar(fake + [dict(fake[0])])["resumo"]["n_decisoes"] == 3

    # --- casos degenerados nao podem explodir
    assert montar([])["nos"] == []
    assert montar([fake[0]])["arestas"] == []
    assert montar([{"id": 9}, {"id": 10}])["resumo"]["n_arestas"] == 0

    # --- o fallback sem sklearn tem que dar o mesmo formato
    sem = montar(fake, limiar=0.05, usar_texto=False)
    assert sem["resumo"]["por_texto"] == 0 and sem["resumo"]["por_ancora"] == 2

    if len(sys.argv) > 1:
        from . import busca, rerank
        q = busca.montar_consulta(sys.argv[1:])
        cand = rerank.ordenar(busca.buscar(q, limite=40), limite=40)
        assert cand, "índice vazio? rode: python -m src.rag.indexar"
        r = montar(cand)
        s = r["resumo"]
        print("consulta: %s\n" % q)
        print("%d decisões + %d âncoras = %d nós; %d arestas (%d âncora, %d "
              "texto); %d decisões isoladas"
              % (s["n_decisoes"], s["n_ancoras"], len(r["nos"]), s["n_arestas"],
                 s["por_ancora"], s["por_texto"], s["isolados"]))
        print("%d âncoras distintas depois de canonizar\n" % s["ancoras_distintas"])
        for n in sorted((n for n in r["nos"] if n["tipo"] == "ancora"),
                        key=lambda n: -n["grau"])[:10]:
            print("  %-28s %2d decisões  %s"
                  % (n["rotulo"][:28], n["grau"],
                     "vinculante" if n["vinculante"] else ""))

    print("self-check OK — âncoras canonizadas, arestas únicas e sem laço")
