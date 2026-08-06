@echo off
setlocal
cd /d "%~dp0"
title Segundo Cerebro - Des. Rubens Schulz

REM ---------- 1) Ambiente ----------
if not exist ".venv\Scripts\python.exe" (
    echo [ERRO] Ambiente nao existe. Rode run.bat uma vez primeiro.
    pause
    exit /b 1
)
set "VPY=.venv\Scripts\python.exe"

fc /b requirements.txt .venv\requirements.instalado >nul 2>nul
if errorlevel 1 (
    echo [SETUP] Instalando dependencias...
    %VPY% -m pip install -r requirements.txt -q || (echo [ERRO] pip install falhou & pause & exit /b 1)
    copy /y requirements.txt .venv\requirements.instalado >nul
)

REM ---------- 2) Chave do OpenRouter ----------
findstr /b /c:"OPENROUTER_API_KEY=" .env >nul 2>nul
if errorlevel 1 (
    echo.
    echo [ERRO] Falta a chave do OpenRouter.
    echo   1. Crie em: https://openrouter.ai/keys
    echo   2. Abra o arquivo .env e acrescente a linha:
    echo        OPENROUTER_API_KEY=sk-or-v1-...
    echo.
    pause
    exit /b 1
)

REM ---------- 3) Indice (so' constroi se faltar) ----------
if not exist "output\rag.db" (
    echo [SETUP] Construindo o indice de busca... leva uns 3 minutos, e' so' uma vez.
    %VPY% -X utf8 -m src.rag.indexar || (echo [ERRO] Falha ao indexar & pause & exit /b 1)
)

REM ---------- 3b) Segundo estimador (Random Forest) ----------
if not exist "output\floresta.pkl" (
    echo [SETUP] Treinando o segundo estimador... ~2 minutos, e' so' uma vez.
    %VPY% -X utf8 -m src.rag.floresta --treinar || echo [AVISO] Sem a floresta o sistema roda so' com o k-NN.
)

REM ---------- 4) Consulta ----------
REM Uso:  consultar.bat  caso.txt  [--so-prognostico] [--classe "Apelacao Civel"]
REM Sem argumento: cola o texto no terminal e termina com uma linha FIM.
echo.
%VPY% -X utf8 -m src.rag.cli %*

echo.
echo [FIM] Pressione qualquer tecla para fechar.
pause >nul
