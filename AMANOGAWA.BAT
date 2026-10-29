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

rem Try to start a local web server (Python). Otherwise open the file directly.
rem Run a tiny command to make sure Python really works: on Windows the
rem "python" Store alias exists even when Python is not installed.
py -3 -c "import http.server" >nul 2>nul && (set "PY=py -3") && goto serve
python -c "import http.server" >nul 2>nul && (set "PY=python") && goto serve

echo    Python not found - opening index.html directly in the browser.
start "" "%~dp0index.html"
goto end

:serve
echo    Starting local server: %URL%
echo    Close this window to stop the server.
echo.
rem Open the browser after a short pause so the server has time to start.
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" %URL%"
%PY% -m http.server %PORT% --bind 127.0.0.1
echo.
echo    Server stopped. If it failed, port %PORT% may be busy.
pause

:end
endlocal
