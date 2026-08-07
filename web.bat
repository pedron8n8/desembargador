@echo off
chcp 65001 >nul
cd /d "%~dp0"
set VPY=.venv\Scripts\python.exe

if not exist "%VPY%" (
  echo Ambiente virtual nao encontrado em .venv
  echo   python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt -r requirements-web.txt
  pause & exit /b 1
)

%VPY% -c "import fastapi, uvicorn" 2>nul
if errorlevel 1 (
  echo Faltam as dependencias da web. Instalando...
  %VPY% -m pip install -r requirements-web.txt || (pause & exit /b 1)
)

%VPY% -c "import sqlite3,os,sys; sys.exit(0 if os.path.exists('output/web.db') and sqlite3.connect('output/web.db').execute('SELECT count(*) FROM usuario').fetchone()[0] else 1)" 2>nul
if errorlevel 1 (
  echo.
  echo Nenhuma conta cadastrada. Crie a primeira:
  echo   %VPY% -m api.usuarios --criar voce@escritorio.com --papel admin
  echo.
  pause & exit /b 1
)

if not exist "frontend\node_modules" (
  echo Instalando dependencias do frontend...
  pushd frontend && call npm install || (popd & pause & exit /b 1)
  popd
)

REM WEB_DEV=1 tira o Secure do cookie: sem isso o navegador o descarta em http://
set WEB_DEV=1

REM --reload NAO: no Windows ele mata as threads de consulta em voo, e uma
REM consulta em voo e' dinheiro ja' gasto. Reinicie a mao quando mexer na API.
start "API - segundo cerebro" cmd /k "%VPY% -m uvicorn api.app:app --host 127.0.0.1 --port 8000"
timeout /t 2 >nul
start "Web - segundo cerebro" cmd /k "cd frontend && npm run dev"
timeout /t 4 >nul
start http://localhost:5173

echo.
echo   API  http://127.0.0.1:8000
echo   Web  http://localhost:5173
echo.
echo Feche as duas janelas para parar.
