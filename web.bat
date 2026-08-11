@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Invólucro de `python -m api.servir` — a lógica toda está lá, para não
REM existirem duas versões do "como subir" divergindo com o tempo.
REM
REM   web.bat                      API + Vite, log dos dois neste terminal
REM   web.bat --prod               serve o frontend construído pelo uvicorn
REM   web.bat --api                só a API
REM   web.bat --porta 8080         troca a porta (o proxy do Vite acompanha)
REM
REM Ctrl+C para parar os dois.

set "VPY=.venv\Scripts\python.exe"
if not exist "%VPY%" (
  echo Ambiente virtual nao encontrado em .venv
  echo   python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt -r requirements-web.txt
  pause & exit /b 1
)

"%VPY%" -X utf8 -m api.servir %*
set CODIGO=%ERRORLEVEL%
if not "%CODIGO%"=="0" pause
exit /b %CODIGO%
