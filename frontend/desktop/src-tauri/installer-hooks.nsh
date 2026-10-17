; First transition from the per-user Electron installer. User data is never
; deleted or moved; old application files are archived for recovery.
!include LogicLib.nsh
!include FileFunc.nsh

!ifndef APPLIO_LEGACY_UNINSTALL_KEY
  !define APPLIO_LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\ebf34de3-7d8e-554d-9b9f-9f11c29bdf17"
!endif
!ifndef APPLIO_TAURI_PRODUCT_KEY
  !define APPLIO_TAURI_PRODUCT_KEY "Software\applio\Applio"
!endif
!ifndef APPLIO_DEFAULT_INSTALL_NAME
  !define APPLIO_DEFAULT_INSTALL_NAME "Applio"
!endif
; Tauri includes hooks before declaring its PRODUCTNAME/MANUPRODUCTKEY.
!define MUI_CUSTOMFUNCTION_GUIINIT ApplioInitializeMigration
Var ApplioLegacyDirectory
Var ApplioMigrating

Function ApplioFindLegacyDirectory
  Push $R0
  Push $R1
  Push $R2
  StrCpy $ApplioLegacyDirectory ""
  ReadRegStr $R0 HKCU "${APPLIO_LEGACY_UNINSTALL_KEY}" "UninstallString"
  StrCpy $R1 $R0 1
  ${If} $R1 == '$\"'
    StrCpy $R0 $R0 "" 1
    StrCpy $R2 0
    applio_find_quote:
      StrCpy $R1 $R0 1 $R2
      StrCmp $R1 "" applio_legacy_done
      StrCmp $R1 '$\"' applio_found_quote
      IntOp $R2 $R2 + 1
      Goto applio_find_quote
    applio_found_quote:
      StrCpy $R0 $R0 $R2
      ${GetParent} "$R0" $R1
      IfFileExists "$R1\Applio.exe" 0 applio_legacy_done
      IfFileExists "$R1\resources\app\package.json" 0 applio_legacy_done
      IfFileExists "$R1\Uninstall Applio.exe" 0 applio_legacy_done
      GetFullPathName $ApplioLegacyDirectory "$R1"
  ${EndIf}
  applio_legacy_done:
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

Function ApplioInitializeMigration
  Call ApplioFindLegacyDirectory
  ${If} $ApplioLegacyDirectory == ""
    Return
  ${EndIf}
  Push $R0
  ReadRegStr $R0 HKCU "${APPLIO_TAURI_PRODUCT_KEY}" ""
  ${If} $R0 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\${APPLIO_DEFAULT_INSTALL_NAME}"
    ; Honor an explicit target, including /D supplied by electron-updater.
    ClearErrors
    ${GetOptions} $CMDLINE "/D=" $R0
    ${If} ${Errors}
      StrCpy $INSTDIR $ApplioLegacyDirectory
    ${EndIf}
  ${EndIf}
  Pop $R0
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ; Also runs for silent updates, where .onGUIInit is not called.
  Call ApplioInitializeMigration
  GetFullPathName $INSTDIR "$INSTDIR"
  GetFullPathName $R0 "$INSTDIR\.."
  ${If} $INSTDIR == $R0
  ${OrIf} $INSTDIR == "$PROFILE"
  ${OrIf} $INSTDIR == "$DESKTOP"
  ${OrIf} $INSTDIR == "$DOCUMENTS"
  ${OrIf} $INSTDIR == "$APPDATA"
  ${OrIf} $INSTDIR == "$LOCALAPPDATA"
  ${OrIf} $INSTDIR == "$PROGRAMFILES"
  ${OrIf} $INSTDIR == "$PROGRAMFILES64"
  ${OrIf} $INSTDIR == "$WINDIR"
  ${OrIf} $INSTDIR == "$SYSDIR"
    Abort "Choose an application folder. Shared folders and drive roots cannot be used."
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      Abort "The application folder must not be a link. User data has been preserved."
    ${EndIf}
  ${EndIf}
  StrCpy $ApplioMigrating 0
  ${If} $ApplioLegacyDirectory == $INSTDIR
    ; Restart Manager targets only processes using this exact executable.
    !insertmacro CheckIfAppIsRunning "$INSTDIR\Applio.exe" "Applio (Electron)"
    StrCpy $ApplioMigrating 1
  ${EndIf}
  SetOutPath "$INSTDIR"
