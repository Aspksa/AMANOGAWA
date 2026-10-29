@echo off
setlocal
title AMANOGAWA
cd /d "%~dp0"

set "PORT=8000"
set "URL=http://localhost:%PORT%/"

echo.
echo    A M A N O G A W A
echo    -----------------
echo.

rem Find Python. Run a tiny command to make sure it really works: on Windows
rem the "python" Store alias exists even when Python is not installed.
py -3 -c "import venv" >nul 2>nul && (set "PY=py -3") && goto python
python -c "import venv" >nul 2>nul && (set "PY=python") && goto python

echo    Python not found - opening index.html directly in the browser.
echo    Install Python 3.10+ from https://www.python.org/ to enable the knowledge base.
start "" "%~dp0index.html"
goto end

:python
set "VPY=%~dp0.venv\Scripts\python.exe"

rem 1. Virtual environment with RAG-Anything (first run takes a while).
if not exist "%VPY%" (
  echo    First run: creating .venv ...
  %PY% -m venv .venv || goto static
)
fc /b requirements.txt .venv\requirements.installed >nul 2>nul && goto env
echo    Installing RAG-Anything and dependencies. This can take 10+ minutes...
"%VPY%" -m pip install --upgrade pip
"%VPY%" -m pip install -r requirements.txt || goto static
copy /y requirements.txt .venv\requirements.installed >nul

:env
rem 2. Settings (Cloud.ru key, models) live in .env on this computer.
rem    They are edited on the site: Settings page (gear icon).
if not exist ".env" copy /y ".env.example" ".env" >nul

rem 3. Site + knowledge base API.
echo.
echo    Starting AMANOGAWA: %URL%
echo    Close this window to stop the server.
echo.
set "OPEN_BROWSER=1"
"%VPY%" -m server
echo.
echo    Server stopped. If it failed, port %PORT% may be busy - see the messages above.
pause
goto end

:static
echo.
echo    Could not install RAG-Anything - starting the site without the knowledge base.
echo.
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" %URL%"
%PY% -m http.server %PORT% --bind 127.0.0.1
pause

:end
endlocal
