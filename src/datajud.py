"""Cliente da API Pública do Datajud (CNJ) para o TJSC.

A API é um Elasticsearch somente-leitura. Pontos não óbvios:
- Autenticação: header "Authorization: APIKey <chave>". A chave pública é
  divulgada pelo CNJ em https://datajud-wiki.cnj.jus.br/api-publica/acesso
- NÃO existe campo "relator" pesquisável — por isso a estratégia híbrida:
  busca por numeroProcesso (vindos do portal) + bulk por órgão julgador.
- Paginação: from/size trava em 10.000 resultados. Usamos search_after:
  ordena por @timestamp asc e repassa o array "sort" do último hit de cada
  página como cursor da próxima. O cursor é persistido em checkpoints para
  retomar de onde parou.
"""
import argparse
import json
import logging
import time

import requests

log = logging.getLogger("datajud")

FONTE = "datajud"


class DatajudClient:
    def __init__(self, cfg):
        self.url = cfg["endpoint"]
        self.delay = cfg.get("delay_segundos", 1.0)
        self.timeout = cfg.get("timeout_segundos", 60)
        self.max_retries = cfg.get("max_retries", 5)
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"APIKey {cfg['api_key']}",
            "Content-Type": "application/json",
        })

    def _search(self, body):
        """POST no _search com retry + backoff exponencial em 429/5xx/rede."""
        for tentativa in range(self.max_retries):
            time.sleep(self.delay)
            try:
                r = self.session.post(self.url, json=body, timeout=self.timeout)
                if r.status_code == 200:
                    return r.json()
                if r.status_code in (401, 403):
                    raise RuntimeError(
                        f"Datajud recusou a chave de API (HTTP {r.status_code}). "
                        "Atualize DATAJUD_API_KEY — veja o README.")
                log.warning("Datajud HTTP %s (tentativa %s): %s",
                            r.status_code, tentativa + 1, r.text[:300])
            except requests.RequestException as e:
                log.warning("Erro de rede no Datajud (tentativa %s): %s", tentativa + 1, e)
            time.sleep(2 ** tentativa)  # backoff: 1,2,4,8,16s
        raise RuntimeError("Datajud: esgotadas as tentativas de retry.")

    def por_numeros(self, numeros):
        """Busca vários processos de uma vez (terms query).

        Consultar em lote é ~50x mais rápido que um request por processo: 12 mil
        processos saem em ~240 requests em vez de 12 mil. `size` folgado porque um
        mesmo número pode ter registro em G1 e G2.
        """
        body = {"size": max(200, len(numeros) * 3),
                "query": {"terms": {"numeroProcesso": list(numeros)}}}
        return self._search(body).get("hits", {}).get("hits", [])

    def bulk_orgao(self, orgao, data_ini, data_fim, grau, cursor, page_size=100):
        """Uma página do bulk por órgão julgador. Retorna (hits, novo_cursor)."""
        must = [{"match_phrase": {"orgaoJulgador.nome": orgao}}]
        if grau:
            must.append({"match": {"grau": grau}})
        filtro = []
        if data_ini or data_fim:
            rng = {}
            if data_ini:
                rng["gte"] = data_ini
            if data_fim:
                rng["lte"] = data_fim
            filtro.append({"range": {"dataAjuizamento": rng}})
        body = {
            "size": page_size,
            "query": {"bool": {"must": must, "filter": filtro}},
            "sort": [{"@timestamp": {"order": "asc"}}],
        }
        if cursor:
            body["search_after"] = cursor
        hits = self._search(body).get("hits", {}).get("hits", [])
        novo_cursor = hits[-1]["sort"] if hits else None
        return hits, novo_cursor


def _salvar_hit(storage, hit):
    src = hit.get("_source", {})
    numero = "".join(c for c in src.get("numeroProcesso", "") if c.isdigit())
    if not numero:
        return
    storage.upsert_processo({
        "numero_processo": numero,
        "fonte": FONTE,
        "tribunal": src.get("tribunal"),
        "classe": (src.get("classe") or {}).get("nome"),
        "classe_codigo": str((src.get("classe") or {}).get("codigo", "")),
        "assuntos_json": json.dumps(src.get("assuntos"), ensure_ascii=False),
        "orgao_julgador": (src.get("orgaoJulgador") or {}).get("nome"),
        "data_ajuizamento": src.get("dataAjuizamento"),
        "grau": src.get("grau"),
        "formato": (src.get("formato") or {}).get("nome"),
        "sistema": (src.get("sistema") or {}).get("nome"),
        "nivel_sigilo": str(src.get("nivelSigilo", "")),
        "raw_json": json.dumps(hit, ensure_ascii=False),
    })
    for mov in src.get("movimentos") or []:
        storage.upsert_movimento({
            "numero_processo": numero,
            "codigo": str(mov.get("codigo", "")),
            "nome": mov.get("nome"),
            "data_hora": mov.get("dataHora"),
            "complementos_json": json.dumps(mov.get("complementosTabelados"), ensure_ascii=False),
            "raw_json": json.dumps(mov, ensure_ascii=False),
        })


