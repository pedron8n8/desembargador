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
# ... e o cookie e' Secure fora de dev, entao o TestClient (http://testserver)
# o descartaria em silencio e todo teste de sessao falharia por engano.
os.environ["WEB_DEV"] = "1"

from fastapi.testclient import TestClient          # noqa: E402

from . import app as modulo_app                    # noqa: E402
from . import auth                                 # noqa: E402

SENHA = "senha-de-teste-longa"
CAB = {"X-Requerido-Por": "web"}


def main():
    c = esquema.db()
    auth.criar_usuario(c, "adv@teste.com", SENHA)
    auth.criar_usuario(c, "chefe@teste.com", SENHA, papel="admin")
    auth.criar_usuario(c, "outro@teste.com", SENHA)
    c.close()

    with TestClient(modulo_app.app) as cli:
        # --- sem sessao, tudo que e' privado responde 401
        for rota in ("/api/eu", "/api/config", "/api/consultas", "/api/grafo",
                     "/api/corpus", "/api/estatisticas/corpus"):
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

        d = cli.get("/api/corpus/%d" % item["id"]).json()
        assert d["numero"] == item["numero"] and "usos" in d
        assert cli.get("/api/corpus/999999999").status_code == 404

        f = cli.get("/api/corpus/facetas").json()
        assert f["classe"] and f["resultado"], f

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
            c.execute("INSERT INTO execucao VALUES "
                      "('t-do-outro','outro@teste.com','pronto','2026-01-01',"
                      " NULL,NULL,NULL,0)")
        c.close()
        threads = {x["thread"] for x in cli.get("/api/consultas").json()["itens"]}
        assert "t-do-outro" not in threads, "vazou consulta de outro usuário"
        assert cli.get("/api/consultas/t-do-outro").status_code == 404
        assert cli.get("/api/consultas/t-do-outro/markdown").status_code == 404
        assert cli.post("/api/consultas/t-do-outro/avaliacao", json={"nota": 5},
                        headers=CAB).status_code == 404

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
        assert cli.post("/api/consultas/t-meu/avaliacao", json={"nota": 9},
                        headers=CAB).status_code == 400
        assert cli.post("/api/consultas/t-meu/precedentes/1/veredito",
                        json={"veredito": "talvez"}, headers=CAB).status_code == 400

        # --- logout encerra de verdade
        assert cli.delete("/api/sessao", headers=CAB).status_code == 204
        assert cli.get("/api/eu").status_code == 401

        # --- admin ve o de todos
        cli.post("/api/sessao", json={"email": "chefe@teste.com", "senha": SENHA},
                 headers=CAB)
        assert cli.get("/api/admin/usuarios").json()["itens"]
        threads = {x["thread"] for x in cli.get("/api/consultas").json()["itens"]}
        assert "t-do-outro" in threads, "o admin tem que ver tudo"

        # --- rate limit no login
        cli.delete("/api/sessao", headers=CAB)
        for _ in range(auth.MAX_TENTATIVAS):
            cli.post("/api/sessao", json={"email": "adv@teste.com", "senha": "nao"},
                     headers=CAB)
        r = cli.post("/api/sessao", json={"email": "adv@teste.com", "senha": SENHA},
                     headers=CAB)
        assert r.status_code == 429, r.status_code

    print("self-check OK — auth, CSRF, isolamento entre usuários, acervo e "
          "estatísticas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
