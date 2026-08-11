"""Orquestrador: config -> fontes ativas -> merge -> exports.

Uso:  python -m src.main --cerebro SLUG
      python -m src.main [--relator "NOME"] [--data-inicio 2020-01-01] [--data-fim ...]

`--cerebro` resolve relator, periodo e destino a partir do cerebros.json — e' o
jeito de coletar o acervo de um segundo desembargador sem escrever por cima do
primeiro. Sem ele, vale o config.json de sempre (o cerebro padrao).
Argumentos de linha de comando sobrescrevem os dois.
"""
import argparse
import json
import logging
import os
from pathlib import Path

RAIZ = Path(__file__).parent.parent


def load_config(cerebro=None):
    from src import cerebros

    # cerebros.config_coleta ja' devolve o config.json com relator/periodo/saida
    # do cerebro aplicados por cima
    cfg = cerebros.config_coleta(cerebro) if cerebro else None
    if cfg is None:
        with open(RAIZ / "config.json", encoding="utf-8") as f:
            cfg = json.load(f)
    # .env simples (só DATAJUD_API_KEY) sem dependência extra
    env = RAIZ / ".env"
    if env.exists():
        for linha in env.read_text(encoding="utf-8").splitlines():
            if "=" in linha and not linha.strip().startswith("#"):
                k, _, v = linha.partition("=")
                os.environ.setdefault(k.strip(), v.strip())
    cfg["datajud"]["api_key"] = os.environ.get("DATAJUD_API_KEY", cfg["datajud"]["api_key"])
    # caminhos absolutos relativos à raiz do projeto
    cfg["saida"] = {k: str(RAIZ / v) for k, v in cfg["saida"].items()}
    return cfg


def main():
    p = argparse.ArgumentParser(description="Coleta decisões de um desembargador do TJSC")
    p.add_argument("--cerebro", metavar="SLUG",
                   help="qual acervo coletar (ver cerebros.json). Define relator, "
                        "período e destino; sem ele vale o config.json.")
    p.add_argument("--relator")
    p.add_argument("--data-inicio")
    p.add_argument("--data-fim")
    p.add_argument("--recoletar", action="store_true",
                   help="ignora os checkpoints e varre tudo de novo (para pegar decisões "
                        "novas). Não duplica nada: os registros existentes são atualizados.")
    a = p.parse_args()

    cfg = load_config(a.cerebro)
    if a.relator:
        cfg["relator"] = a.relator
    if a.data_inicio:
        cfg["data_inicio"] = a.data_inicio
    if a.data_fim:
        cfg["data_fim"] = a.data_fim

    from src.storage import Storage, setup_logging
    setup_logging(cfg["saida"]["logs"], cfg.get("log_level", "INFO"))
    log = logging.getLogger("main")

    if not cfg.get("relator") or "NOME DO" in cfg["relator"].upper():
        log.error('Defina o relator em config.json ("relator": "Des. Fulano de Tal") '
                  'ou via --relator "NOME". Abortando.')
        return

    # os checkpoints de coleta moram DENTRO do tjsc.db de cada cerebro, entao
    # dois acervos nao disputam a mesma memoria de progresso
    os.makedirs(os.path.dirname(cfg["saida"]["db"]), exist_ok=True)
    storage = Storage(cfg["saida"]["db"])
    log.info("Cérebro: %s | relator: %s | período: %s a %s | banco: %s",
             a.cerebro or "(config.json)", cfg["relator"],
             cfg.get("data_inicio") or "-", cfg.get("data_fim") or "-",
             cfg["saida"]["db"])
    if a.recoletar:
        # 'datajud_ausentes' sobrevive de proposito: ele nao registra PROGRESSO
        # (que e' o que --recoletar quer refazer), e sim um FATO sobre a API —
        # que ela nao tem esses processos. Apaga-lo faria toda recoleta gastar
        # ~78 requisicoes redescobrindo a mesma ausencia. Para reperguntar de
        # verdade: DELETE FROM checkpoints WHERE fonte='datajud_ausentes'.
        storage.db.execute("DELETE FROM checkpoints WHERE fonte <> 'datajud_ausentes'")
        storage.commit()
        log.info("--recoletar: checkpoints de listagem limpos, varrendo tudo de "
                 "novo (a memória de ausentes no Datajud foi preservada).")

    # Ordem por custo: as fases rápidas primeiro, para o dataset ficar utilizável
    # em minutos; o inteiro teor (1-2 requests por decisão) fica por último.
    # Cada fase é isolada num try para uma falha não derrubar as demais.
    from src.portal_jurisprudencia import coletar_detalhes, coletar_listagem

    if cfg["fontes"].get("portal"):
        try:
            coletar_listagem(cfg, storage)  # alimenta os nºs que o Datajud consulta
        except Exception:
            log.exception("Portal (listagem) falhou — seguindo.")

    if cfg["fontes"].get("datajud"):
        try:
            from src.datajud import coletar as coletar_datajud
            coletar_datajud(cfg, storage)
        except Exception:
            log.exception("Fonte datajud falhou — seguindo.")

    from src.merge import consolidar
    consolidar(cfg, storage)
    storage.export_all(cfg["saida"]["exports"])
    for t in ("processos", "movimentos", "decisoes", "consolidado"):
        log.info("%s: %s registros", t, storage.count(t))

    if cfg["fontes"].get("portal"):
        try:
            coletar_detalhes(cfg, storage)  # fase longa; retomável a qualquer momento
            consolidar(cfg, storage)
            storage.export_all(cfg["saida"]["exports"])
        except Exception:
            log.exception("Portal (detalhes) falhou — o que já foi coletado está salvo.")

    for t in ("processos", "movimentos", "decisoes", "consolidado"):
        log.info("%s: %s registros", t, storage.count(t))
    log.info("Fim. Banco: %s", cfg["saida"]["db"])


if __name__ == "__main__":
    main()
