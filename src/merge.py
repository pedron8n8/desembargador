"""Consolida processos (Datajud) + decisoes (portal) pela chave = nº CNJ (20 dígitos).

Um processo pode ter VÁRIAS decisões no portal (acórdão, monocrática, embargos...).
No consolidado fica uma linha por processo, com a decisão mais recente nos campos
de texto e `qtd_decisoes` indicando quantas existem — as demais continuam íntegras
na tabela `decisoes`. Nada é descartado.

Decisões com numeração pré-CNJ (ex.: "2013.200692-5") não têm chave de cruzamento;
entram no consolidado com o número bruto como chave e `fontes='portal_tjsc'`.
"""
import json
import logging

log = logging.getLogger("merge")

CAMPOS_DATAJUD = {"orgao_julgador": "orgao_julgador", "classe": "classe",
                  "assuntos_json": "assuntos_json", "data_ajuizamento": "data_ajuizamento",
                  "grau": "grau"}
CAMPOS_PORTAL = {"relator": "relator", "orgao_julgador": "orgao", "classe": "classe",
                 "data_julgamento": "data_julgamento", "ementa": "ementa",
                 "inteiro_teor": "inteiro_teor", "doc_path": "doc_path"}


def consolidar(config, storage):
    db = storage.db
    # ordena G2 por último: em processos com registro G1 e G2, o G2 prevalece
    processos = {r["numero_processo"]: dict(r) for r in
                 db.execute("SELECT * FROM processos "
                            "ORDER BY CASE WHEN grau='G2' THEN 1 ELSE 0 END")}

    decisoes, contagem = {}, {}
    # ordena por data: a mais recente sobrescreve e vira a "decisão do processo"
    for r in db.execute("SELECT * FROM decisoes ORDER BY data_julgamento"):
        chave = r["numero_processo"] or r["numero_processo_raw"]
        if not chave:
            continue
        decisoes[chave] = dict(r)
        contagem[chave] = contagem.get(chave, 0) + 1

    numeros = set(processos) | set(decisoes)
    numeros.discard("")
    for numero in numeros:
        p, d = processos.get(numero), decisoes.get(numero)
        cons, prov, fontes = {"numero_processo": numero}, {}, []
        if p:
            fontes.append(p["fonte"])
            for destino, origem in CAMPOS_DATAJUD.items():
                if p.get(origem):
                    cons[destino] = p[origem]
                    prov[destino] = p["fonte"]
        if d:
            fontes.append(d["fonte"])
            cons["qtd_decisoes"] = contagem.get(numero, 1)
            for destino, origem in CAMPOS_PORTAL.items():
                if d.get(origem):  # portal prevalece: é a fonte da decisão em si
                    cons[destino] = d[origem]
                    prov[destino] = d["fonte"]
        cons["fontes"] = ",".join(dict.fromkeys(fontes))
        cons["proveniencia_json"] = json.dumps(prov, ensure_ascii=False)
        storage.upsert_consolidado(cons)
    storage.commit()
    log.info("Consolidado: %s processos (%s só Datajud, %s só portal, %s cruzados)",
             len(numeros), len(set(processos) - set(decisoes)),
             len(set(decisoes) - set(processos)), len(set(processos) & set(decisoes)))


