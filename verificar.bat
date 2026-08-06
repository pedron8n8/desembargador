@echo off
chcp 65001 >nul
cd /d "%~dp0"
set VPY=.venv\Scripts\python.exe
set FALHOU=0

echo === modulos de dominio (src/rag) ===
for %%m in (llm busca rerank sinais classificador confianca calibrar floresta
            grafo rede estatisticas conversa feedback) do (
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

echo.
echo === frontend (web/) ===
if exist "web\node_modules" (
  pushd web
  call npx tsc --noEmit || set FALHOU=1
  call npx stylelint "src/**/*.css" || set FALHOU=1
  popd
) else (
  echo   pulado: rode "npm install" em web\ primeiro
)

echo.
if "%FALHOU%"=="1" (
  echo ================  ALGO FALHOU  ================
  exit /b 1
)
echo ================  TUDO OK  ================
