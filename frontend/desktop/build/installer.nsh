; Preserve user data in the chosen installation folder, including during updates.
!include "LogicLib.nsh"

!macro customUnInit
  ; Stop only the app executable tree; never other Python installations.
  nsExec::Exec 'taskkill /F /IM "Applio.exe" /T'
  Sleep 600
!macroend

; electron-builder invokes this BEFORE customUnInstall. Its default removal
; deletes all of $INSTDIR even during updates, so data must be excluded here.
; Keep the normal atomic rename/restore behavior for replaceable application files.
!macro customRemoveFiles
  GetFullPathName $R0 "$INSTDIR"
  GetFullPathName $R1 "$R0\.."
  ${if} $INSTDIR == ""
  ${orIf} $R0 == $R1
  ${orIf} $R0 == "$PROFILE"
  ${orIf} $R0 == "$DESKTOP"
  ${orIf} $R0 == "$DOCUMENTS"
  ${orIf} $R0 == "$APPDATA"
  ${orIf} $R0 == "$LocalAppData"
  ${orIf} $R0 == "$PROGRAMFILES"
  ${orIf} $R0 == "$PROGRAMFILES64"
  ${orIf} $R0 == "$WINDIR"
  ${orIf} $R0 == "$SYSDIR"
    Abort "Applio cannot remove files from a drive root or shared system folder."
  ${endif}
  InitPluginsDir
  CreateDirectory "$PLUGINSDIR\old-install"
  FindFirst $R4 $R5 "$INSTDIR\*.*"
  applio_remove_loop:
    StrCmp $R5 "" applio_remove_done
    StrCmp $R5 "." applio_remove_next
    StrCmp $R5 ".." applio_remove_next
    StrCmp $R5 "data" applio_remove_next
    ; Retain legacy models stored directly in the installation folder too.
    StrCmp $R5 "logs" applio_remove_next
    ; Only remove shipped Electron files. Unrelated user files/folders remain.
    StrCmp $R5 "resources" applio_remove_owned
    StrCmp $R5 "locales" applio_remove_owned
    StrCmp $R5 "Applio.exe" applio_remove_owned
    StrCmp $R5 "${UNINSTALL_FILENAME}" applio_remove_owned
    StrCmp $R5 "chrome_100_percent.pak" applio_remove_owned
    StrCmp $R5 "chrome_200_percent.pak" applio_remove_owned
    StrCmp $R5 "d3dcompiler_47.dll" applio_remove_owned
    StrCmp $R5 "ffmpeg.dll" applio_remove_owned
    StrCmp $R5 "icudtl.dat" applio_remove_owned
    StrCmp $R5 "libEGL.dll" applio_remove_owned
    StrCmp $R5 "libGLESv2.dll" applio_remove_owned
    StrCmp $R5 "LICENSE.electron.txt" applio_remove_owned
    StrCmp $R5 "LICENSES.chromium.html" applio_remove_owned
    StrCmp $R5 "resources.pak" applio_remove_owned
    StrCmp $R5 "snapshot_blob.bin" applio_remove_owned
    StrCmp $R5 "v8_context_snapshot.bin" applio_remove_owned
    StrCmp $R5 "vk_swiftshader_icd.json" applio_remove_owned
    StrCmp $R5 "vk_swiftshader.dll" applio_remove_owned
    StrCmp $R5 "vulkan-1.dll" applio_remove_owned
    Goto applio_remove_next
  applio_remove_owned:
    IfFileExists "$INSTDIR\$R5\*.*" applio_remove_directory applio_remove_file
  applio_remove_directory:
    CreateDirectory "$PLUGINSDIR\old-install\$R5"
    Push "\$R5"
    Call un.atomicRMDir
    Pop $R0
    StrCmp $R0 "0" 0 applio_remove_failed
    RMDir /r "$INSTDIR\$R5"
    Goto applio_remove_next
  applio_remove_file:
    ClearErrors
    Rename "$INSTDIR\$R5" "$PLUGINSDIR\old-install\$R5"
    StrCmp $R5 "${UNINSTALL_FILENAME}" 0 +2
    ClearErrors
    IfErrors applio_remove_failed
  applio_remove_next:
    FindNext $R4 $R5
    Goto applio_remove_loop
  applio_remove_failed:
    FindClose $R4
    Push ""
    Call un.restoreFiles
    Pop $R0
    Abort "An Applio file is busy. Close Applio and try again; your data has been preserved."
  applio_remove_done:
    FindClose $R4
    ; This succeeds only when no preserved data remains.
    RMDir "$INSTDIR"
!macroend

!macro customUnInstall
  DetailPrint "Applio data and models have been retained in $INSTDIR\data."
!macroend
