"""A apresentacao comercial — rota publica com senha unica compartilhada.

O resto do sistema exige conta. Esta rota nao: o link vai para quem esta' sendo
apresentado ao produto, e essa pessoa nao tem cadastro. Dai a senha unica, no
.env, e uma sessao PROPRIA — o cookie daqui nao abre nenhuma rota do sistema, e
o cookie do sistema nao e' exigido aqui.

    APRESENTACAO_SENHA=...      no .env; sem ela a rota devolve 503 e diz por que

Revogar todos os acessos: DELETE FROM sessao_apresentacao. Trocar a senha:
mudar o .env e reiniciar. Sao operacoes de um comando de proposito — o publico
desta rota e' pequeno e conhecido.

    python -m api.apresentacao      # self-check contra banco temporario
"""
import datetime as dt
import hashlib
import hmac
import json
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from . import auth
from .esquema import db

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DADOS = os.path.join(RAIZ, "apresentacao", "dados")

COOKIE = "apresentacao"
VALIDADE_DIAS = 7          # menor que a do sistema: e' acesso de demonstracao
# identificador fixo no rate limit que ja' existe: quem erra a senha da
# apresentacao nao trava a conta de ninguem, mas tambem nao varre a senha a' toa
IDENT = "\x00apresentacao"

router = APIRouter(prefix="/api/apresentacao", tags=["apresentacao"])


def _agora():
    return dt.datetime.now(dt.timezone.utc)


def _iso(t):
    return t.isoformat(timespec="seconds")


def senha_configurada():
    """A senha vem do .env. Quem carrega o .env para o os.environ e' o
    src.rag.llm.config() — o mesmo leitor que traz a OPENROUTER_API_KEY. E'
    idempotente e cacheado; chamar aqui evita um segundo parser de .env no
    projeto, que sairia do sincronismo com o primeiro no dia em que um deles
    mudasse."""
    try:
        from src.rag.llm import config
        config()
    except Exception:
        pass  # sem config_rag.json ainda dá para ler o ambiente direto
    return (os.environ.get("APRESENTACAO_SENHA") or "").strip()


def conferir(senha):
    """Compara em tempo constante. Sem senha no ambiente, ninguem entra."""
    esperada = senha_configurada()
    if not esperada:
        return False
    return hmac.compare_digest((senha or "").encode("utf-8"),
                               esperada.encode("utf-8"))


def abrir(conn, ip=None, agente=None):
    token = secrets.token_urlsafe(32)
    with conn:
        conn.execute(
            "INSERT INTO sessao_apresentacao "
            "(token_hash, criado_em, expira_em, ip, agente) VALUES (?,?,?,?,?)",
            (hashlib.sha256(token.encode()).hexdigest(), _iso(_agora()),
             _iso(_agora() + dt.timedelta(days=VALIDADE_DIAS)),
             ip or "", (agente or "")[:200]))
    return token


def valida(conn, token):
    if not token:
        return False
    linha = conn.execute(
        "SELECT 1 FROM sessao_apresentacao WHERE token_hash = ? AND expira_em > ?",
        (hashlib.sha256(token.encode()).hexdigest(), _iso(_agora()))).fetchone()
    return linha is not None


def fechar(conn, token):
    with conn:
        conn.execute("DELETE FROM sessao_apresentacao WHERE token_hash = ?",
                     (hashlib.sha256(token.encode()).hexdigest(),))


# ----------------------------------------------------------------- rotas

def _conexao():
    c = db()
    try:
        yield c
    finally:
        c.close()


def visitante(request: Request, c=Depends(_conexao)):
    """Depende so' do cookie DESTA rota. Nao aceita sessao de usuario: manter os
    dois mundos separados e' o ponto."""
    if not valida(c, request.cookies.get(COOKIE)):
        raise HTTPException(401, "apresentação protegida por senha")
    return True


@router.get("/estado")
def estado(request: Request, c=Depends(_conexao)):
    """O que a tela precisa saber ANTES de pedir senha. Nao vaza a senha nem diz
    se ela esta' certa — so' se a rota esta' habilitada e se ja' ha' sessao."""
    return {"habilitada": bool(senha_configurada()),
            "autenticado": valida(c, request.cookies.get(COOKIE))}


