"""output/web.db — o que so' a camada web precisa saber.

Banco SEPARADO de proposito. O feedback.db e' escrito pela CLI tambem e nao tem
coluna de dono; acrescentar uma la' obrigaria a migrar dados que ja' existem e
quebraria o qualificar.bat. Aqui as tabelas sao aditivas: `dono` amarra thread a
usuario sem que o feedback.db saiba que existe usuario.

    python -m api.esquema        # cria/atualiza e imprime o que ha' dentro
"""
import os
import sqlite3

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(RAIZ, "output", "web.db")

DDL = """
CREATE TABLE IF NOT EXISTS usuario (
  email TEXT PRIMARY KEY, senha_hash BLOB, salt BLOB,
  -- 'advogado' | 'admin' | 'superadmin'. O superadmin e' quem manda nos
  -- CEREBROS (ativar/desativar quem pode julgar); o admin manda nas contas do
  -- escritorio. Sao poderes diferentes de proposito.
  papel TEXT DEFAULT 'advogado',
  criado_em TEXT, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS sessao (
  token_hash TEXT PRIMARY KEY,           -- sha256 do token; o token NUNCA e' salvo
  email TEXT, criado_em TEXT, expira_em TEXT, ip TEXT, agente TEXT);
CREATE INDEX IF NOT EXISTS ix_sessao_email ON sessao(email);

CREATE TABLE IF NOT EXISTS tentativa (email TEXT, ip TEXT, quando TEXT);
CREATE INDEX IF NOT EXISTS ix_tentativa ON tentativa(email, quando);

-- Confidencialidade sem migrar o feedback.db: thread sem dono e' de quem rodou
-- pela CLI, e so' o admin ve.
CREATE TABLE IF NOT EXISTS dono (thread TEXT PRIMARY KEY, email TEXT);

CREATE TABLE IF NOT EXISTS execucao (
  thread TEXT PRIMARY KEY, email TEXT,
  estado TEXT,                           -- fila|rodando|pronto|interrompido|erro
  criado_em TEXT, terminado_em TEXT, erro TEXT, segundos REAL,
  so_prognostico INTEGER DEFAULT 0);
-- `cerebro` e `comparacao` entram por ALTER em _migrar(), e nao aqui: quem ja'
-- tem web.db nao recria a tabela.
--   cerebro    TEXT  quem julgou este caso (slug do cerebros.json)
--   comparacao TEXT  id do grupo, quando a mesma peca roda em varios cerebros;
--                    NULL em consulta solta. Escrito no INSERT de cada execucao,
--                    entao o grupo nasce consistente mesmo se o processo morrer
--                    entre uma e outra.
-- (o indice de `comparacao` tambem vive em _migrar: aqui a coluna ainda nao
--  existe e o CREATE INDEX falharia)

CREATE TABLE IF NOT EXISTS evento (
  thread TEXT, seq INTEGER, tipo TEXT, payload_json TEXT, criado_em TEXT,
  PRIMARY KEY (thread, seq));

CREATE TABLE IF NOT EXISTS mensagem (
  id INTEGER PRIMARY KEY AUTOINCREMENT, thread TEXT,
  papel TEXT,                            -- 'usuario' | 'assistente'
  texto TEXT, modelo TEXT, custo_usd REAL, criado_em TEXT);
CREATE INDEX IF NOT EXISTS ix_msg_thread ON mensagem(thread, id);

-- Denormalizado no fim de cada run: o livro-caixa nao pode depender de abrir
-- 50 checkpoints do LangGraph para somar dinheiro.
CREATE TABLE IF NOT EXISTS custo (
  thread TEXT, no TEXT, modelo TEXT, tokens_in INTEGER, tokens_out INTEGER,
  custo_usd REAL, quando TEXT);
CREATE INDEX IF NOT EXISTS ix_custo_thread ON custo(thread);
"""


def _coluna(c, tabela, nome, ddl):
    """ALTER TABLE ADD COLUMN idempotente.

    No SQLite e' O(1) — nao reescreve linha nenhuma — e a coluna nasce NULL.
    E' o unico jeito de evoluir um esquema feito so' de CREATE TABLE IF NOT
    EXISTS sem pedir ao usuario que apague o banco.
    """
    if nome not in {r[1] for r in c.execute("PRAGMA table_info(%s)" % tabela)}:
        c.execute("ALTER TABLE %s ADD COLUMN %s" % (tabela, ddl))
        return True
    return False


