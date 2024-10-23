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

REM Deactivate the virtual environment (Windows only)
call .\env\Scripts\deactivate

REM Build the server (use CMD, not PowerShell)
pyinstaller --onefile --icon=logo.ico --noconsole server.py
copy dist\server.exe ..\desktop\src-tauri\python\server.exe

REM Return to the root folder of the project
cd ../..

REM Create the .env file with Supabase keys (replace with your real values)
echo VITE_API_KEY=your_supabase_api_key > .env
echo VITE_API_URL=your_supabase_url >> .env

REM Run the desktop application
pnpm tauri dev

echo -----------------------------------
echo   Installation Completed
echo -----------------------------------
pause
