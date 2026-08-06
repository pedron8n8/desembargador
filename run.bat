@echo off
setlocal
cd /d "%~dp0"
title Scraper TJSC - Decisoes por Desembargador

REM ---------- 1) Python instalado? ----------
where python >nul 2>nul
if errorlevel 1 (
    where py >nul 2>nul
    if errorlevel 1 (
        echo [ERRO] Python nao encontrado.
        echo Instale em: https://www.python.org/downloads/  ^(marque "Add Python to PATH"^)
        pause
        exit /b 1
    )
    set "PY=py"
) else (
    set "PY=python"
)

REM ---------- 2) Virtualenv ----------
if not exist ".venv\Scripts\python.exe" (
    echo [SETUP] Criando ambiente virtual...
    %PY% -m venv .venv || (echo [ERRO] Falha criando a venv & pause & exit /b 1)
)
set "VPY=.venv\Scripts\python.exe"

REM ---------- 3) Dependencias (so instala se requirements mudou) ----------
fc /b requirements.txt .venv\requirements.instalado >nul 2>nul
if errorlevel 1 (
    echo [SETUP] Instalando dependencias...
    %VPY% -m pip install --upgrade pip -q
    %VPY% -m pip install -r requirements.txt || (echo [ERRO] Falha no pip install & pause & exit /b 1)
    copy /y requirements.txt .venv\requirements.instalado >nul
)

REM ---------- 4) Executa (parametros opcionais sao repassados) ----------
REM Uso: run.bat  ["Nome do Relator"]  [data-inicio]  [data-fim]
REM      run.bat  --recoletar          (varre tudo de novo, para pegar decisoes novas)
set "ARGS="
if "%~1"=="--recoletar" (
    set "ARGS=--recoletar"
) else (
    if not "%~1"=="" set ARGS=--relator "%~1"
    if not "%~2"=="" set ARGS=%ARGS% --data-inicio %~2
    if not "%~3"=="" set ARGS=%ARGS% --data-fim %~3
)

echo.
echo [RUN] Iniciando coleta... (config em config.json; logs em output\logs\)
%VPY% -m src.main %ARGS%

echo.
echo [FIM] Pressione qualquer tecla para fechar.
pause >nul
