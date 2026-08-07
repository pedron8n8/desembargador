"""Sobe tudo num terminal só, em primeiro plano.

    python -m api.servir              API + Vite (dev), log dos dois junto
    python -m api.servir --prod       constrói o frontend e serve tudo do uvicorn
    python -m api.servir --api        só a API
    python -m api.servir --porta 8080 --porta-web 5180

Ctrl+C derruba os dois. É o que o `web.bat` faz por baixo — ele só chama isto.

NÃO EXISTEM WORKERS SEPARADOS para subir. A consulta roda num
ThreadPoolExecutor(max_workers=2) dentro do processo do uvicorn (ver o docstring
de api/execucao.py: sem Celery e sem Redis de propósito, porque o gargalo é USD
por consulta e a durabilidade já está no rag_runs.db). Subir a API sobe os
workers junto; não há terceiro processo.
"""
import argparse
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import threading
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONT = os.path.join(RAIZ, "frontend")
DIST = os.path.join(FRONT, "dist")

# Prefixo por processo, para dar para ler os dois logs misturados. Cor só quando
# a saída é um terminal — redirecionado para arquivo, código ANSI vira lixo.
_COR = {"api": "\033[36m", "web": "\033[35m", "erro": "\033[31m"}


def _pinta(tag, texto):
    if not sys.stdout.isatty():
        return "[%s] %s" % (tag, texto)
    return "%s[%s]\033[0m %s" % (_COR.get(tag, ""), tag, texto)


def _bombear(fluxo, tag):
    """Repassa a saída do filho linha a linha, prefixada. Uma thread por fluxo."""
    for linha in iter(fluxo.readline, ""):
        print(_pinta(tag, linha.rstrip("\n")), flush=True)
    fluxo.close()


def _subir(cmd, tag, cwd=None, env=None):
    p = subprocess.Popen(
        cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1)
    threading.Thread(target=_bombear, args=(p.stdout, tag), daemon=True).start()
    return p


_parar = threading.Event()


def _pedir_parada(*_):
    _parar.set()


def _matar(p):
    """No Windows, npm.cmd vira node num processo filho: terminate() no npm
    deixa o node vivo segurando a porta 5173. taskkill /T mata a árvore."""
    if p.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"],
                       capture_output=True)
    else:
        p.terminate()
    try:
        p.wait(timeout=10)
    except subprocess.TimeoutExpired:
        p.kill()


# ------------------------------------------------------------------ preflight

def porta_ocupada(porta, host="127.0.0.1"):
    """True se alguem ja' esta' escutando ali."""
    import socket
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex((host, porta)) == 0


def _quem_esta_na_porta(porta):
    """A instrucao completa para matar o ocupante. Sem isto a pessoa recebe um
    'address already in use' do uvicorn e vai procurar no Google.

    O caso comum e' orfao nosso: Ctrl+C limpa, mas um `kill` de fora no Windows
    e' TerminateProcess — nao da' para interceptar, e o npm deixa o node vivo
    segurando a porta.
    """
    if os.name != "nt":
        return "    lsof -ti:%d | xargs kill -9" % porta
    return ("    netstat -ano | findstr :%d\n"
            "    taskkill /PID <pid> /T /F" % porta)


def conferir(prod=False, com_web=True, porta=None, porta_web=None):
    """Devolve lista de problemas. Vazia = pode subir.

    Existe separado de main() para poder ser testado sem subir processo nenhum
    (python -m api.servir --self-check).
    """
    faltando = []
    for p, nome in ((porta, "API"), (porta_web if com_web else None, "web")):
        if p and porta_ocupada(p):
            faltando.append("porta %d (%s) já está ocupada\n%s"
                            % (p, nome, _quem_esta_na_porta(p)))
    if not os.path.exists(os.path.join(RAIZ, ".venv", "Scripts", "python.exe")) \
            and not os.path.exists(os.path.join(RAIZ, ".venv", "bin", "python")):
        faltando.append(
            "ambiente virtual ausente em .venv/\n"
            "    python -m venv .venv && .venv\\Scripts\\pip install "
            "-r requirements.txt -r requirements-web.txt")
    try:
        import fastapi, uvicorn  # noqa: F401
    except ImportError:
        faltando.append("faltam fastapi/uvicorn\n"
                        "    .venv\\Scripts\\pip install -r requirements-web.txt")

    from . import esquema
    if not os.path.exists(esquema.WEB):
        faltando.append(_SEM_CONTA)
    else:
        try:
            n, = sqlite3.connect(esquema.WEB).execute(
                "SELECT count(*) FROM usuario WHERE ativo=1").fetchone()
            if not n:
                faltando.append(_SEM_CONTA)
        except sqlite3.Error:
            faltando.append(_SEM_CONTA)

    if prod:
        if not os.path.isfile(os.path.join(DIST, "index.html")):
            faltando.append("frontend não construído\n"
                            "    cd frontend && npm run build")
    elif com_web:
        if not os.path.isdir(os.path.join(FRONT, "node_modules")):
            faltando.append("dependências do frontend ausentes\n"
                            "    cd frontend && npm install")
        if not shutil.which("npm"):
            faltando.append("npm não está no PATH (instale o Node)")
    return faltando


_SEM_CONTA = (
    "nenhuma conta cadastrada — a API sobe, mas ninguém entra\n"
    "    .venv\\Scripts\\python -m api.usuarios --criar voce@escritorio.com "
    "--papel admin")


