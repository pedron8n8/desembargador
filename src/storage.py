"""SQLite + exports + checkpoints + logging. Tudo stdlib."""
import csv
import hashlib
import json
import logging
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS processos (
    numero_processo TEXT NOT NULL,      -- 20 dígitos, normalizado
    fonte           TEXT NOT NULL,      -- ex.: 'datajud'
    tribunal        TEXT,
    classe          TEXT,
    classe_codigo   TEXT,
    assuntos_json   TEXT,               -- lista completa de assuntos (JSON)
    orgao_julgador  TEXT,
    data_ajuizamento TEXT,
    grau            TEXT NOT NULL DEFAULT '',
    formato         TEXT,
    sistema         TEXT,
    nivel_sigilo    TEXT,
    raw_json        TEXT,               -- hit completo do ES, nada é descartado
    hash            TEXT,
    coletado_em     TEXT,
    PRIMARY KEY (numero_processo, fonte, grau)
);

CREATE TABLE IF NOT EXISTS movimentos (
    numero_processo TEXT NOT NULL,
    codigo          TEXT,
    nome            TEXT,
    data_hora       TEXT,
    complementos_json TEXT,
    raw_json        TEXT,
    PRIMARY KEY (numero_processo, codigo, data_hora, raw_json)
);

CREATE TABLE IF NOT EXISTS decisoes (
    id              INTEGER PRIMARY KEY,-- chave interna estável (usada pela fase 2)
    fonte           TEXT NOT NULL,      -- ex.: 'portal_tjsc'
    doc_id          TEXT,               -- ROWID do Oracle no portal: VOLÁTIL, muda entre
                                        -- consultas. Serve só para buscar o documento
                                        -- logo após a listagem; nunca como identidade.
    categoria       TEXT,               -- base pesquisada: acordaos, decmonos, ...
    tipo_doc        TEXT,               -- tipo interno do portal: acordao_eproc, atr, ...
    tipo_documento  TEXT,               -- descrição: "Acórdão do Tribunal de Justiça"
    numero_processo TEXT,               -- 20 dígitos ('' quando numeração pré-CNJ)
    numero_processo_raw TEXT,           -- como aparece no portal
    relator         TEXT,
    origem          TEXT,
    orgao           TEXT,
    classe          TEXT,
    ementa          TEXT,
    inteiro_teor    TEXT,               -- fase 2 (html.do)
    data_julgamento TEXT,
    url             TEXT,
    doc_path        TEXT,               -- fase 2 (integra.do): .rtf/.pdf salvo
    detalhe_em      TEXT,               -- quando a fase 2 foi tentada (NULL = pendente).
                                        -- Fica preenchido mesmo quando o portal não tem
                                        -- o documento, para não retentar eternamente.
    detalhe_nota    TEXT,               -- 'segredo_de_justica' ou 'sem_conteudo'
    raw_json        TEXT,
    hash            TEXT,               -- SHA-256 da ementa: faz parte da identidade
    coletado_em     TEXT,
    -- Identidade pelo CONTEÚDO, não pelo id do portal. O doc_id é um ROWID do Oracle:
    -- muda entre execuções (a mesma decisão já apareceu com 3 ids em 3 listagens) e
    -- ainda é reusado entre decisões distintas. Usá-lo na chave criava linhas novas a
    -- cada relistagem e, no sentido inverso, apagava decisões diferentes.
    UNIQUE (fonte, categoria, numero_processo_raw, data_julgamento, hash)
);
CREATE INDEX IF NOT EXISTS idx_decisoes_numero ON decisoes(numero_processo);

CREATE TABLE IF NOT EXISTS consolidado (
    numero_processo TEXT PRIMARY KEY,
    relator         TEXT,
    orgao_julgador  TEXT,
    classe          TEXT,
    assuntos_json   TEXT,
    data_ajuizamento TEXT,
    data_julgamento TEXT,
    ementa          TEXT,
    inteiro_teor    TEXT,
    doc_path        TEXT,
    grau            TEXT,
    qtd_decisoes    INTEGER,            -- quantas decisões do portal nesse processo
    fontes          TEXT,               -- ex.: 'datajud,portal_tjsc'
    proveniencia_json TEXT,             -- campo -> fonte de onde veio
    atualizado_em   TEXT
);

