"""Contas — só por linha de comando. Não há auto-cadastro nesta interface.

    python -m api.usuarios --criar advogado@escritorio.com
    python -m api.usuarios --criar chefe@escritorio.com --papel admin
    python -m api.usuarios --promover chefe@escritorio.com --papel superadmin
    python -m api.usuarios --senha advogado@escritorio.com
    python -m api.usuarios --desativar advogado@escritorio.com
    python -m api.usuarios --listar

Papéis: 'advogado' usa; 'admin' vê as consultas de todos e cria contas;
'superadmin' faz tudo isso e ainda decide QUAIS CÉREBROS ficam disponíveis para
julgar (ver cerebros.json). São poderes separados de propósito: administrar o
escritório não é a mesma coisa que escolher de quem o escritório tem um segundo
cérebro.
"""
import argparse
import getpass
import sys

from . import auth
from .esquema import db


def _pedir_senha():
    a = getpass.getpass("senha (mínimo 10 caracteres): ")
    b = getpass.getpass("repita: ")
    if a != b:
        print("as senhas não conferem.", file=sys.stderr)
        raise SystemExit(2)
    return a


def main(argv=None):
    ap = argparse.ArgumentParser(description="Contas da interface web")
    ap.add_argument("--criar", metavar="EMAIL")
    ap.add_argument("--senha", metavar="EMAIL", help="troca a senha")
    ap.add_argument("--desativar", metavar="EMAIL")
    ap.add_argument("--papel", default="advogado",
                    choices=("advogado", "admin", "superadmin"),
                    help="advogado: usa. admin: vê tudo e cria contas. "
                         "superadmin: além disso, decide quais cérebros "
                         "(desembargadores) ficam disponíveis para julgar.")
    ap.add_argument("--promover", metavar="EMAIL",
                    help="troca o papel de uma conta existente (use com --papel)")
    ap.add_argument("--listar", action="store_true")
    a = ap.parse_args(argv)

    c = db()
    try:
        if a.criar:
            if c.execute("SELECT 1 FROM usuario WHERE email=?",
                         (a.criar.lower(),)).fetchone():
                print("já existe: %s (use --senha para trocar a senha)" % a.criar,
                      file=sys.stderr)
                return 2
            try:
                email = auth.criar_usuario(c, a.criar, _pedir_senha(), papel=a.papel)
            except ValueError as e:
                print(e, file=sys.stderr)
                return 2
            print("criado: %s (%s)" % (email, a.papel))
        elif a.promover:
            alvo = a.promover.lower()
            with c:
                n = c.execute("UPDATE usuario SET papel=? WHERE email=?",
                              (a.papel, alvo)).rowcount
            if not n:
                print("não existe: %s" % a.promover, file=sys.stderr)
                return 2
            print("%s agora é %s" % (alvo, a.papel))
        elif a.senha:
            if not auth.trocar_senha(c, a.senha, _pedir_senha()):
                print("não existe: %s" % a.senha, file=sys.stderr)
                return 2
            # trocar a senha nao derruba as sessoes por si so'; aqui derruba,
            # que e' o que a pessoa espera de "troquei minha senha"
            with c:
                c.execute("DELETE FROM sessao WHERE email=?", (a.senha.lower(),))
            print("senha trocada e sessões encerradas: %s" % a.senha)
        elif a.desativar:
            with c:
                n = c.execute("UPDATE usuario SET ativo=0 WHERE email=?",
                              (a.desativar.lower(),)).rowcount
                c.execute("DELETE FROM sessao WHERE email=?", (a.desativar.lower(),))
            print("desativado: %s" % a.desativar if n else "não existe",
                  file=sys.stderr if not n else sys.stdout)
            return 0 if n else 2
        else:
            print("%-38s %-9s %-18s %6s %s"
                  % ("email", "papel", "criado", "sess", "ativo"))
            for r in c.execute("SELECT * FROM usuario ORDER BY email"):
                print("%-38s %-9s %-18s %6d %s"
                      % (r["email"], r["papel"], (r["criado_em"] or "")[:16],
                         len(auth.sessoes(c, r["email"])),
                         "sim" if r["ativo"] else "NÃO"))
            if not c.execute("SELECT count(*) FROM usuario").fetchone()[0]:
                print("\n(nenhuma conta ainda — crie a primeira com --criar "
                      "EMAIL --papel admin)")
    finally:
        c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
