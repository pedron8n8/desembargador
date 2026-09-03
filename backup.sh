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

# Garante que a aplicacao volta no ar mesmo se o tar falhar (disco de destino
# cheio, por exemplo). O trap roda o restart e depois sai com o codigo de
# saida que o script ja tinha antes do trap, para o systemd ainda marcar a
# unidade como falha quando algo deu errado.
restaurar() {
    STATUS=$?
    docker compose start app
    exit "$STATUS"
}
trap restaurar EXIT

docker compose stop app
# tjsc.db e documentos/ entram, do cerebro padrao (direto em output/) e de
# cada cerebro em output/cerebros/<slug>/: cada um custou ~12 h de coleta e
# de download de inteiro teor, respeitando os delays do TJSC, e nao voltam
# sozinhos. Ficam de fora, por cerebro: exports/ (saida bruta do scraper que
# o DEPLOY.md manda nao mover, e regeneravel a partir do tjsc.db), logs/,
# rag.db (+ -shm/-wal) e os .pkl — esses tres ultimos saem de tjsc.db em
# minutos via `indexar`/`--treinar`/`--ajustar`. O --exclude por padrao (em
# vez de listar cada cerebro) garante que um cerebro novo entra sozinho no
# proximo backup, sem editar este script.
tar czf "$ARQ" \
    --exclude='output/cerebros/*/exports' \
    --exclude='output/cerebros/*/logs' \
    --exclude='output/cerebros/*/rag.db*' \
    --exclude='output/cerebros/*/*.pkl' \
    output/web.db output/feedback.db output/rag_runs.db output/consultas \
    output/tjsc.db output/documentos output/cerebros \
    cerebros.json config.json config_rag.json

find "$DESTINO" -name 'cerebro-*.tar.gz' -mtime +30 -delete
echo "backup em $ARQ ($(du -h "$ARQ" | cut -f1))"
