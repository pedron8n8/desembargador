"""Recuperacao local: BM25 sobre o indice FTS5. Sem chave de API, sem rede.

A ementa pesa mais que o dispositivo (3x): o dispositivo carrega os verbos
decisorios, que sao quase iguais nas 20 mil decisoes e nao distinguem materia.
"""
import os
import re
import sqlite3
import sys

RAG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), "output", "rag.db")


def _exigir(banco):
    """`banco` sem default de proposito: cada cerebro tem o seu rag.db.

    Um default silencioso aqui produziria o unico bug desta base que ninguem
    detecta — a consulta de um cerebro respondida com os precedentes de outro,
    plausivel e sem erro nenhum. Melhor explodir na hora, no self-check.
    """
    if not banco:
        raise ValueError(
            "busca sem banco: passe banco=cerebros.caminhos(slug)['rag']")
    return banco

_LIXO = re.compile(r"[^\wÀ-ÿ\s.º°§-]", re.U)
# Palavras que aparecem em quase toda decisao: pontuam ruido no BM25.
_VAZIAS = {"recurso", "apelacao", "apelação", "agravo", "processo", "civel",
           "cível", "acordao", "acórdão", "decisao", "decisão", "sentenca",
           "sentença", "art", "artigo", "parte", "autor", "reu", "réu"}


def _termo_fts(t):
    """Aspas duplas transformam o termo em frase literal e neutralizam a sintaxe
    do FTS5 (OR, NEAR, *, :). Aspas internas se escapam duplicando."""
    t = _LIXO.sub(" ", t).strip()
    return '"%s"' % t.replace('"', '""') if t else ""


def montar_consulta(termos):
    """Lista de termos -> expressao FTS5. Termos de 1 palavra muito comuns caem fora."""
    partes = []
    for t in termos:
        t = (t or "").strip()
        if not t or (" " not in t and t.lower() in _VAZIAS):
            continue
        q = _termo_fts(t)
        if q and q not in partes:
            partes.append(q)
    return " OR ".join(partes)


CAMPOS = ("id", "numero", "tipo", "classe", "orgao", "comarca", "data", "ano",
          "url", "resultado", "confianca", "tem_teor", "ementa", "dispositivo",
          # ficha de procedencia — quem consome e' o rerank (src/rag/rerank.py)
          "ancora", "ancoras_json", "unanime", "efeito",
          # os dispositivos legais nao pesam no rerank: vao inteiros para o bloco
          # de procedencia do redator (src/rag/grafo.py) e para o grafo da tela
          "leis_json")

_conexoes = {}


def _db(banco):
    """Conexao por banco, reaproveitada. Abrir a cada consulta custava ~1s no
    indice de 68 MB — irrelevante numa consulta, proibitivo na avaliacao."""
    if banco not in _conexoes:
        _conexoes[banco] = sqlite3.connect(
            "file:%s?mode=ro" % banco.replace("\\", "/"), uri=True,
            check_same_thread=False)
    return _conexoes[banco]


