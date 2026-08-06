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
  papel TEXT DEFAULT 'advogado',         -- 'advogado' | 'admin'
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


def db(caminho=None):
    caminho = caminho or WEB
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    c = sqlite3.connect(caminho, timeout=30, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.executescript(DDL)
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
    import tempfile

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
    print("self-check OK — esquema cria, e' idempotente e preserva dado")
    print("banco de verdade:", WEB, "(existe)" if os.path.exists(WEB) else "(ainda nao)")
