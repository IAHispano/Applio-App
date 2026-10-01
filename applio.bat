@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

if /i "%~1"=="clean" (
    node "%SCRIPT_DIR%bin\applio.js" %*
    exit /b !ERRORLEVEL!
)
if /i "%~1"=="purge" (
    node "%SCRIPT_DIR%bin\applio.js" %*
    exit /b !ERRORLEVEL!
)
if /i "%~1"=="uninstall" (
    node "%SCRIPT_DIR%bin\applio.js" %*
    exit /b !ERRORLEVEL!
)

:: 1. Check virtual environments
if exist "%SCRIPT_DIR%.venv\Scripts\python.exe" (
    "%SCRIPT_DIR%.venv\Scripts\python.exe" "%SCRIPT_DIR%core.py" %*
    exit /b !ERRORLEVEL!
)
if exist "%SCRIPT_DIR%venv\Scripts\python.exe" (
    "%SCRIPT_DIR%venv\Scripts\python.exe" "%SCRIPT_DIR%core.py" %*
    exit /b !ERRORLEVEL!
)
if exist "%SCRIPT_DIR%env\Scripts\python.exe" (
    "%SCRIPT_DIR%env\Scripts\python.exe" "%SCRIPT_DIR%core.py" %*
    exit /b !ERRORLEVEL!
)

:: 2. Check PYTHON_BIN environment variable
if defined PYTHON_BIN (
    if exist "%PYTHON_BIN%" (
        "%PYTHON_BIN%" "%SCRIPT_DIR%core.py" %*
        exit /b !ERRORLEVEL!
    )
)

:: 3. Check node launcher
where node >nul 2>nul
if !ERRORLEVEL! equ 0 (
    node "%SCRIPT_DIR%bin\applio.js" %*
    exit /b !ERRORLEVEL!
)

:: 4. Fallback to py launcher or python
where py >nul 2>nul
if !ERRORLEVEL! equ 0 (
    py -3.12 -c "" >nul 2>nul
    if !ERRORLEVEL! equ 0 (
        py -3.12 "%SCRIPT_DIR%core.py" %*
        exit /b !ERRORLEVEL!
    )
    py -3.11 -c "" >nul 2>nul
    if !ERRORLEVEL! equ 0 (
        py -3.11 "%SCRIPT_DIR%core.py" %*
        exit /b !ERRORLEVEL!
    )
)

python "%SCRIPT_DIR%core.py" %*
exit /b !ERRORLEVEL!