!macroend

!macro ApplioArchiveElectronFile name
  !define APPLIO_ARCHIVE_ID ${__LINE__}
  ${If} ${FileExists} "$INSTDIR\${name}"
  ${OrIf} ${FileExists} "$INSTDIR\${name}\*.*"
    IfFileExists "$INSTDIR\.electron-backup\${name}" applio_archive_conflict_${APPLIO_ARCHIVE_ID}
    ClearErrors
    Rename "$INSTDIR\${name}" "$INSTDIR\.electron-backup\${name}"
    IfErrors 0 applio_archive_done_${APPLIO_ARCHIVE_ID}
    applio_archive_conflict_${APPLIO_ARCHIVE_ID}:
      Abort "The new app is installed, but an old application file could not be archived. Your data is preserved; close Applio and rerun this installer."
    applio_archive_done_${APPLIO_ARCHIVE_ID}:
  ${EndIf}
  !undef APPLIO_ARCHIVE_ID
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $ApplioMigrating == 1
    ; Never follow a pre-existing backup junction into another directory.
    System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\.electron-backup") i .r0'
    ${If} $0 != -1
      IntOp $0 $0 & 0x400
      ${If} $0 != 0
        Abort "The Electron backup folder must not be a link. User data has been preserved."
      ${EndIf}
    ${EndIf}
    CreateDirectory "$INSTDIR\.electron-backup"
    !insertmacro ApplioArchiveElectronFile "resources"
    !insertmacro ApplioArchiveElectronFile "locales"
    !insertmacro ApplioArchiveElectronFile "chrome_100_percent.pak"
    !insertmacro ApplioArchiveElectronFile "chrome_200_percent.pak"
    !insertmacro ApplioArchiveElectronFile "d3dcompiler_47.dll"
    !insertmacro ApplioArchiveElectronFile "ffmpeg.dll"
    !insertmacro ApplioArchiveElectronFile "icudtl.dat"
    !insertmacro ApplioArchiveElectronFile "libEGL.dll"
    !insertmacro ApplioArchiveElectronFile "libGLESv2.dll"
    !insertmacro ApplioArchiveElectronFile "LICENSE.electron.txt"
    !insertmacro ApplioArchiveElectronFile "LICENSES.chromium.html"
    !insertmacro ApplioArchiveElectronFile "resources.pak"
    !insertmacro ApplioArchiveElectronFile "snapshot_blob.bin"
    !insertmacro ApplioArchiveElectronFile "v8_context_snapshot.bin"
    !insertmacro ApplioArchiveElectronFile "vk_swiftshader_icd.json"
    !insertmacro ApplioArchiveElectronFile "vk_swiftshader.dll"
    !insertmacro ApplioArchiveElectronFile "vulkan-1.dll"
    !insertmacro ApplioArchiveElectronFile "uninstallerIcon.ico"
    !insertmacro ApplioArchiveElectronFile "Applio.exe"
    !insertmacro ApplioArchiveElectronFile "Uninstall Applio.exe"
    DeleteRegKey HKCU "${APPLIO_LEGACY_UNINSTALL_KEY}"
    DetailPrint "Electron application files retained in .electron-backup. Existing data and Python environment reused."
  ${EndIf}
  ; Electron uses --force-run; Tauri's updater uses /R. Support the first handoff.
  ClearErrors
  ${GetOptions} $CMDLINE "--force-run" $R0
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
  ${EndIf}
!macroend
