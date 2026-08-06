"""Autenticacao — stdlib inteira, nenhuma dependencia nova.

Sessao opaca no servidor, nao JWT. A diferenca importa aqui: as consultas sao
confidenciais, entao "derrubar todas as sessoes deste usuario agora" e' requisito
real, e com JWT isso vira lista de revogacao — que e' o banco de sessao de volta,
so' que pior.

O token vive so' no cookie do cliente. No banco fica o sha256 dele: vazar uma
copia do web.db nao da' a ninguem uma sessao valida.

    python -m api.auth       # self-check contra banco temporario
"""
import datetime as dt
import hashlib
import hmac
import os
import secrets

from .esquema import db

VALIDADE_DIAS = 14
MAX_TENTATIVAS = 5
JANELA_MIN = 15

# scrypt com os parametros que a propria RFC 7914 chama de interativos.
# n=2**14, r=8, p=1 custa ~100ms e 16 MB por verificacao — caro o bastante para
# forca bruta, barato o bastante para um login.
_N, _R, _P, _DKLEN = 2 ** 14, 8, 1, 32


def _agora():
    return dt.datetime.now(dt.timezone.utc)


def _iso(t):
    return t.isoformat(timespec="seconds")


def derivar(senha, salt):
    return hashlib.scrypt(senha.encode("utf-8"), salt=salt,
                          n=_N, r=_R, p=_P, dklen=_DKLEN)


def criar_usuario(conn, email, senha, papel="advogado"):
    email = email.strip().lower()
    if len(senha) < 10:
        raise ValueError("senha curta demais: mínimo 10 caracteres")
    salt = os.urandom(16)
    with conn:
        conn.execute("INSERT OR REPLACE INTO usuario VALUES (?,?,?,?,?,1)",
                     (email, derivar(senha, salt), salt, papel, _iso(_agora())))
    return email


def trocar_senha(conn, email, senha):
    salt = os.urandom(16)
    with conn:
        n = conn.execute("UPDATE usuario SET senha_hash=?, salt=? WHERE email=?",
                         (derivar(senha, salt), salt, email.strip().lower())).rowcount
    return n > 0


def bloqueado(conn, email, ip):
    """Rate limit por email E por IP: quem erra a senha de um usuario nao trava
    a conta dele para o mundo, mas tambem nao varre a lista de outro IP."""
    corte = _iso(_agora() - dt.timedelta(minutes=JANELA_MIN))
    n = conn.execute("SELECT count(*) FROM tentativa WHERE quando > ? "
                     "AND (email = ? OR ip = ?)",
                     (corte, email.strip().lower(), ip or "")).fetchone()[0]
    return n >= MAX_TENTATIVAS


def _registrar_tentativa(conn, email, ip):
    with conn:
        conn.execute("INSERT INTO tentativa VALUES (?,?,?)",
                     (email.strip().lower(), ip or "", _iso(_agora())))
        # limpeza oportunista: a tabela nao precisa guardar historico
        conn.execute("DELETE FROM tentativa WHERE quando < ?",
                     (_iso(_agora() - dt.timedelta(days=1)),))


def verificar_senha(conn, email, senha, ip=None):
    """Devolve a linha do usuario, ou None. Registra a falha para o rate limit."""
    email = (email or "").strip().lower()
    u = conn.execute("SELECT * FROM usuario WHERE email=? AND ativo=1",
                     (email,)).fetchone()
    if u is None:
        # gasta o mesmo tempo de um usuario que existe: senao o tempo de resposta
        # diz quais emails estao cadastrados
        derivar(senha or "", b"0" * 16)
        _registrar_tentativa(conn, email, ip)
        return None
    if not hmac.compare_digest(derivar(senha or "", u["salt"]), u["senha_hash"]):
        _registrar_tentativa(conn, email, ip)
        return None
    return u


def abrir_sessao(conn, email, ip=None, agente=None):
    """Devolve o token em claro — e' a unica vez que ele existe do lado do servidor."""
    token = secrets.token_urlsafe(32)
    with conn:
        conn.execute("INSERT INTO sessao VALUES (?,?,?,?,?,?)",
                     (hashlib.sha256(token.encode()).hexdigest(), email,
                      _iso(_agora()),
                      _iso(_agora() + dt.timedelta(days=VALIDADE_DIAS)),
                      ip or "", (agente or "")[:200]))
    return token


def usuario_da_sessao(conn, token):
    if not token:
        return None
    linha = conn.execute(
        "SELECT u.* FROM sessao s JOIN usuario u ON u.email = s.email "
        "WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1",
        (hashlib.sha256(token.encode()).hexdigest(), _iso(_agora()))).fetchone()
    return linha


def fechar_sessao(conn, token):
    with conn:
        conn.execute("DELETE FROM sessao WHERE token_hash=?",
                     (hashlib.sha256(token.encode()).hexdigest(),))


