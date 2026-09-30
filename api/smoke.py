"""Smoke da API contra um web.db temporário. Não gasta LLM, não escreve no real.

Usa fastapi.testclient, que roda em cima do httpx — ja' instalado como
dependencia do langgraph. Zero dependencia nova para testar.

    python -m api.smoke
"""
import os
import sys
import tempfile

from . import esquema

# ANTES de importar api.app: o modulo le' esquema.WEB no lifespan, e nada aqui
# pode encostar no banco de verdade.
esquema.WEB = os.path.join(tempfile.mkdtemp(), "web.db")
# ... e o mesmo vale para o feedback.db: GET /api/consultas monta a listagem a
# partir da tabela `consulta` DELE (api/app.py:305), nao do web.db. Sem
# redirecionar, o smoke lia as consultas reais do usuario e o fixture de
# `t-do-outro` nunca aparecia na listagem — o assert da linha 201 era
# insatisfazivel. Mesmo padrao do self-check de src/rag/feedback.py:332.
from src.rag import feedback as _feedback
_feedback.FB = os.path.join(tempfile.mkdtemp(), "fb.db")
# criar o arquivo e o esquema JA': api/app.py abre feedback.FB em mode=ro
# (leitura), e o SQLite recusa abrir em modo somente-leitura um arquivo que
# ainda nao existe — precisa nascer antes da primeira requisicao do smoke.
_feedback.db().close()
# ... e o cookie e' Secure fora de dev, entao o TestClient (http://testserver)
# o descartaria em silencio e todo teste de sessao falharia por engano.
os.environ["WEB_DEV"] = "1"

from fastapi.testclient import TestClient          # noqa: E402

from src import cerebros                           # noqa: E402

from . import app as modulo_app                    # noqa: E402
from . import auth                                 # noqa: E402
from . import execucao                             # noqa: E402

SENHA = "senha-de-teste-longa"
CAB = {"X-Requerido-Por": "web"}


