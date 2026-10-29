@echo off
rem Run inside "cmd /k" so the window never closes by itself and errors stay visible.
if /i "%~1"=="--inner" goto main
cmd /k call "%~f0" --inner
exit /b

:main
setlocal
title AMANOGAWA
cd /d "%~dp0"

set "PORT=8000"
set "URL=http://127.0.0.1:%PORT%/"

echo.
echo    A M A N O G A W A
echo    -----------------
echo.

rem Started from inside a ZIP archive: Windows extracts only this file.
if exist "server\app.py" goto files_ok
echo    Project files not found next to AMANOGAWA.BAT.
echo    Unpack the ZIP archive first, then run AMANOGAWA.BAT from the unpacked folder.
goto end

:files_ok
rem Find Python 3.10+. Run real code to check: on Windows the "python"
rem Store alias exists even when Python is not installed.
py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul && set "PY=py -3" && goto python
python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul && set "PY=python" && goto python

echo    Python 3.10 or newer not found - opening index.html without the knowledge base.
echo    Install Python from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
start "" "%~dp0index.html"
goto end

:python
set "VPY=%~dp0.venv\Scripts\python.exe"

rem 1. Virtual environment with RAG-Anything (first run takes a while).
if exist "%VPY%" goto venv_ok
echo    First run: creating .venv ...
%PY% -m venv .venv
if errorlevel 1 goto install_failed

:venv_ok
fc /b requirements.txt .venv\requirements.installed >nul 2>nul && goto env
echo    Installing RAG-Anything and dependencies. This can take 10+ minutes...
echo.
"%VPY%" -m pip install --upgrade pip
"%VPY%" -m pip install -r requirements.txt
if errorlevel 1 goto install_failed
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
goto end

:install_failed
echo.
echo    Could not install RAG-Anything - see the errors above.
echo    Starting the site without the knowledge base.
echo.
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" %URL%"
%PY% -m http.server %PORT% --bind 127.0.0.1

:end
echo.
echo    Press any key to close this window.
pause >nul
exit