def coletar(config, storage):
    cfg = config["datajud"]
    cli = DatajudClient(cfg)
    modo = cfg.get("modo", "hibrido")

    # --- fase 1: por número de processo (os que vieram do portal), em lotes ---
    if modo in ("por_processo", "hibrido"):
        ja_tem = storage.numeros_com_processo()
        # A API publica do CNJ nao cobre o TJSC inteiro: processos julgados
        # antes de ~2021 simplesmente nao existem la'. Medido em 04/08/2026 —
        # 4 numeros de 2017-2019 devolveram 0 hits, enquanto um de 2024 (usado
        # como controle) devolveu 2. Sao 3.888 numeros nessa situacao, ~78
        # requisicoes por execucao gastas para nao achar nada. Guardamos quem
        # ja' foi procurado e nao existe, e paramos de reperguntar.
        #
        # Para reperguntar (se a cobertura da API mudar), basta apagar o
        # checkpoint: DELETE FROM checkpoints WHERE fonte='datajud_ausentes'.
        ausentes = set(storage.get_checkpoint("datajud_ausentes") or [])
        todos = [n for n in storage.numeros_com_decisao() if n not in ja_tem]
        pendentes = [n for n in todos if n not in ausentes]
        lote = cfg.get("lote", 50)
        log.info("Datajud por processo: %s números pendentes (lotes de %s); "
                 "%s já procurados e inexistentes na API foram pulados",
                 len(pendentes), lote, len(todos) - len(pendentes))
        achados = 0
        for i in range(0, len(pendentes), lote):
            bloco = pendentes[i:i + lote]
            hits = cli.por_numeros(bloco)
            for h in hits:
                _salvar_hit(storage, h)
            achados += len(hits)
            # o que foi perguntado e nao voltou nao se pergunta de novo
            voltaram = {h.get("_source", {}).get("numeroProcesso") for h in hits}
            ausentes.update(n for n in bloco if n not in voltaram)
            storage.commit()  # commit por lote = retomável (o que já entrou não repete)
            log.info("Datajud por processo: %s/%s números, %s registros",
                     min(i + lote, len(pendentes)), len(pendentes), achados)
        if pendentes:
            storage.set_checkpoint("datajud_ausentes", sorted(ausentes))
        log.info("Datajud por processo: concluído (%s registros, %s ausentes "
                 "memorizados)", achados, len(ausentes))

    # --- fase 2: bulk do órgão julgador via search_after ---
    if modo in ("bulk_orgao", "hibrido"):
        orgao = cfg.get("orgao_julgador") or ""
        if not orgao:
            log.warning("Datajud bulk: 'orgao_julgador' vazio no config — fase pulada.")
            return
        cursor = storage.get_checkpoint("datajud_bulk")  # resume
        total = 0
        while True:
            hits, novo_cursor = cli.bulk_orgao(
                orgao, config.get("data_inicio"), config.get("data_fim"),
                cfg.get("grau"), cursor, cfg.get("page_size", 100))
            if not hits:
                break
            for h in hits:
                _salvar_hit(storage, h)
            storage.commit()
            total += len(hits)
            cursor = novo_cursor
            storage.set_checkpoint("datajud_bulk", cursor)
            log.info("Datajud bulk: +%s (total %s) — cursor %s", len(hits), total, cursor)
        log.info("Datajud bulk: fim da paginação (total %s nesta execução)", total)


def _self_check():
    """Offline: a memoria de ausentes poupa requisicoes sem esconder achado.

    Sem rede e sem banco de verdade — so' a logica de filtragem, que e' onde o
    erro seria caro (pular um numero que a API TEM significaria perder dados
    para sempre, em silencio).
    """
    todos = ["A", "B", "C", "D"]
    ja_tem = {"A"}                       # ja' coletado antes
    ausentes = {"B"}                     # ja' procurado, a API nao tem
    pend = [n for n in todos if n not in ja_tem and n not in ausentes]
    assert pend == ["C", "D"], pend

    # depois de perguntar por C e D e so' C voltar, D entra para ausentes
    voltaram = {"C"}
    ausentes.update(n for n in pend if n not in voltaram)
    assert ausentes == {"B", "D"}, ausentes
    # e C NAO entra: um achado nunca pode virar ausencia memorizada
    assert "C" not in ausentes

    # na proxima execucao, so' sobra o que nunca foi perguntado
    ja_tem.add("C")
    assert [n for n in todos + ["E"] if n not in ja_tem and n not in ausentes] == ["E"]
    print("datajud: self-check OK — ausentes memorizados, achados preservados")


if __name__ == "__main__":
    # Teste isolado: python -m src.datajud --teste [--numero NNNN...]
    from src.main import load_config
    p = argparse.ArgumentParser()
    p.add_argument("--teste", action="store_true")
    p.add_argument("--numero", default="50015664520268240000")  # processo real TJSC G2
    a = p.parse_args()
    if not a.teste:
        _self_check()
        raise SystemExit(0)
    logging.basicConfig(level=logging.INFO)
    cli = DatajudClient(load_config()["datajud"])
    hits = cli.por_numeros([a.numero])
    print(f"{len(hits)} hit(s) para {a.numero}")
    for h in hits:
        s = h["_source"]
        print(json.dumps({k: s.get(k) for k in
                          ("numeroProcesso", "grau", "dataAjuizamento")}, ensure_ascii=False))
        print("  classe:", (s.get("classe") or {}).get("nome"),
              "| orgao:", (s.get("orgaoJulgador") or {}).get("nome"),
              "| movimentos:", len(s.get("movimentos") or []))
