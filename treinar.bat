@echo off
setlocal
cd /d "%~dp0"
title Treinar o segundo estimador - Segundo Cerebro

if not exist ".venv\Scripts\python.exe" (
    echo [ERRO] Ambiente nao existe. Rode run.bat uma vez primeiro.
    pause
    exit /b 1
)
set "VPY=.venv\Scripts\python.exe"

if not exist "output\rag.db" (
    echo [SETUP] Construindo o indice primeiro...
    %VPY% -X utf8 -m src.rag.indexar || (echo [ERRO] Falha ao indexar & pause & exit /b 1)
)

echo.
echo Treina o Random Forest e mede no TESTE TEMPORAL: treina ate 2023,
echo testa em 2024+. Nao gasta nada de LLM.
echo.
%VPY% -X utf8 -m src.rag.floresta --treinar

echo.
echo Para comparar os cinco arranjos nos mesmos 400 casos cegos:
echo   .venv\Scripts\python.exe -X utf8 -m src.rag.avaliar --offline -n 400 --comparar
echo.
pause >nul
