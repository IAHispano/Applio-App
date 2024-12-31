@echo off
REM Title: Applio App Installer For Devs
REM Description: This script automates the installation of Applio App.

echo -----------------------------------
echo   Installing Applio App
echo -----------------------------------

REM Install dependencies for the desktop app
pnpm install --filter=desktop

REM Navigate to the server folder
cd apps\server

REM Set up the virtual environment
py -m venv env

REM Activate the virtual environment (Windows only)
call .\env\Scripts\activate

REM Install server dependencies
pip install -r requirements.txt

REM Build the server (use CMD, not PowerShell)
pyinstaller --onefile --icon=logo.ico --noconsole server.py
copy dist\server.exe ..\desktop\src-tauri\python\server.exe

REM Deactivate the virtual environment
call .\env\Scripts\deactivate

REM Return to the root folder of the project
cd ../..

REM Check if .env file already exists; if not, copy .env.example to .env
IF NOT EXIST .env (
    echo Copying .env.example to .env
    copy .env.example .env
    echo Please open the .env file and fill in the required information.
    pause
)

REM Run the desktop application
pnpm tauri dev

echo -----------------------------------
echo   Installation Completed
echo -----------------------------------
pause