@router.post("/sessao", status_code=204)
async def entrar(request: Request, c=Depends(_conexao)):
    if not senha_configurada():
        raise HTTPException(
            503, "apresentação desabilitada: defina APRESENTACAO_SENHA no .env")
    ip = request.client.host if request.client else ""
    if auth.bloqueado(c, IDENT, ip):
        raise HTTPException(429, "muitas tentativas — espere alguns minutos")
    corpo = await request.json()
    if not conferir(corpo.get("senha")):
        auth._registrar_tentativa(c, IDENT, ip)
        raise HTTPException(401, "senha incorreta")
    token = abrir(c, ip=ip, agente=request.headers.get("user-agent"))
    r = Response(status_code=204)
    r.set_cookie(COOKIE, token, httponly=True, samesite="lax",
                 secure=os.environ.get("WEB_DEV") != "1",
                 max_age=VALIDADE_DIAS * 86400, path="/")
    return r


@router.delete("/sessao", status_code=204)
def sair(request: Request, c=Depends(_conexao)):
    fechar(c, request.cookies.get(COOKIE) or "")
    r = Response(status_code=204)
    r.delete_cookie(COOKIE, path="/")
    return r


@router.get("/dados")
def dados(_v=Depends(visitante)):
    """Os tres JSON que a apresentacao consome, gerados por apresentacao/montar.py."""
    saida = {}
    for nome in ("apresentacao", "grafo", "confronto"):
        caminho = os.path.join(DADOS, "%s.json" % nome)
        if not os.path.isfile(caminho):
            raise HTTPException(
                503, "dados da apresentação ausentes — rode: "
                     "python -m apresentacao.montar")
        with open(caminho, encoding="utf-8") as f:
            saida[nome] = json.load(f)
    return saida


# ------------------------------------------------------------- self-check

if __name__ == "__main__":
    import tempfile

    from . import esquema

    real = esquema.WEB
    esquema.WEB = os.path.join(tempfile.mkdtemp(), "web.db")
    conn = esquema.db()
    try:
        # --- sem senha no ambiente, ninguem entra.
        # A chamada abaixo e' o que faz o .env ser lido (config() e' cacheado);
        # so' DEPOIS dela adianta remover a variavel, senao o proprio leitor a
        # repoe no meio do teste.
        senha_configurada()
        os.environ.pop("APRESENTACAO_SENHA", None)
        assert not senha_configurada()
        assert not conferir("qualquer coisa")
        assert not conferir("")

        os.environ["APRESENTACAO_SENHA"] = "uma-senha-de-demonstracao"
        assert conferir("uma-senha-de-demonstracao")
        assert not conferir("uma-senha-de-demonstracaoX")
        assert not conferir("")
        assert not conferir(None)

        # --- o token cru nao pode ficar no banco
        t = abrir(conn, ip="127.0.0.1")
        assert valida(conn, t)
        assert conn.execute("SELECT count(*) FROM sessao_apresentacao "
                            "WHERE token_hash = ?", (t,)).fetchone()[0] == 0, \
            "o token cru foi salvo!"
        assert not valida(conn, "token-inventado")
        assert not valida(conn, None) and not valida(conn, "")

        # --- expirada nao vale
        conn.execute("UPDATE sessao_apresentacao SET expira_em = ?",
                     (_iso(_agora() - dt.timedelta(seconds=1)),))
        conn.commit()
        assert not valida(conn, t), "sessão expirada autenticou"

        # --- revogar todos e' um DELETE, e nao toca na sessao do sistema
        auth.criar_usuario(conn, "advogado@escritorio.com", "senha-longa-o-bastante")
        do_sistema = auth.abrir_sessao(conn, "advogado@escritorio.com")
        t2 = abrir(conn)
        conn.execute("DELETE FROM sessao_apresentacao")
        conn.commit()
        assert not valida(conn, t2)
        assert auth.usuario_da_sessao(conn, do_sistema), \
            "derrubar a apresentação derrubou o sistema junto"

        # --- e o inverso: cookie de apresentacao nao e' sessao de usuario
        t3 = abrir(conn)
        assert auth.usuario_da_sessao(conn, t3) is None, \
            "um cookie de apresentação autenticou como usuário!"
        fechar(conn, t3)
        assert not valida(conn, t3)

        # --- rate limit: o identificador da apresentacao nao trava ninguem
        conn.execute("DELETE FROM tentativa")
        conn.commit()
        assert not auth.bloqueado(conn, IDENT, "9.9.9.9")
        for _ in range(auth.MAX_TENTATIVAS):
            auth._registrar_tentativa(conn, IDENT, "9.9.9.9")
        assert auth.bloqueado(conn, IDENT, "9.9.9.9")
        assert not auth.bloqueado(conn, "advogado@escritorio.com", "1.1.1.1"), \
            "errar a senha da apresentação travou a conta de um usuário"
    finally:
        conn.close()
        esquema.WEB = real

    print("self-check OK — senha em tempo constante, sessão opaca e separada, "
          "revogação por DELETE, rate limit isolado")
