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
          "ancora", "ancoras_json", "unanime", "efeito")

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
           excluir=(), banco=RAG):
    """Devolve lista de dicts ordenada por relevancia BM25 (score: menor = melhor).

    So' BM25 e filtros. Quem mexe na ordem depois disso — feedback do usuario,
    idade, ancora, efeito — e' o src/rag/rerank.py. Ate a fase 2 havia dois
    lugares alterando o score; com os sinais novos seriam tres, e ninguem
    saberia mais explicar por que um precedente ficou em primeiro.
    """
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
    sql.append("ORDER BY score LIMIT ?")
    args.append(int(bruto))

    try:
        linhas = _db(banco).execute(" ".join(sql), args).fetchall()
    except sqlite3.OperationalError as e:
        # sintaxe invalida do FTS5 nao deve derrubar o grafo
        print("busca falhou (%s) para: %s" % (e, consulta[:120]), file=sys.stderr)
        return []
    return [dict(zip(CAMPOS + ("score",), l)) for l in linhas][:limite]


def taxa_da_classe(classe, banco=RAG):
    """Base rate historica: (n_merito, taxa_de_reforma) para a classe."""
    n, ref = _db(banco).execute(
        "SELECT count(*), sum(resultado IN ('provido','parcialmente provido')) "
        "FROM decisao WHERE resultado IN "
        "('provido','parcialmente provido','desprovido') AND classe LIKE ?",
        ("%" + (classe or "") + "%",)).fetchone()
    return n or 0, (ref / n) if n else None


if __name__ == "__main__":
    termos = sys.argv[1:] or ["efeito suspensivo", "agravo de instrumento"]
    q = montar_consulta(termos)
    print("consulta FTS5:", q)
    r = buscar(q, limite=10)
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