def sessoes(conn, email):
    return conn.execute(
        "SELECT token_hash, criado_em, expira_em, ip, agente FROM sessao "
        "WHERE email=? AND expira_em > ? ORDER BY criado_em DESC",
        (email, _iso(_agora()))).fetchall()


def limpar_expiradas(conn):
    with conn:
        return conn.execute("DELETE FROM sessao WHERE expira_em <= ?",
                            (_iso(_agora()),)).rowcount


if __name__ == "__main__":
    import tempfile

    conn = db(os.path.join(tempfile.mkdtemp(), "web.db"))

    # --- ida e volta da senha
    criar_usuario(conn, "Advogado@Escritorio.com", "senha-longa-o-bastante")
    assert verificar_senha(conn, "advogado@escritorio.com", "senha-longa-o-bastante")
    assert verificar_senha(conn, "ADVOGADO@escritorio.com", "senha-longa-o-bastante"), \
        "email tem que ser case-insensitive"
    assert verificar_senha(conn, "advogado@escritorio.com", "errada") is None
    assert verificar_senha(conn, "ninguem@lugar.nenhum", "x") is None

    # o hash nunca e' a senha, e dois usuarios com a MESMA senha nao colidem
    u = conn.execute("SELECT * FROM usuario").fetchone()
    assert b"senha-longa" not in u["senha_hash"] and len(u["salt"]) == 16
    criar_usuario(conn, "outro@escritorio.com", "senha-longa-o-bastante")
    v = conn.execute("SELECT * FROM usuario WHERE email='outro@escritorio.com'").fetchone()
    assert u["senha_hash"] != v["senha_hash"], "salt nao esta' variando"

    try:
        criar_usuario(conn, "curta@x.com", "123")
        raise AssertionError("aceitou senha curta")
    except ValueError:
        pass

    # --- sessao: o token em claro nao pode estar no banco
    t = abrir_sessao(conn, "advogado@escritorio.com", ip="127.0.0.1")
    assert usuario_da_sessao(conn, t)["email"] == "advogado@escritorio.com"
    assert conn.execute("SELECT count(*) FROM sessao WHERE token_hash=?",
                        (t,)).fetchone()[0] == 0, "o token cru foi salvo!"
    assert usuario_da_sessao(conn, "token-inventado") is None
    assert usuario_da_sessao(conn, None) is None

    # expirada nao autentica, e a limpeza a remove
    conn.execute("UPDATE sessao SET expira_em=? WHERE token_hash=?",
                 (_iso(_agora() - dt.timedelta(seconds=1)),
                  hashlib.sha256(t.encode()).hexdigest()))
    conn.commit()
    assert usuario_da_sessao(conn, t) is None, "sessao expirada autenticou"
    assert limpar_expiradas(conn) == 1

    # desativar o usuario derruba a sessao viva na hora — e' o ponto de nao usar JWT
    t2 = abrir_sessao(conn, "advogado@escritorio.com")
    assert usuario_da_sessao(conn, t2)
    conn.execute("UPDATE usuario SET ativo=0 WHERE email='advogado@escritorio.com'")
    conn.commit()
    assert usuario_da_sessao(conn, t2) is None
    conn.execute("UPDATE usuario SET ativo=1 WHERE email='advogado@escritorio.com'")
    conn.commit()
    fechar_sessao(conn, t2)
    assert usuario_da_sessao(conn, t2) is None

    # --- troca de senha invalida a antiga
    assert trocar_senha(conn, "advogado@escritorio.com", "outra-senha-longa")
    assert verificar_senha(conn, "advogado@escritorio.com", "senha-longa-o-bastante") is None
    assert verificar_senha(conn, "advogado@escritorio.com", "outra-senha-longa")

    # --- rate limit
    conn.execute("DELETE FROM tentativa")
    conn.commit()
    alvo = "alvo@escritorio.com"
    criar_usuario(conn, alvo, "senha-longa-o-bastante")
    assert not bloqueado(conn, alvo, "9.9.9.9")
    for _ in range(MAX_TENTATIVAS):
        verificar_senha(conn, alvo, "chute", ip="9.9.9.9")
    assert bloqueado(conn, alvo, "9.9.9.9")
    # ... e a senha certa continua funcionando: quem barra e' a rota, nao a
    # verificacao. Misturar os dois faz o bloqueio virar negacao de servico.
    assert verificar_senha(conn, alvo, "senha-longa-o-bastante")
    # tentativa velha nao conta
    conn.execute("UPDATE tentativa SET quando=?",
                 (_iso(_agora() - dt.timedelta(minutes=JANELA_MIN + 1)),))
    conn.commit()
    assert not bloqueado(conn, alvo, "9.9.9.9")

    conn.close()
    print("self-check OK — scrypt, sessão opaca, expiração, revogação e rate limit")