def buscar(consulta, limite=40, classe=None, ano_min=None, ano_max=None,
           excluir=(), excluir_numeros=(), resultados=(), banco=None):
    """Devolve lista de dicts ordenada por relevancia BM25 (score: menor = melhor).

    So' BM25 e filtros. Quem mexe na ordem depois disso — feedback do usuario,
    idade, ancora, efeito — e' o src/rag/rerank.py. Ate a fase 2 havia dois
    lugares alterando o score; com os sinais novos seriam tres, e ninguem
    saberia mais explicar por que um precedente ficou em primeiro.
    """
    banco = _exigir(banco)
    if not consulta.strip():
        return []
    bruto = limite
    sql = ["SELECT %s, bm25(decisao_fts, 3.0, 1.0) AS score "
           "FROM decisao_fts JOIN decisao d ON d.id = decisao_fts.rowid "
           "WHERE decisao_fts MATCH ?" % ",".join("d." + c for c in CAMPOS)]
    args = [consulta]
    if classe:
        sql.append("AND d.classe LIKE ?")
        args.append("%" + classe + "%")
    if ano_min:
        sql.append("AND d.ano >= ?")
        args.append(int(ano_min))
    if ano_max:
        sql.append("AND d.ano <= ?")
        args.append(int(ano_max))
    if excluir:
        sql.append("AND d.id NOT IN (%s)" % ",".join("?" * len(excluir)))
        args += list(excluir)
    if excluir_numeros:
        # Excluir o id do alvo nao basta na avaliacao: o mesmo processo aparece
        # em varias linhas (agravo, embargos, reconsideracao), com texto quase
        # identico e o mesmo desfecho. A irma sobrevivente virava o precedente
        # numero 1 e o teste media memoria, nao previsao.
        sql.append("AND d.numero NOT IN (%s)" % ",".join("?" * len(excluir_numeros)))
        args += list(excluir_numeros)
    if resultados:
        sql.append("AND d.resultado IN (%s)" % ",".join("?" * len(resultados)))
        args += list(resultados)
    sql.append("ORDER BY score LIMIT ?")
    args.append(int(bruto))

    try:
        linhas = _db(banco).execute(" ".join(sql), args).fetchall()
    except sqlite3.OperationalError as e:
        # sintaxe invalida do FTS5 nao deve derrubar o grafo
        print("busca falhou (%s) para: %s" % (e, consulta[:120]), file=sys.stderr)
        return []
    return [dict(zip(CAMPOS + ("score",), l)) for l in linhas][:limite]


def taxa_da_classe(classe, banco=None):
    """Base rate historica: (n_merito, taxa_de_reforma) para a classe."""
    n, ref = _db(_exigir(banco)).execute(
        "SELECT count(*), sum(resultado IN ('provido','parcialmente provido')) "
        "FROM decisao WHERE resultado IN "
        "('provido','parcialmente provido','desprovido') AND classe LIKE ?",
        ("%" + (classe or "") + "%",)).fetchone()
    return n or 0, (ref / n) if n else None


if __name__ == "__main__":
    from .. import cerebros

    cam = cerebros.caminhos()          # o cerebro padrao, explicito de proposito
    termos = sys.argv[1:] or ["efeito suspensivo", "agravo de instrumento"]
    q = montar_consulta(termos)
    print("cérebro: %s  (%s)" % (cam["nome"], cam["rag"]))
    print("consulta FTS5:", q)

    # esquecer o banco tem de explodir, nao cair num acervo qualquer
    try:
        buscar(q, limite=1)
        raise AssertionError("buscar sem banco tinha que levantar")
    except ValueError:
        pass

    r = buscar(q, limite=10, banco=cam["rag"])
    assert r, "nenhum resultado — indice vazio? rode: python -m src.rag.indexar"
    for d in r:
        print("\n[%.1f] %s | %s | %s | %s -> %s"
              % (d["score"], d["numero"], d["data"], d["classe"][:34],
                 d["comarca"][:18], d["resultado"]))
        print("   " + d["ementa"][:150])
    assert all(r[i]["score"] <= r[i + 1]["score"] for i in range(len(r) - 1))
    assert all("ancora" in d for d in r), "reindexe: faltam as colunas da ficha"
    print("\n%d resultados, ordenados por BM25 puro." % len(r))
    print("(reordenacao por idade/ancora/efeito/feedback: python -m src.rag.rerank)")

    # --- excluir por PROCESSO, nao so' por linha. 4.636 das 20.363 decisoes
    # (22,8%) dividem numero com outra: agravo + embargos de declaracao do
    # mesmo caso, mesmas partes, texto quase clonado, mesmo desfecho. Excluir
    # so' o id deixava a irma no indice como candidato BM25 quase perfeito, e o
    # sistema "acertava" lendo a resposta de si mesmo.
    linha = _db(cam["rag"]).execute(
        "SELECT numero FROM decisao WHERE numero != '' "
        "GROUP BY numero HAVING count(*) > 1 LIMIT 1").fetchone()
    assert linha, "o indice nao tem processo repetido — teste sem sentido"
    numero = linha[0]
    q = montar_consulta(["recurso"])
    achados = buscar(q, limite=500, banco=cam["rag"], excluir_numeros=(numero,))
    assert all(a["numero"] != numero for a in achados), \
        "excluir_numeros deixou passar linha do mesmo processo"
    print("\nOK: excluir_numeros tira do indice todas as linhas do processo %s." % numero)
