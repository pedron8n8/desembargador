@echo off
setlocal
cd /d "%~dp0"
title Treinar o segundo estimador - Segundo Cerebro

REM Uso:  treinar.bat                       (o cerebro padrao)
REM       treinar.bat --cerebro SLUG        (outro desembargador)
REM Quais existem:  .venv\Scripts\python -m src.cerebros
REM
REM Sempre pelo python da .venv: o scikit-learn mora la', e nao no python do
REM sistema. Rodar "python -m src.rag.floresta" direto no terminal pega o
REM interpretador global e falha dizendo que falta scikit-learn.

if not exist ".venv\Scripts\python.exe" (
    echo [ERRO] Ambiente nao existe. Rode run.bat uma vez primeiro.
    pause
    exit /b 1
)
set "VPY=.venv\Scripts\python.exe"

echo.
echo Treina o Random Forest e mede no TESTE TEMPORAL: treina ate o ano de corte
echo do cerebro (cerebros.json) e testa nos anos seguintes. Nao gasta LLM.
echo.
%VPY% -X utf8 -m src.rag.floresta --treinar %*
if errorlevel 1 (
    echo.
    echo [ERRO] Treino falhou. Se faltar o indice:
    echo   %VPY% -X utf8 -m src.rag.indexar %*
    pause
    exit /b 1
)

echo.
echo Depois da floresta vem o calibrador ^(pode recusar por amostra, e recusar
echo e' o certo^):
echo   %VPY% -X utf8 -m src.rag.calibrar --ajustar %*
echo.
echo Para comparar os cinco arranjos nos mesmos 400 casos cegos:
echo   %VPY% -X utf8 -m src.rag.avaliar --offline -n 400 --comparar %*
echo.
pause >nul