if __name__ == "__main__":
    # Self-check com banco em memória
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from src.storage import Storage
    s = Storage(":memory:")
    s.upsert_processo({"numero_processo": "1" * 20, "fonte": "datajud",
                       "classe": "Apelação", "grau": "G2", "orgao_julgador": "4ª Câmara"})
    s.upsert_decisao({"numero_processo": "1" * 20, "numero_processo_raw": "1-1", "doc_id": "A",
                      "fonte": "portal_tjsc", "relator": "Des. Teste", "ementa": "ANTIGA",
                      "data_julgamento": "2020-01-01"})
    s.upsert_decisao({"numero_processo": "1" * 20, "numero_processo_raw": "1-1", "doc_id": "B",
                      "fonte": "portal_tjsc", "relator": "Des. Teste", "ementa": "RECENTE",
                      "data_julgamento": "2024-01-01"})
    s.upsert_decisao({"numero_processo": "", "numero_processo_raw": "2013.200692-5",
                      "doc_id": "C", "fonte": "portal_tjsc", "ementa": "PRE-CNJ"})
    # o portal reusa doc_id entre decisões distintas: as duas precisam sobreviver
    s.upsert_decisao({"numero_processo": "3" * 20, "numero_processo_raw": "3-3", "doc_id": "B",
                      "fonte": "portal_tjsc", "ementa": "OUTRA COM MESMO ID",
                      "data_julgamento": "2024-02-02"})
    assert s.count("decisoes") == 4, f"doc_id repetido comeu um registro: {s.count('decisoes')}"
    # o doc_id do portal muda entre execuções: relistar com id novo NÃO cria linha nova
    s.upsert_decisao({"numero_processo": "1" * 20, "numero_processo_raw": "1-1",
                      "doc_id": "B_NOVO_ROWID", "fonte": "portal_tjsc", "relator": "Des. Teste",
                      "ementa": "RECENTE", "data_julgamento": "2024-01-01"})
    assert s.count("decisoes") == 4, f"id volátil duplicou a decisão: {s.count('decisoes')}"
    id_b = s.db.execute("SELECT id, doc_id FROM decisoes WHERE ementa='RECENTE'").fetchone()
    assert id_b[1] == "B_NOVO_ROWID", "doc_id não foi atualizado para o mais recente"
    # fase 2 não pode ser apagada por uma re-listagem
    s.atualizar_detalhe(id_b[0], "TEOR COMPLETO", "x.rtf")
    s.upsert_decisao({"numero_processo": "1" * 20, "numero_processo_raw": "1-1", "doc_id": "B",
                      "fonte": "portal_tjsc", "relator": "Des. Teste", "ementa": "RECENTE",
                      "data_julgamento": "2024-01-01"})
    s.upsert_decisao({"numero_processo": "1" * 20, "numero_processo_raw": "1-1",
                      "doc_id": "B_MAIS_NOVO", "fonte": "portal_tjsc", "relator": "Des. Teste",
                      "ementa": "RECENTE", "data_julgamento": "2024-01-01"})
    assert s.db.execute("SELECT inteiro_teor FROM decisoes WHERE id=?",
                        (id_b[0],)).fetchone()[0] == "TEOR COMPLETO", \
        "re-listagem apagou o inteiro teor"
    assert len(s.decisoes_sem_detalhe()) == 3, "pendentes de detalhe errado"
    # metade obtida + metade pendente: o que deu certo tem que ficar salvo
    id_c = s.db.execute("SELECT id FROM decisoes WHERE doc_id='C'").fetchone()[0]
    s.atualizar_detalhe(id_c, "SO O TEOR", None, concluido=False)
    r = s.db.execute("SELECT inteiro_teor, detalhe_em FROM decisoes WHERE id=?", (id_c,)).fetchone()
    assert r[0] == "SO O TEOR", "resultado parcial foi descartado"
    assert r[1] is None, "item parcial foi marcado como concluído"
    pend = {p["doc_id"]: p for p in s.decisoes_sem_detalhe()}
    assert "C" in pend and pend["C"]["tem_teor"] == 1 and pend["C"]["tem_doc"] == 0, \
        "retomada não sabe o que já foi obtido"

    # --- gemeas por deriva de ementa. A identidade inclui o SHA-256 da ementa
    # (storage.py). Se o portal reservir a MESMA decisao com um byte diferente
    # no texto, o ON CONFLICT nao dispara e nasce uma linha nova.
    #
    # Medido em 04/08/2026 no acervo real: 114 grupos, 229 linhas (1,1% do
    # total). Dano medido no que importa — 300 consultas cegas, 2.400 posicoes
    # de precedente: ZERO casos em que as duas copias entraram no mesmo top-8,
    # ou seja, nenhuma decisao votou duas vezes no prognostico.
    #
    # Por isso NAO se apaga nada. `decisoes.id` e' INTEGER PRIMARY KEY sem
    # AUTOINCREMENT: um DELETE libera os ids do topo para serem reatribuidos a
    # decisoes DIFERENTES, e o feedback.db (que guarda voto por decisao_id)
    # passaria a apontar para a decisao errada, em silencio. O conserto seria
    # pior que o problema. O que se faz e' vigiar para nao crescer.
    s.upsert_decisao({"numero_processo": "4" * 20, "numero_processo_raw": "4-4",
                      "doc_id": "D", "fonte": "portal_tjsc", "relator": "Des. Teste",
                      "ementa": "TEXTO ORIGINAL", "data_julgamento": "2024-03-03"})
    n_antes = s.count("decisoes")
    s.upsert_decisao({"numero_processo": "4" * 20, "numero_processo_raw": "4-4",
                      "doc_id": "D", "fonte": "portal_tjsc", "relator": "Des. Teste",
                      "ementa": "TEXTO ORIGINAL.", "data_julgamento": "2024-03-03"})
    assert s.count("decisoes") == n_antes + 1, \
        "a deriva de ementa deixou de criar gemea — a identidade mudou?"
    print("  (deriva de ementa cria gêmea, como esperado — ver comentário)")

    consolidar({}, s)
    rows = {r["numero_processo"]: dict(r) for r in s.db.execute("SELECT * FROM consolidado")}
    assert rows["1" * 20]["fontes"] == "datajud,portal_tjsc"
    assert rows["1" * 20]["ementa"] == "RECENTE", "não pegou a decisão mais recente"
    assert rows["1" * 20]["qtd_decisoes"] == 2, rows["1" * 20]["qtd_decisoes"]
    assert rows["1" * 20]["classe"] == "Apelação"
    assert rows["2013.200692-5"]["fontes"] == "portal_tjsc"
    print("merge: self-check OK")