def main():
    c = esquema.db()
    auth.criar_usuario(c, "adv@teste.com", SENHA)
    auth.criar_usuario(c, "chefe@teste.com", SENHA, papel="admin")
    auth.criar_usuario(c, "dono@teste.com", SENHA, papel="superadmin")
    auth.criar_usuario(c, "outro@teste.com", SENHA)
    c.close()

    with TestClient(modulo_app.app) as cli:
        # --- sem sessao, tudo que e' privado responde 401
        for rota in ("/api/eu", "/api/config", "/api/consultas", "/api/grafo",
                     "/api/corpus", "/api/estatisticas/corpus",
                     "/api/cerebros", "/api/comparacoes"):
            assert cli.get(rota).status_code == 401, rota
        assert cli.post("/api/consultas", json={"caso": "x"},
                        headers=CAB).status_code == 401
        # ... mas a saude e' publica de proposito (health check nao autentica)
        assert cli.get("/api/saude").json()["ok"] is True

        # --- login
        assert cli.post("/api/sessao",
                        json={"email": "adv@teste.com", "senha": "errada"},
                        headers=CAB).status_code == 401
        r = cli.post("/api/sessao", json={"email": "ADV@teste.com", "senha": SENHA},
                     headers=CAB)
        assert r.status_code == 204, r.text
        assert modulo_app.COOKIE in cli.cookies
        assert cli.get("/api/eu").json()["email"] == "adv@teste.com"

        # --- CSRF: metodo mutante sem o cabecalho e' recusado
        assert cli.post("/api/consultas", json={"caso": "x"}).status_code == 403
        assert cli.delete("/api/sessao").status_code == 403

        # --- config e grafo saem do processo, nao de um desenho fixo
        cfg = cli.get("/api/config").json()
        assert cfg["modelos"]["conversa"], cfg["modelos"]
        assert cfg["peso_confianca"]["dispositivo"] == 1.0
        assert set(cfg["teses"]) == {"neutra", "reformar", "manter"}

        g = cli.get("/api/grafo").json()
        nomes = {n["id"] for n in g["nos"]}
        assert {"triagem", "recuperar", "triar", "prognostico", "redigir",
                "revisar", "julgar"} <= nomes, nomes
        assert any(e["condicional"] for e in g["arestas"]), "os ciclos sumiram"

        # --- validacao de entrada
        assert cli.post("/api/consultas", json={"caso": "  "},
                        headers=CAB).status_code == 400
        assert cli.post("/api/consultas", json={"caso": "x", "tese": "inventada"},
                        headers=CAB).status_code == 400

        # --- origem (consulta que veio da extensao do eproc). Primeiro a funcao pura,
        # SEM nenhum POST: se ela ainda nao existir, o smoke tem de cair aqui, e nao
        # depois de um POST aceito por engano (que rodaria LLM de verdade).
        assert modulo_app._origem({}) is None
        assert modulo_app._origem({"origem": None}) is None
        assert modulo_app._origem({"origem": {"eproc": "5" * 20, "instancia": "2g",
                                              "extra": "ignorado"}}) == \
            {"eproc": "5" * 20, "instancia": "2g"}
        # digitos nao-ASCII (ex.: arabe-indicos) nao sao "20 digitos": \d do Python 3 os aceita
        from fastapi import HTTPException
        try:
            modulo_app._origem({"origem": {"eproc": "٠" * 20, "instancia": "1g"}})
        except HTTPException as e:
            assert e.status_code == 400, e.status_code
        else:
            raise AssertionError("_origem aceitou digitos nao-ASCII")

        # formato invalido e' 400; a validacao vem antes do cerebro e do pool, entao
        # nao gasta LLM
        for ruim in ("x", "", {}, {"eproc": "123", "instancia": "1g"},
                     {"eproc": "5" * 20, "instancia": "3g"},
                     {"eproc": 5 * 10 ** 19, "instancia": "1g"},
                     {"eproc": "5" * 20}):
            assert cli.post("/api/consultas", json={"caso": "x", "origem": ruim},
                            headers=CAB).status_code == 400, ruim

        # ... e a origem valida vira coluna. Chama iniciar() com o pool trocado por
        # um que nao roda nada: rodar de verdade gastaria LLM.
        class _SemPool:
            def submit(self, *a, **k):
                return None

        pool_real = execucao.pool
        execucao.pool = lambda: _SemPool()
        try:
            execucao.iniciar("t-origem", "adv@teste.com", "caso",
                             origem={"eproc": "5" * 20, "instancia": "2g"})
            execucao.iniciar("t-sem-origem", "adv@teste.com", "caso")
        finally:
            execucao.pool = pool_real
        c = esquema.db()
        try:
            linha = lambda t: tuple(c.execute(          # noqa: E731
                "SELECT origem_eproc, origem_instancia FROM execucao WHERE thread=?",
                (t,)).fetchone())
            assert linha("t-origem") == ("5" * 20, "2g"), linha("t-origem")
            assert linha("t-sem-origem") == (None, None)
            # nao ficar na fila: essas linhas contariam para o teto de consultas vivas
            with c:
                c.execute("UPDATE execucao SET estado='pronto' "
                          "WHERE thread IN ('t-origem','t-sem-origem')")
        finally:
            c.close()

        # --- acervo
        corpus = cli.get("/api/corpus?por_pagina=5").json()
        assert corpus["total"] > 1000 and len(corpus["itens"]) == 5
        assert corpus["ordenado_por"] == "data"
        item = corpus["itens"][0]
        assert "ficha" in item and "explicacao_rank" in item
        assert "ancoras_json" not in item, "o campo cru vazou para o JSON"

        buscado = cli.get("/api/corpus?q=prescrição intercorrente&por_pagina=5").json()
        assert buscado["consulta_fts"] and buscado["ordenado_por"] == "bm25+rerank"
        assert buscado["itens"], "a busca do acervo não devolveu nada"

        # o cerebro vai no CAMINHO: link auto-contido, sem risco de abrir a
        # decisao de mesmo id no acervo errado
        pad = cli.get("/api/cerebros").json()["padrao"]
        d = cli.get("/api/corpus/%s/%d" % (pad, item["id"])).json()
        assert d["numero"] == item["numero"] and "usos" in d
        assert d["cerebro"] == pad
        assert cli.get("/api/corpus/%s/999999999" % pad).status_code == 404
        assert cli.get("/api/corpus/nao-existe/1").status_code == 404

        f = cli.get("/api/corpus/facetas").json()
        assert f["classe"] and f["resultado"], f

        # --- doc_path guardado em OUTRA maquina (deploy: coleta no Windows,
        # servidor no Linux). Sem remontar, todo documento vira 404 calado.
        cam = cerebros.caminhos(pad)
        esperado = os.path.join(cam["documentos"], "x.rtf")
        for guardado in (r"D:\projetos\scrapping desembargador\output\documentos\x.rtf",
                         "/srv/cerebro/output/documentos/x.rtf",
                         os.path.join("output", "documentos", "x.rtf"),
                         "x.rtf"):
            assert modulo_app._remontar_doc(guardado, cam) == esperado, guardado
        # travessia nao sai do diretorio do cerebro
        assert modulo_app._remontar_doc(r"..\..\..\etc\passwd", cam) == \
            os.path.join(cam["documentos"], "passwd")

        # --- estatisticas
        ec = cli.get("/api/estatisticas/corpus").json()
        assert ec["total"] > 10000
        assert all(x["n"] >= ec["minimo_ano"] for x in ec["por_ano"])
        assert cli.get("/api/estatisticas/deriva").json()["por_ano"]
        assert cli.get("/api/estatisticas/classes").json()["itens"]
        assert "calibrado" in cli.get("/api/estatisticas/calibracao").json()
        assert cli.get("/api/estatisticas/abstencao").json()["observado"] is True
        assert "total_usd" in cli.get("/api/estatisticas/custos").json()

        # --- consulta inexistente
        assert cli.get("/api/consultas/nao-existe").status_code == 404
        assert cli.get("/api/consultas/nao-existe/pesos").status_code == 404

        # --- isolamento entre usuarios: a lista so' mostra o que e' seu
        c = esquema.db()
        with c:
            c.execute("INSERT INTO dono VALUES ('t-do-outro','outro@teste.com')")
            # colunas NOMEADAS: a versao posicional quebrou quando execucao
            # ganhou cerebro/comparacao, e e' o que este smoke tem de pegar
            c.execute("INSERT INTO execucao (thread, email, estado, criado_em, "
                      "so_prognostico, cerebro) VALUES (?,?,?,?,?,?)",
                      ("t-do-outro", "outro@teste.com", "pronto", "2026-01-01",
                       0, "rubens-schulz"))
        c.close()
        # a listagem sai da tabela `consulta` do feedback.db (api/app.py:305);
        # `dono` e `execucao` do web.db so' filtram. Fixture sem linha aqui e'
        # fixture invisivel.
        fb = _feedback.db()
        with fb:
            fb.execute(
                "INSERT INTO consulta (thread, criado_em, caso, prognostico_json, "
                " minuta, custo_usd, modelos_json, cerebro) VALUES (?,?,?,?,?,?,?,?)",
                ("t-do-outro", "2026-01-01", "caso do outro", "{}", "",
                 0.0, "[]", "rubens-schulz"))
        fb.close()
        threads = {x["thread"] for x in cli.get("/api/consultas").json()["itens"]}
        assert "t-do-outro" not in threads, "vazou consulta de outro usuário"
        assert cli.get("/api/consultas/t-do-outro").status_code == 404
        assert cli.get("/api/consultas/t-do-outro/markdown").status_code == 404
        assert cli.post("/api/consultas/t-do-outro/avaliacao", json={"nota": 5},
                        headers=CAB).status_code == 404

        # --- cerebros: todos veem os ativos; so' o superadmin ve os inativos
        cb = cli.get("/api/cerebros").json()
        assert cb["itens"] and all(x["ativo"] for x in cb["itens"]), cb
        assert cb["padrao"] in {x["slug"] for x in cb["itens"]}
        assert all("n_merito" in x and "crava" in x for x in cb["itens"])
        assert cli.get("/api/cerebros?todos=1").status_code == 403
        assert cli.patch("/api/cerebros/%s" % cb["padrao"], json={"ativo": True},
                         headers=CAB).status_code == 403

        # rodar num cerebro que nao existe e' 404, e nao consulta no acervo errado
        assert cli.post("/api/consultas",
                        json={"caso": "x", "cerebro": "nao-existe"},
                        headers=CAB).status_code == 404

        # --- comparacao: precisa de 2+ cerebros distintos e existentes
        assert cli.post("/api/comparacoes",
                        json={"caso": "x", "cerebros": [cb["padrao"]]},
                        headers=CAB).status_code == 400
        assert cli.post("/api/comparacoes",
                        json={"caso": "x", "cerebros": [cb["padrao"], cb["padrao"]]},
                        headers=CAB).status_code == 400
        assert cli.get("/api/comparacoes").json()["itens"] == []
        assert cli.get("/api/comparacoes/cmp-nao-existe").status_code == 404

        # --- so' admin entra no /api/admin
        assert cli.get("/api/admin/usuarios").status_code == 403
        assert cli.post("/api/admin/usuarios",
                        json={"email": "x@y.com", "senha": "12345678901"},
                        headers=CAB).status_code == 403

        # --- nota fora da faixa
        c = esquema.db()
        with c:
            c.execute("INSERT INTO dono VALUES ('t-meu','adv@teste.com')")
        c.close()
        # mesmo acoplamento do t-do-outro: sem linha em `consulta` no
        # feedback.db, a rota nem enxerga a thread
        fb = _feedback.db()
        with fb:
            fb.execute(
                "INSERT INTO consulta (thread, criado_em, caso, prognostico_json, "
                " minuta, custo_usd, modelos_json, cerebro) VALUES (?,?,?,?,?,?,?,?)",
                ("t-meu", "2026-01-01", "meu caso", "{}", "",
                 0.0, "[]", "rubens-schulz"))
        fb.close()
        assert cli.post("/api/consultas/t-meu/avaliacao", json={"nota": 9},
                        headers=CAB).status_code == 400
        assert cli.post("/api/consultas/t-meu/precedentes/1/veredito",
                        json={"veredito": "talvez"}, headers=CAB).status_code == 400

        # --- caso gigante e' recusado antes de virar tokens pagos
        assert cli.post("/api/consultas", json={"caso": "x" * 200_000},
                        headers=CAB).status_code == 413

        # --- teto de execucoes vivas por usuario: cada consulta custa ~US$0,04
        # e so' ha' 2 workers, entao um laco era dreno de caixa E fila travada
        # para todo mundo.
        c = esquema.db()
        with c:
            for i in range(modulo_app.MAX_VIVAS_POR_USUARIO):
                c.execute("INSERT INTO execucao (thread, email, estado, criado_em, "
                          "so_prognostico, cerebro) VALUES (?,?,?,?,?,?)",
                          ("t-fila-%d" % i, "adv@teste.com", "fila", "2026-01-01",
                           0, "rubens-schulz"))
        c.close()
        r = cli.post("/api/consultas", json={"caso": "um caso qualquer"},
                     headers=CAB)
        assert r.status_code == 429, r.status_code

        # --- o mesmo teto vale para /retomar: senao' o usuario contorna o
        # limite esperando as 3 primeiras terminarem e retomando-as em laco —
        # cada retomada tambem cai no pool() e paga LLM de novo.
        c = esquema.db()
        with c:
            c.execute("INSERT INTO dono VALUES ('t-retomar','adv@teste.com')")
            c.execute("INSERT INTO execucao (thread, email, estado, criado_em, "
                      "so_prognostico, cerebro) VALUES (?,?,?,?,?,?)",
                      ("t-retomar", "adv@teste.com", "pronto", "2026-01-01",
                       0, "rubens-schulz"))
        c.close()
        r = cli.post("/api/consultas/t-retomar/retomar", headers=CAB)
        assert r.status_code == 429, r.status_code

        c = esquema.db()
        with c:
            c.execute("UPDATE execucao SET estado='pronto' WHERE thread LIKE 't-fila-%'")
        c.close()

        # --- logout encerra de verdade
        assert cli.delete("/api/sessao", headers=CAB).status_code == 204
        assert cli.get("/api/eu").status_code == 401

        # --- admin ve o de todos
        cli.post("/api/sessao", json={"email": "chefe@teste.com", "senha": SENHA},
                 headers=CAB)
        assert cli.get("/api/admin/usuarios").json()["itens"]
        threads = {x["thread"] for x in cli.get("/api/consultas").json()["itens"]}
        assert "t-do-outro" in threads, "o admin tem que ver tudo"
        # e toda linha da lista diz de qual cerebro e'
        assert all(x["cerebro"] for x in cli.get("/api/consultas").json()["itens"])

        # --- superadmin: ve os inativos e e' o unico que liga/desliga cerebro
        cli.delete("/api/sessao", headers=CAB)
        cli.post("/api/sessao", json={"email": "dono@teste.com", "senha": SENHA},
                 headers=CAB)
        todos = cli.get("/api/cerebros?todos=1").json()
        assert len(todos["itens"]) >= len(cb["itens"])
        # o superadmin tambem manda no escritorio (nao so' nos cerebros)
        assert cli.get("/api/admin/usuarios").json()["itens"]
        assert "t-do-outro" in {x["thread"] for x in
                                cli.get("/api/consultas").json()["itens"]}
        # ativar cerebro sem indice e' 409, e nao um acervo vazio no seletor
        sem_indice = [x for x in todos["itens"] if not x["tem_indice"]]
        if sem_indice:
            assert cli.patch("/api/cerebros/%s" % sem_indice[0]["slug"],
                             json={"ativo": True}, headers=CAB).status_code == 409
        assert cli.patch("/api/cerebros/nao-existe", json={"ativo": False},
                         headers=CAB).status_code == 404

        # --- criar usuario NAO sobrescreve conta existente (era escalonamento
        # de privilegio: um admin trocava a senha do superadmin e ficava com
        # a conta, sem derrubar a sessao da vitima)
        r = cli.post("/api/admin/usuarios",
                     json={"email": "dono@teste.com", "senha": "senha-do-atacante",
                           "papel": "superadmin"}, headers=CAB)
        assert r.status_code == 409, r.status_code
        # a senha do dono continua valendo
        cli.delete("/api/sessao", headers=CAB)
        assert cli.post("/api/sessao",
                        json={"email": "dono@teste.com", "senha": SENHA},
                        headers=CAB).status_code == 204
        cli.delete("/api/sessao", headers=CAB)
        cli.post("/api/sessao", json={"email": "chefe@teste.com", "senha": SENHA},
                 headers=CAB)

        # --- papel invalido e' recusado, e admin nao fabrica superadmin
        assert cli.post("/api/admin/usuarios",
                        json={"email": "novo@teste.com", "senha": "senha-longa-ok",
                              "papel": "rei"}, headers=CAB).status_code == 400
        assert cli.post("/api/admin/usuarios",
                        json={"email": "novo@teste.com", "senha": "senha-longa-ok",
                              "papel": "superadmin"}, headers=CAB).status_code == 403
        assert cli.post("/api/admin/usuarios",
                        json={"email": "novo@teste.com", "senha": "senha-longa-ok"},
                        headers=CAB).status_code == 201

        # --- rate limit no login
        cli.delete("/api/sessao", headers=CAB)
        for _ in range(auth.MAX_TENTATIVAS):
            cli.post("/api/sessao", json={"email": "adv@teste.com", "senha": "nao"},
                     headers=CAB)
        r = cli.post("/api/sessao", json={"email": "adv@teste.com", "senha": SENHA},
                     headers=CAB)
        assert r.status_code == 429, r.status_code

    print("self-check OK — auth, CSRF, papéis (advogado/admin/superadmin), "
          "isolamento entre usuários, cérebros, acervo e estatísticas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
