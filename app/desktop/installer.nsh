; Applio Custom NSIS Installer & Uninstaller Script
; Fully cleans all Applio traces, caches, background processes, shortcuts, and AppData.

!include "LogicLib.nsh"

; -----------------------------------------------------------------------------
; customUnInit: Runs during uninstaller initialization (Function un.onInit)
; -----------------------------------------------------------------------------
!macro customUnInit
  DetailPrint "Terminating running Applio processes..."
  
  ; Terminate Applio executable tree (Electron, Node server, Python backend)
  nsExec::Exec 'taskkill /F /IM "Applio.exe" /T'
  
  ; Terminate any background Python/worker processes spawned from Applio folders
  nsExec::Exec 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | Where-Object { ($$_.ExecutablePath -like ''*\Applio\*'') -and ($$_.ProcessId -ne $$PID) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"'

  ; Short delay to ensure OS releases file locks
  Sleep 600
!macroend

; -----------------------------------------------------------------------------
; customInstall: Runs after installation files are unpacked
; -----------------------------------------------------------------------------
!macro customInstall
  ; Clean stale updater installer payloads and temporary download artifacts
  RMDir /r "$LocalAppData\applio-updater"
  RMDir /r "$LocalAppData\Applio-updater"
  Delete "$TEMP\Applio*.*"
  Delete "$TEMP\applio*.*"
  Delete "$TEMP\VC_redist.x64.exe"
  Delete "$TEMP\python-3.12.9-installer.exe"
!macroend

; -----------------------------------------------------------------------------
; customUnInstall: Runs during uninstallation to wipe all traces
; -----------------------------------------------------------------------------
!macro customUnInstall
  DetailPrint "Cleaning Applio user data, caches, and leftover files..."

  ; 1. Ensure any lingering processes are terminated
  nsExec::Exec 'taskkill /F /IM "Applio.exe" /T'
  nsExec::Exec 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | Where-Object { ($$_.ExecutablePath -like ''*\Applio\*'') -and ($$_.ProcessId -ne $$PID) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"'
  Sleep 400

  ; 2. Wipe Roaming AppData (User Data, .venv with PyTorch/CUDA, logs, models, caches, window-state)
  SetShellVarContext current
  RMDir /r "$APPDATA\Applio"
  RMDir /r "$APPDATA\applio"
  RMDir /r "$APPDATA\@applio"
  RMDir /r "$APPDATA\applio-desktop"
  RMDir /r "$APPDATA\AI Hispano\Applio"
  RMDir "$APPDATA\AI Hispano"

  ; 3. Wipe Local AppData (Updater cache, logs, crash dumps, per-user program folder)
  RMDir /r "$LocalAppData\Applio"
  RMDir /r "$LocalAppData\applio"
  RMDir /r "$LocalAppData\applio-updater"
  RMDir /r "$LocalAppData\Applio-updater"
  RMDir /r "$LocalAppData\Programs\Applio"

  ; 4. Wipe User Profile traces
  RMDir /r "$PROFILE\.applio"
  RMDir /r "$PROFILE\.cache\applio"

  ; 5. Clean Temporary directories and leftover setup files
  RMDir /r "$TEMP\Applio"
  RMDir /r "$TEMP\applio"
  Delete "$TEMP\Applio*.*"
  Delete "$TEMP\applio*.*"
  Delete "$TEMP\VC_redist.x64.exe"
  Delete "$TEMP\python-3.12.9-installer.exe"
  RMDir /r "$LocalAppData\Temp\Applio"
  RMDir /r "$LocalAppData\Temp\applio"
  Delete "$LocalAppData\Temp\Applio*.*"
  Delete "$LocalAppData\Temp\applio*.*"

  ; 6. Clean Desktop, Start Menu, Startup, and Taskbar shortcuts (Current User)
  Delete "$DESKTOP\Applio.lnk"
  Delete "$SMPROGRAMS\Applio.lnk"
  RMDir /r "$SMPROGRAMS\Applio"
  Delete "$SMSTARTUP\Applio.lnk"
  Delete "$QUICKLAUNCH\Applio.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Applio.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\Applio.lnk"

  ; Clean All Users shortcuts if present
  SetShellVarContext all
  Delete "$DESKTOP\Applio.lnk"
  Delete "$SMPROGRAMS\Applio.lnk"
  RMDir /r "$SMPROGRAMS\Applio"
  Delete "$SMSTARTUP\Applio.lnk"
  SetShellVarContext current

  ; 7. Clean Registry entries
  DeleteRegKey HKCU "Software\Applio"
  DeleteRegKey HKCU "Software\applio"
  DeleteRegKey HKCU "Software\AI Hispano\Applio"
  DeleteRegKey HKCU "Software\AI Hispano"
  DeleteRegKey HKCU "Software\Classes\Applio"
  DeleteRegKey HKCU "Software\Classes\AppId\org.applio.app"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Applio"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Applio"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\org.applio.app"

  DeleteRegKey HKLM "Software\Applio"
  DeleteRegKey HKLM "Software\applio"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Applio"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\org.applio.app"

  ; 8. Ensure the entire installation directory ($INSTDIR) is purged cleanly
  ${if} $INSTDIR != ""
  ${andIf} $INSTDIR != "C:\"
  ${andIf} $INSTDIR != "C:"
  ${andIf} $INSTDIR != "$PROFILE"
  ${andIf} $INSTDIR != "$APPDATA"
  ${andIf} $INSTDIR != "$LocalAppData"
  ${andIf} $INSTDIR != "$PROGRAMFILES"
  ${andIf} $INSTDIR != "$PROGRAMFILES64"
    RMDir /r "$INSTDIR"
  ${endif}

  ; 9. Refresh Windows shell notification & icon caches
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend
