"""Constroi output/rag.db a partir de output/tjsc.db.

O indice guarda so o que a recuperacao precisa: ementa limpa, dispositivo e os
metadados de filtro. O inteiro teor (281 MB) NAO e' copiado — o no de redacao
puxa os textos completos direto do tjsc.db pelo mesmo id.
"""
import json
import os
import sqlite3
import sys
import time

from . import sinais
from .classificador import classificar, extrair_dispositivo, limpar_ementa

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TJSC = os.path.join(RAIZ, "output", "tjsc.db")
RAG = os.path.join(RAIZ, "output", "rag.db")

ESQUEMA = """
CREATE TABLE decisao (
  id              INTEGER PRIMARY KEY,   -- mesmo id de decisoes em tjsc.db
  numero          TEXT,
  categoria       TEXT,
  tipo            TEXT,
  classe          TEXT,
  orgao           TEXT,
  comarca         TEXT,
  data            TEXT,                  -- ISO aaaa-mm-dd
  ano             INTEGER,
  url             TEXT,
  resultado       TEXT,                  -- do classificador
  confianca       TEXT,                  -- dispositivo | texto completo | ementa | -
  tem_teor        INTEGER,
  ementa          TEXT,
  dispositivo     TEXT,
  -- ficha de procedencia (src/rag/sinais.py), tudo deterministico
  ancora          TEXT,                  -- vinculante | persuasiva | estadual
  ancoras_json    TEXT,                  -- ["Tema 1059/STJ", "Súmula 297/STJ"]
  unanime         INTEGER,               -- 1 | 0 | NULL (nao identificado)
  efeito          TEXT                   -- {"transitou","subiu","sobrestado"} do Datajud
);
CREATE INDEX ix_classe ON decisao(classe);
CREATE INDEX ix_ano ON decisao(ano);
CREATE INDEX ix_ancora ON decisao(ancora);
CREATE VIRTUAL TABLE decisao_fts USING fts5(
  ementa, dispositivo,
  content='decisao', content_rowid='id',
  tokenize="unicode61 remove_diacritics 2");
"""


def construir(tjsc=TJSC, rag=RAG, verboso=True):
    if os.path.exists(rag):
        os.remove(rag)
    orig = sqlite3.connect("file:%s?mode=ro" % tjsc.replace("\\", "/"), uri=True)
    novo = sqlite3.connect(rag)
    novo.executescript(ESQUEMA)

    # os movimentos do Datajud entram por numero_processo; carregar uma vez e'
    # mais barato que 20 mil consultas
    mov = sinais.movimentos_por_processo(tjsc)
    if verboso:
        print("  %d processos com movimento relevante no Datajud" % len(mov), flush=True)

    cur = orig.execute(
        "SELECT id, numero_processo_raw, numero_processo, categoria, tipo_documento, "
        "       classe, orgao, origem, data_julgamento, url, ementa, inteiro_teor "
        "FROM decisoes")
    t0, n, com_disp, com_efeito = time.time(), 0, 0, 0
    colunas = 19
    lote = []
    for (id_, num_raw, num, cat, tipo, classe, orgao, comarca, data, url,
         ementa, teor) in cur:
        resultado, confianca, _ = classificar(teor, ementa)
        disp = extrair_dispositivo(teor)
        com_disp += bool(disp)
        f = sinais.ficha(teor, mov.get(num or ""))
        com_efeito += f["efeito"] is not None
        lote.append((
            id_, (num_raw or num or "").strip(), cat, tipo, classe, orgao, comarca,
            data, int(data[:4]) if data and data[:4].isdigit() else None, url,
            resultado, confianca, int(bool(teor and len(teor) > 200)),
            limpar_ementa(ementa), disp,
            f["ancora"], json.dumps(f["ancoras"], ensure_ascii=False), f["unanime"],
            json.dumps(f["efeito"]) if f["efeito"] else None))
        n += 1
        if len(lote) >= 500:
            novo.executemany(
                "INSERT INTO decisao VALUES (%s)" % ",".join("?" * colunas), lote)
            lote.clear()
            if verboso and n % 5000 == 0:
                print("  %6d decisoes..." % n, flush=True)
    if lote:
        novo.executemany("INSERT INTO decisao VALUES (%s)" % ",".join("?" * colunas), lote)

    novo.execute("INSERT INTO decisao_fts(rowid, ementa, dispositivo) "
                 "SELECT id, ementa, dispositivo FROM decisao")
    novo.commit()
    novo.execute("VACUUM")
    novo.close()
    orig.close()
    if verboso:
        print("indexadas %d decisoes (%d com dispositivo, %d com efeito no Datajud) "
              "em %.0fs — %.0f MB"
              % (n, com_disp, com_efeito, time.time() - t0, os.path.getsize(rag) / 1e6))
    return n, com_disp


