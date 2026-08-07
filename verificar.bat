@echo off
chcp 65001 >nul
cd /d "%~dp0"
set VPY=.venv\Scripts\python.exe
set FALHOU=0

echo === modulos de dominio (src/rag) ===
REM 'indexar' NAO entra: nao e' self-check, e' o construtor do indice. Rodar
REM aqui apagaria output/rag.db e o reconstruiria em ~4,5 min.
for %%m in (llm busca rerank sinais classificador confianca calibrar floresta
            grafo rede estatisticas conversa feedback juiz cli) do (
  echo.
  echo --- src.rag.%%m
  %VPY% -X utf8 -m src.rag.%%m || set FALHOU=1
)

echo.
echo === camada web (api/) ===
for %%m in (esquema auth serial execucao smoke) do (
  echo.
  echo --- api.%%m
  %VPY% -X utf8 -m api.%%m || set FALHOU=1
)

REM 'servir' fica de fora do laco: o __main__ dele SOBE o servidor. O
REM self-check dele e' explicito.
echo.
echo --- api.servir
%VPY% -X utf8 -m api.servir --self-check || set FALHOU=1

echo.
echo === frontend (frontend/) ===
if exist "frontend\node_modules" (
  pushd frontend
  call npx tsc --noEmit || set FALHOU=1
  call npx stylelint "src/**/*.css" || set FALHOU=1
  popd
) else (
  echo   pulado: rode "npm install" em frontend\ primeiro
)

echo.
if "%FALHOU%"=="1" (
  echo ================  ALGO FALHOU  ================
  exit /b 1
)
echo ================  TUDO OK  ================
