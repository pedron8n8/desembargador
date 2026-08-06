@echo off
setlocal
cd /d "%~dp0"
title Qualificar resposta - Segundo Cerebro

if not exist ".venv\Scripts\python.exe" (
    echo [ERRO] Ambiente nao existe. Rode run.bat uma vez primeiro.
    pause
    exit /b 1
)

REM Sem argumento: qualifica a ultima consulta, perguntando nota e comentario.
REM   qualificar.bat --relatorio                     ve a concordancia juiz x voce
REM   qualificar.bat --thread X --nota 4 --inutil 12 34
.venv\Scripts\python.exe -X utf8 -m src.rag.feedback %*

echo.
pause >nul