if __name__ == "__main__":
    import argparse

    from .. import cerebros

    ap = argparse.ArgumentParser(description="Constrói o índice FTS5 de um cérebro")
    cerebros.argumento(ap)
    a_ = ap.parse_args()
    cam = cerebros.caminhos(a_.cerebro)
    TJSC, RAG = cam["tjsc"], cam["rag"]
    if not os.path.exists(TJSC):
        raise SystemExit("sem acervo coletado para %s — rode: python -m src.main "
                         "--cerebro %s" % (cam["nome"], cam["slug"]))
    print("cérebro: %s\n  %s -> %s\n" % (cam["nome"], TJSC, RAG))
    os.makedirs(os.path.dirname(RAG), exist_ok=True)

    n, d = construir(TJSC, RAG)

    # A contagem esperada e' por cerebro, e so' existe depois de uma coleta
    # completa conferida (cerebros.json -> esperado.decisoes). O aviso continua
    # valendo a pena: ele pega coleta truncada, que e' erro caro e silencioso.
    # Cerebro sem o campo — recem-coletado — nao recebe aviso nenhum.
    esperado = (cerebros.obter(cam["slug"]).get("esperado") or {}).get("decisoes")
    if esperado and n != esperado:
        print("AVISO: esperava %d decisões no tjsc.db de %s, achei %d. Coleta\n"
              "       truncada? Se a diferença for esperada (coleta nova),\n"
              "       atualize \"esperado\" em cerebros.json."
              % (esperado, cam["slug"], n), file=sys.stderr)
    elif not esperado:
        print("\n(sem contagem de referência para %s — se estas %d decisões forem "
              "a coleta\n completa, grave \"esperado\": {\"decisoes\": %d} em "
              "cerebros.json)" % (cam["slug"], n, n))

    db = sqlite3.connect(RAG)
    print("\ndistribuicao de resultados:")
    for r, c in db.execute("SELECT resultado, count(*) c FROM decisao "
                           "GROUP BY 1 ORDER BY c DESC"):
        print("  %-28s %6d  %5.1f%%" % (r, c, 100 * c / n))
    print("\nancora do argumento:")
    for r, c in db.execute("SELECT ancora, count(*) c FROM decisao "
                           "GROUP BY 1 ORDER BY c DESC"):
        print("  %-28s %6d  %5.1f%%" % (r, c, 100 * c / n))
    print("\nunanimidade:")
    for r, c in db.execute("SELECT CASE unanime WHEN 1 THEN 'unanime' WHEN 0 THEN "
                           "'divergencia' ELSE 'nao identificada' END, count(*) c "
                           "FROM decisao GROUP BY 1 ORDER BY c DESC"):
        print("  %-28s %6d  %5.1f%%" % (r, c, 100 * c / n))
    ef, = db.execute("SELECT count(*) FROM decisao WHERE efeito IS NOT NULL").fetchone()
    print("\nefeito posterior (Datajud): %d decisoes (%.1f%%)" % (ef, 100 * ef / n))

    # Gemeas por deriva de ementa (ver o comentario longo em src/merge.py).
    # A reindexacao e' o momento em que gemeas novas apareceriam, entao e' aqui
    # que se vigia. Nao se apaga nada: no acervo do rubens-schulz, em 04/08/2026,
    # eram 114 grupos / 229 linhas e o dano medido no top-8 de 300 consultas
    # cegas foi ZERO. A referencia e' daquele acervo — em cerebro novo o que
    # importa e' a PROPORCAO, nao o numero absoluto.
    orig_ro = sqlite3.connect("file:%s?mode=ro" % TJSC.replace("\\", "/"), uri=True)
    g, l = orig_ro.execute(
        "SELECT count(*), COALESCE(sum(c),0) FROM (SELECT count(*) c FROM decisoes "
        "GROUP BY fonte,categoria,numero_processo_raw,data_julgamento "
        "HAVING count(DISTINCT hash) > 1)").fetchone()
    orig_ro.close()
    print("gêmeas por deriva de ementa: %d grupos, %d linhas (%.1f%%) — "
          "referência do acervo rubens-schulz em 04/08/2026: 114 / 229 (1,1%%)"
          % (g, l, 100 * l / n if n else 0))