# ----------------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Sobe API e frontend num terminal só",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--prod", action="store_true",
                    help="constrói o frontend e serve tudo pelo uvicorn (uma porta)")
    ap.add_argument("--api", action="store_true", help="só a API, sem o Vite")
    ap.add_argument("--porta", type=int, default=8000)
    ap.add_argument("--porta-web", type=int, default=5173)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--sem-conferir", action="store_true",
                    help="pula o preflight (para CI, onde não há conta)")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)

    if a.self_check:
        return _self_check()

    com_web = not (a.api or a.prod)
    if not a.sem_conferir:
        problemas = conferir(prod=a.prod, com_web=com_web,
                             porta=a.porta, porta_web=a.porta_web)
        if problemas:
            print(_pinta("erro", "não dá para subir:"), file=sys.stderr)
            for p in problemas:
                print("  - %s" % p, file=sys.stderr)
            return 1

    env = dict(os.environ)
    # Sem TLS o cookie Secure é descartado pelo navegador e o login não gruda.
    # Em --prod não mexemos: lá presume-se HTTPS na frente.
    if not a.prod:
        env.setdefault("WEB_DEV", "1")

    if a.prod and not os.path.isfile(os.path.join(DIST, "index.html")):
        return 1  # o preflight já explicou

    procs = []
    # --reload NÃO: no Windows ele mata as threads de consulta em voo, e
    # consulta em voo é dinheiro já gasto.
    procs.append(("api", _subir(
        [sys.executable, "-X", "utf8", "-m", "uvicorn", "api.app:app",
         "--host", a.host, "--port", str(a.porta)], "api", cwd=RAIZ, env=env)))
    if com_web:
        # o proxy do Vite lê estas duas: sem elas ele fica preso na 8000 e
        # trocar a porta da API derruba o dev com ECONNREFUSED
        env["API_PORT"] = str(a.porta)
        env["WEB_PORT"] = str(a.porta_web)
        procs.append(("web", _subir([shutil.which("npm"), "run", "dev"],
                                    "web", cwd=FRONT, env=env)))

    print(_pinta("api", "http://%s:%d" % (a.host, a.porta)), flush=True)
    if com_web:
        print(_pinta("web", "http://localhost:%d  <- abra esta" % a.porta_web),
              flush=True)
    else:
        print(_pinta("api", "servindo o frontend na mesma porta"), flush=True)
    print(_pinta("api", "Ctrl+C para parar"), flush=True)

    # SIGTERM (kill de fora, stop de um supervisor) tambem tem de passar pelo
    # finally: sem isto o npm morre e deixa o node orfao segurando a 5173, e a
    # proxima subida falha com "port already in use" sem dizer por que.
    signal.signal(signal.SIGTERM, _pedir_parada)

    # No Windows o Ctrl+C do console vai para todos os processos que dividem o
    # console; ainda assim matamos explicitamente, porque o npm deixa o node
    # órfão segurando a porta.
    codigo = 0
    try:
        while not _parar.is_set():
            for nome, p in procs:
                r = p.poll()
                if r is not None:
                    print(_pinta("erro", "%s morreu (código %s) — derrubando o resto"
                                 % (nome, r)), file=sys.stderr, flush=True)
                    codigo = r or 1
                    _parar.set()
            time.sleep(0.4)
    except KeyboardInterrupt:
        pass
    finally:
        print(_pinta("api", "parando..."), flush=True)
        for _nome, p in reversed(procs):
            _matar(p)
    return codigo


def _self_check():
    """Offline: o preflight acusa o que falta, sem subir processo nenhum."""
    import tempfile

    from . import esquema
    real = esquema.WEB
    try:
        esquema.WEB = os.path.join(tempfile.mkdtemp(), "vazio.db")
        problemas = conferir(prod=False, com_web=False)
        assert any("conta cadastrada" in p for p in problemas), problemas
        # e o recado tem de trazer o comando, não só o diagnóstico
        assert "api.usuarios --criar" in "\n".join(problemas)

        # banco existe mas sem usuário ativo: mesmo problema
        esquema.db().close()
        problemas = conferir(prod=False, com_web=False)
        assert any("conta cadastrada" in p for p in problemas), problemas

        # --prod sem dist construído tem de reclamar
        antes = DIST
        try:
            globals()["DIST"] = os.path.join(tempfile.mkdtemp(), "nao-existe")
            assert any("não construído" in p for p in conferir(prod=True))
        finally:
            globals()["DIST"] = antes
    finally:
        esquema.WEB = real

    # o prefixo some quando a saída não é terminal (senão vira lixo no arquivo)
    assert _pinta("api", "x") in ("[api] x", "\033[36m[api]\033[0m x")

    # --- porta ocupada tem de virar instrução, não "address already in use"
    import socket
    assert not porta_ocupada(1), "porta 1 não devia ter ninguém"
    with socket.socket() as srv:
        srv.bind(("127.0.0.1", 0))
        # backlog folgado: o teste sonda a mesma porta várias vezes sem nunca
        # dar accept(), e com listen(1) a segunda sondagem estoura o timeout e
        # o teste acusa "porta livre" quando ela não está
        srv.listen(16)
        ocupada = srv.getsockname()[1]
        assert porta_ocupada(ocupada)
        p = conferir(com_web=False, porta=ocupada)
        assert any("já está ocupada" in x for x in p), p
        assert any(("taskkill" if os.name == "nt" else "kill -9") in x for x in p), p
        # e a porta da web só é conferida quando a web vai subir
        assert not any("(web)" in x for x in
                       conferir(com_web=False, porta_web=ocupada))
        assert any("(web)" in x for x in
                   conferir(com_web=True, porta_web=ocupada))

    print("self-check OK — preflight acusa o que falta e diz como resolver")
    return 0


if __name__ == "__main__":
    sys.exit(main())
