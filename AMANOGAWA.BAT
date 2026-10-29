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
call :find_python
if defined PY goto python

rem No Python: install it with winget (built into Windows 10/11).
echo    Python 3.10+ not found. Installing Python 3.12 with winget - this takes a few minutes...
echo.
where winget >nul 2>nul || goto no_python
winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
call :find_python
if defined PY goto python

:no_python
echo.
echo    Could not find or install Python automatically.
echo    1. Download Python 3.12 from https://www.python.org/downloads/
echo    2. In the installer tick "Add python.exe to PATH" and press Install Now.
echo    3. Run AMANOGAWA.BAT again.
echo.
echo    Without Python the site opens as a file: chat, documents and settings will not work.
start "" "%~dp0index.html"
goto end

:python
echo    Python: %PY%
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

rem Sets PY to a working Python 3.10+ command, or leaves it empty.
rem Each candidate runs real code: the "python" Store alias exists even without Python.
:find_python
set "PY="
py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul && set "PY=py -3" && exit /b
python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul && set "PY=python" && exit /b
rem Not in PATH: look where installers put Python (registry first, then usual folders).
for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Python\PythonCore" /s /v ExecutablePath 2^>nul ^| findstr /i "ExecutablePath"') do call :try_py "%%B"
for /f "tokens=2,*" %%A in ('reg query "HKLM\Software\Python\PythonCore" /s /v ExecutablePath 2^>nul ^| findstr /i "ExecutablePath"') do call :try_py "%%B"
for /f "tokens=2,*" %%A in ('reg query "HKLM\Software\WOW6432Node\Python\PythonCore" /s /v ExecutablePath 2^>nul ^| findstr /i "ExecutablePath"') do call :try_py "%%B"
for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Python\PythonCore" /s /ve 2^>nul ^| findstr /i "REG_SZ"') do call :try_py "%%Bpython.exe"
for /f "tokens=2,*" %%A in ('reg query "HKLM\Software\Python\PythonCore" /s /ve 2^>nul ^| findstr /i "REG_SZ"') do call :try_py "%%Bpython.exe"
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do call :try_py "%%D\python.exe"
for /d %%D in ("%ProgramFiles%\Python3*") do call :try_py "%%D\python.exe"
for /d %%D in ("C:\Python3*") do call :try_py "%%D\python.exe"
call :try_py "%LOCALAPPDATA%\Programs\Python\Launcher\py.exe"
call :try_py "%WINDIR%\py.exe"
exit /b

rem Uses %1 as PY if it exists and is Python 3.10+.
:try_py
if defined PY exit /b
if not exist "%~1" exit /b
"%~1" -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul || exit /b
set PY="%~1"
exit /b
