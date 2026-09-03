#!/bin/sh
# Backup do que NAO se regenera sozinho. Roda com a aplicacao parada porque o
# SQLite em WAL pode estar no meio de uma transacao.
#
#     sh backup.sh /root/backups
#
# Chamado pelo systemd timer descrito em DEPLOY.md. Sai != 0 se algo falhar,
# para o timer marcar a unidade como falha em vez de silenciar.
set -e
cd "$(dirname "$0")"
DESTINO="${1:-/root/backups}"
mkdir -p "$DESTINO"
ARQ="$DESTINO/cerebro-$(date +%F-%H%M).tar.gz"

docker compose stop app
# O acervo entra. COMO_RODAR.md sempre disse que tjsc.db "custou horas de
# scraping" e nao e' reconstruivel; o DEPLOY.md dizia o contrario e o deixava
# de fora. Sao ~12 h de coleta por cerebro, respeitando os delays do TJSC.
tar czf "$ARQ" \
    output/web.db output/feedback.db output/rag_runs.db output/consultas \
    output/tjsc.db output/cerebros cerebros.json config.json config_rag.json
docker compose start app

# rag.db e os .pkl ficam de fora de proposito: saem de tjsc.db por
# `indexar`/`--treinar` em minutos, e sao a maior parte do volume.
find "$DESTINO" -name 'cerebro-*.tar.gz' -mtime +30 -delete
echo "backup em $ARQ ($(du -h "$ARQ" | cut -f1))"