def _migrar(c):
    """De mono-cerebro para multi. Roda dentro de db(), a cada conexao: assim a
    migracao nao depende de ninguem lembrar de um passo manual.

    Toda execucao anterior a esta fase e' do cerebro legado por definicao — era
    o unico acervo que existia.
    """
    from src import cerebros

    feito = []
    if _coluna(c, "execucao", "cerebro", "cerebro TEXT"):
        c.execute("UPDATE execucao SET cerebro=? WHERE cerebro IS NULL",
                  (cerebros.CEREBRO_LEGADO,))
        feito.append("execucao.cerebro (+backfill '%s')" % cerebros.CEREBRO_LEGADO)
    if _coluna(c, "execucao", "comparacao", "comparacao TEXT"):
        feito.append("execucao.comparacao")
    c.execute("CREATE INDEX IF NOT EXISTS ix_exec_comparacao ON execucao(comparacao)")
    return feito


def db(caminho=None):
    caminho = caminho or WEB
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    c = sqlite3.connect(caminho, timeout=30, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.executescript(DDL)
    with c:
        _migrar(c)
    return c


def wal(*bancos):
    """WAL nos bancos que a web e a CLI dividem. E' persistente: roda uma vez e
    fica gravado no arquivo. Sem isso, dois workers escrevendo no rag_runs.db
    dao 'database is locked'."""
    ligados = []
    for b in bancos:
        if not os.path.exists(b):
            continue
        c = sqlite3.connect(b, timeout=30)
        try:
            modo = c.execute("PRAGMA journal_mode=WAL").fetchone()[0]
            ligados.append((os.path.basename(b), modo))
        finally:
            c.close()
    return ligados


if __name__ == "__main__":
    import sys
    import tempfile

    if "--migrar" in sys.argv:
        # roda de proposito, com o servidor parado, para ver o que mudou antes
        # de subir. db() ja' migra sozinho — isto so' torna o passo visivel.
        existia = os.path.exists(WEB)
        c = db()
        feito = _migrar(c)          # 2a passada: tem de ser no-op
        c.close()
        print("web.db: %s" % (WEB if existia else WEB + "  (criado agora)"))
        print("  " + ("nada a migrar (já estava em dia)" if not feito
                      else "\n  ".join(feito)))
        from src.rag import feedback
        fc = feedback.db()
        print("feedback.db: %s" % feedback.FB)
        print("  " + ("nada a migrar (já estava em dia)"
                      if not feedback._migrar(fc) else "colunas de cérebro criadas"))
        fc.close()
        raise SystemExit(0)

    tmp = os.path.join(tempfile.mkdtemp(), "web.db")
    c = db(tmp)
    tabelas = {r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"usuario", "sessao", "tentativa", "dono", "execucao", "evento",
            "mensagem", "custo"} <= tabelas, tabelas
    # idempotente: rodar de novo nao pode explodir nem perder dado
    c.execute("INSERT INTO dono VALUES ('t1','a@b.c')")
    c.commit()
    c.close()
    c = db(tmp)
    assert c.execute("SELECT email FROM dono WHERE thread='t1'").fetchone()[0] == "a@b.c"
    c.close()

    # --- A MIGRACAO, contra um banco do esquema ANTIGO. Sem este teste a
    # migracao e' codigo que nunca roda: o web.db de desenvolvimento ja' nasce
    # com as colunas novas e o caminho do ALTER nunca seria exercitado.
    from src import cerebros

    velho = os.path.join(tempfile.mkdtemp(), "web.db")
    v = sqlite3.connect(velho)
    v.executescript(DDL)
    # a tabela antiga tinha 8 colunas, e o INSERT era posicional
    v.execute("INSERT INTO execucao VALUES ('t9','a@b.c','pronto','2026-01-01',"
              "NULL,NULL,12.5,0)")
    v.commit()
    v.close()

    c = db(velho)
    cols = {r[1] for r in c.execute("PRAGMA table_info(execucao)")}
    assert {"cerebro", "comparacao"} <= cols, cols
    r = c.execute("SELECT cerebro, comparacao, segundos FROM execucao "
                  "WHERE thread='t9'").fetchone()
    assert r["cerebro"] == cerebros.CEREBRO_LEGADO, r["cerebro"]
    assert r["comparacao"] is None
    assert r["segundos"] == 12.5, "a migração mexeu numa coluna que não era dela"
    # 2a passada: sem coluna nova, sem reescrever o backfill
    c.execute("UPDATE execucao SET cerebro='outro' WHERE thread='t9'")
    c.commit()
    assert _migrar(c) == [], "a migração não é idempotente"
    assert c.execute("SELECT cerebro FROM execucao WHERE thread='t9'"
                     ).fetchone()[0] == "outro", "rodou o backfill de novo"
    c.close()

    print("self-check OK — esquema cria, migra de um web.db antigo sem perder "
          "dado, e é idempotente")
    print("banco de verdade:", WEB, "(existe)" if os.path.exists(WEB) else "(ainda nao)")