CREATE TABLE IF NOT EXISTS checkpoints (
    fonte        TEXT PRIMARY KEY,
    cursor       TEXT,                  -- JSON livre (sort do search_after, nº da página...)
    atualizado_em TEXT
);
"""


def agora():
    return datetime.now(timezone.utc).isoformat()


def content_hash(*parts):
    h = hashlib.sha256()
    for p in parts:
        h.update((p or "").encode("utf-8", "replace"))
    return h.hexdigest()


class Storage:
    def __init__(self, db_path):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self._migrar()

    def _migrar(self):
        """Colunas acrescentadas depois — CREATE TABLE IF NOT EXISTS não as adiciona."""
        existentes = {r["name"] for r in self.db.execute("PRAGMA table_info(decisoes)")}
        for coluna, tipo in (("detalhe_em", "TEXT"), ("detalhe_nota", "TEXT")):
            if coluna not in existentes:
                self.db.execute(f"ALTER TABLE decisoes ADD COLUMN {coluna} {tipo}")

        # A PK de processos nasceu como (numero, fonte) e perdia o G1 quando o
        # G2 do mesmo processo chegava (INSERT OR REPLACE). SQLite nao altera
        # PK: reconstroi. Isto NAO traz de volta o que ja' se perdeu — para
        # isso, o checkpoint do datajud e' zerado logo abaixo, e a proxima
        # coleta repergunta tudo.
        pk = self.db.execute(
            "SELECT count(*) FROM pragma_table_info('processos') WHERE pk > 0"
        ).fetchone()[0]
        if pk == 2:
            self.db.executescript("""
                CREATE TABLE processos_novo (
                    numero_processo TEXT NOT NULL,
                    fonte           TEXT NOT NULL,
                    tribunal        TEXT,
                    classe          TEXT,
                    classe_codigo   TEXT,
                    assuntos_json   TEXT,
                    orgao_julgador  TEXT,
                    data_ajuizamento TEXT,
                    grau            TEXT NOT NULL DEFAULT '',
                    formato         TEXT,
                    sistema         TEXT,
                    nivel_sigilo    TEXT,
                    raw_json        TEXT,
                    hash            TEXT,
                    coletado_em     TEXT,
                    PRIMARY KEY (numero_processo, fonte, grau)
                );
                INSERT INTO processos_novo
                    SELECT numero_processo, fonte, tribunal, classe, classe_codigo,
                           assuntos_json, orgao_julgador, data_ajuizamento,
                           COALESCE(grau,''), formato, sistema, nivel_sigilo,
                           raw_json, hash, coletado_em
                    FROM processos;
                DROP TABLE processos;
                ALTER TABLE processos_novo RENAME TO processos;
                DELETE FROM checkpoints WHERE fonte IN ('datajud_ausentes','datajud_bulk');
            """)
        self.db.commit()

    # ---- upserts (INSERT OR REPLACE = dedup pela PK; hash detecta mudança de conteúdo) ----

    def upsert_processo(self, d):
        d.setdefault("coletado_em", agora())
        d["hash"] = content_hash(d.get("raw_json"))
        d["grau"] = d.get("grau") or ""      # NULL na PK duplicaria a linha
        cols = ("numero_processo fonte tribunal classe classe_codigo assuntos_json "
                "orgao_julgador data_ajuizamento grau formato sistema nivel_sigilo "
                "raw_json hash coletado_em").split()
        self.db.execute(
            f"INSERT OR REPLACE INTO processos ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            [d.get(c) for c in cols])

    def upsert_movimento(self, d):
        cols = "numero_processo codigo nome data_hora complementos_json raw_json".split()
        self.db.execute(
            f"INSERT OR REPLACE INTO movimentos ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            [d.get(c) or "" for c in cols])

    DEC_COLS = ("fonte doc_id categoria tipo_doc tipo_documento numero_processo "
                "numero_processo_raw relator origem orgao classe ementa "
                "data_julgamento url raw_json hash coletado_em").split()

    CHAVE_DEC = ("fonte", "categoria", "numero_processo_raw", "data_julgamento", "hash")

    def upsert_decisao(self, d):
        """Grava/atualiza a listagem SEM apagar inteiro_teor/doc_path já baixados
        (por isso o UPSERT explícito, e não INSERT OR REPLACE).

        O `doc_id` É atualizado a cada listagem de propósito: como o ROWID do portal
        muda, a fase 2 precisa sempre do mais recente para conseguir baixar.
        """
        d.setdefault("coletado_em", agora())
        d["hash"] = content_hash(d.get("ementa"))
        # NULL nunca colide com NULL num índice UNIQUE do SQLite: uma coluna da chave
        # vazia (data_julgamento costuma faltar em alguns itens) duplicaria a linha a
        # cada execução. Por isso toda coluna da chave vira '' em vez de NULL.
        for c in self.CHAVE_DEC:
            d[c] = d.get(c) or ""
        cols = self.DEC_COLS
        sets = ",".join(f"{c}=excluded.{c}" for c in cols if c not in self.CHAVE_DEC)
        self.db.execute(
            f"INSERT INTO decisoes ({','.join(cols)}) VALUES ({','.join('?' * len(cols))}) "
            f"ON CONFLICT({','.join(self.CHAVE_DEC)}) DO UPDATE SET {sets}",
            [d.get(c) for c in cols])

    def decisoes_sem_detalhe(self):
        """Decisões cuja fase 2 ainda não terminou, com o que já foi obtido.

        `tem_teor`/`tem_doc` deixam a retomada buscar só a parte que falta, em vez
        de refazer as duas (importante quando um dos endpoints está fora do ar).
        """
        return [dict(r) for r in self.db.execute(
            "SELECT id, doc_id, tipo_doc, numero_processo, numero_processo_raw, "
            "(inteiro_teor IS NOT NULL AND inteiro_teor!='') AS tem_teor, "
            "(doc_path IS NOT NULL AND doc_path!='') AS tem_doc "
            "FROM decisoes WHERE detalhe_em IS NULL AND doc_id IS NOT NULL AND doc_id!=''")]

    def atualizar_detalhe(self, id_decisao, inteiro_teor, doc_path,
                          nota=None, concluido=True):
        """Grava o resultado da fase 2, endereçando pela chave interna estável.

        `concluido=False` salva o que foi obtido mas NÃO marca `detalhe_em`, para o
        que faltou ser buscado depois — sem jogar fora o que já deu certo.
        `detalhe_em` é preenchido mesmo quando o portal não entrega o documento
        (ex.: segredo de justiça), senão esses itens seriam rebuscados para sempre.
        """
        self.db.execute(
            "UPDATE decisoes SET inteiro_teor=COALESCE(?, inteiro_teor), "
            "doc_path=COALESCE(?, doc_path), detalhe_nota=COALESCE(?, detalhe_nota), "
            "detalhe_em=CASE WHEN ?=1 THEN ? ELSE detalhe_em END WHERE id=?",
            (inteiro_teor or None, doc_path or None, nota,
             1 if concluido else 0, agora(), id_decisao))

    def upsert_consolidado(self, d):
        d["atualizado_em"] = agora()
        cols = ("numero_processo relator orgao_julgador classe assuntos_json "
                "data_ajuizamento data_julgamento ementa inteiro_teor "
                "doc_path grau qtd_decisoes fontes proveniencia_json atualizado_em").split()
        self.db.execute(
            f"INSERT OR REPLACE INTO consolidado ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            [d.get(c) for c in cols])

    def commit(self):
        self.db.commit()

    # ---- checkpoints (resume) ----

    def get_checkpoint(self, fonte):
        row = self.db.execute("SELECT cursor FROM checkpoints WHERE fonte=?", (fonte,)).fetchone()
        return json.loads(row["cursor"]) if row and row["cursor"] else None

    def set_checkpoint(self, fonte, cursor):
        self.db.execute("INSERT OR REPLACE INTO checkpoints VALUES (?,?,?)",
                        (fonte, json.dumps(cursor, ensure_ascii=False), agora()))
        self.db.commit()

    def clear_checkpoint(self, fonte):
        self.db.execute("DELETE FROM checkpoints WHERE fonte=?", (fonte,))
        self.db.commit()

    # ---- consultas usadas pelo merge/datajud ----

    def numeros_com_decisao(self):
        return [r[0] for r in self.db.execute(
            "SELECT DISTINCT numero_processo FROM decisoes "
            "WHERE numero_processo IS NOT NULL AND numero_processo != ''")]

    def numeros_com_processo(self):
        return {r[0] for r in self.db.execute("SELECT DISTINCT numero_processo FROM processos")}

    def pares_numero_grau(self):
        """(numero, grau) ja' guardados. E' o que decide o que ainda falta
        perguntar ao Datajud: um processo com so' o G1 salvo NAO esta' completo,
        e a versao antiga (so' o numero) o dava por coletado para sempre."""
        return {(r[0], r[1]) for r in
                self.db.execute("SELECT numero_processo, grau FROM processos")}

    def count(self, tabela):
        return self.db.execute(f"SELECT COUNT(*) FROM {tabela}").fetchone()[0]

    # ---- exports ----

    def export_all(self, export_dir):
        """Exporta cada tabela em .jsonl e .csv.

        Escreve em streaming: `movimentos` passa de meio milhão de linhas (com o
        raw_json de cada uma), e materializar tudo em memória estouraria a RAM.
        """
        export_dir = Path(export_dir)
        export_dir.mkdir(parents=True, exist_ok=True)
        for tabela in ("processos", "movimentos", "decisoes", "consolidado"):
            colunas = [r["name"] for r in self.db.execute(f"PRAGMA table_info({tabela})")]
            cur = self.db.execute(f"SELECT * FROM {tabela}")
            n = 0
            with open(export_dir / f"{tabela}.jsonl", "w", encoding="utf-8") as fj, \
                 open(export_dir / f"{tabela}.csv", "w", encoding="utf-8-sig", newline="") as fc:
                w = csv.DictWriter(fc, fieldnames=colunas)
                w.writeheader()
                for row in cur:
                    d = dict(row)
                    fj.write(json.dumps(d, ensure_ascii=False) + "\n")
                    w.writerow(d)
                    n += 1
            logging.info("Exportado %s: %s linhas", tabela, n)
        logging.info("Exportado jsonl+csv para %s", export_dir)


if __name__ == "__main__":
    import tempfile

    # G1 e G2 do mesmo processo sao dois registros distintos no Datajud e
    # precisam coexistir. Com a PK antiga (numero, fonte) o segundo apagava o
    # primeiro inteiro, raw_json incluido — e numeros_com_processo() passava a
    # considerar o processo coletado, entao nem recoletar trazia de volta.
    s = Storage(os.path.join(tempfile.mkdtemp(), "t.db"))
    for grau in ("G1", "G2"):
        s.upsert_processo({"numero_processo": "5001036832024824023",
                           "fonte": "datajud", "grau": grau,
                           "raw_json": '{"grau":"%s"}' % grau})
    s.commit()
    assert s.count("processos") == 2, "G1 e G2 colidiram na PK"
    assert s.pares_numero_grau() == {("5001036832024824023", "G1"),
                                     ("5001036832024824023", "G2")}

    # grau ausente vira '' e continua sendo UMA linha, nao uma nova a cada
    # execucao: NULL nunca colide com NULL num indice do SQLite (mesma
    # armadilha ja' documentada em CHAVE_DEC).
    for _ in range(2):
        s.upsert_processo({"numero_processo": "9", "fonte": "datajud",
                           "grau": None, "raw_json": "{}"})
    s.commit()
    assert s.count("processos") == 3, "grau NULL duplicou a linha"
    print("self-check OK — processos guarda G1 e G2 separados")


def setup_logging(log_dir, level="INFO"):
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    logfile = Path(log_dir) / f"coleta_{datetime.now():%Y%m%d_%H%M%S}.log"
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        handlers=[logging.FileHandler(logfile, encoding="utf-8"),
                  logging.StreamHandler(sys.stdout)])
    logging.info("Log em %s", logfile)
