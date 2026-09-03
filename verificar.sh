#!/bin/sh
# Porte POSIX do verificar.bat, para rodar dentro do container:
#
#     docker compose exec app sh verificar.sh
#
# Sem a parte do frontend: no container de runtime nao ha' Node. O tsc --noEmit
# e o build do Vite ja' rodaram no estagio `web` do Dockerfile — build que passa
# e' frontend que compila.
cd "$(dirname "$0")" || exit 1
PY="${PY:-python}"
FALHOU=0

roda() {
  echo
  echo "--- $*"
  # shellcheck disable=SC2086
  $PY -X utf8 -m "$@" || FALHOU=1
}

echo "=== cerebros (quem julga) ==="
roda src.cerebros
roda src.storage
roda src.datajud
roda src.merge
roda src.portal_jurisprudencia

echo
echo "=== modulos de dominio (src/rag) ==="
# 'indexar' NAO entra: nao e' self-check, e' o construtor do indice. Rodar aqui
# apagaria o rag.db e o reconstruiria em ~4,5 min.
for m in llm busca rerank sinais classificador confianca calibrar floresta \
         grafo rede estatisticas conversa feedback juiz cli; do
  roda "src.rag.$m"
done

echo
echo "=== camada web (api/) ==="
for m in esquema auth serial execucao smoke; do
  roda "api.$m"
done

# 'servir' fica de fora do laco: o __main__ dele SOBE o servidor.
roda api.servir --self-check

echo
if [ "$FALHOU" = 1 ]; then
  echo "================  ALGO FALHOU  ================"
  exit 1
fi
echo "================  TUDO OK  ================"
