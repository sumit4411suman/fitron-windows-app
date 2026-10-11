; FITRON Gym Accounting for Windows: additions to Tauri's NSIS installer (docs/local-windows/INSTALLER.md).
;
; Nothing here, and nothing in the installer, touches the gym's data folder (%LOCALAPPDATA%\FITRON): installing,
; updating and uninstalling replace or remove only the program's own files.

; Closes a running FITRON the way its close button does, so its server finishes what it is doing and writes everything
; into fitron.db (src/lib/runtime/local-shutdown.ts), before the program's files are replaced or removed. Only if it is
; still open after 30 seconds is it ended (Tauri's own check, which runs next, would end it without waiting).
!macro FITRON_CLOSE_RUNNING
  !define FITRON_ID ${__LINE__}
  Push $R7
  Push $R8
  Push $R9
  ReadEnvStr $R8 USERNAME
  ; WM_CLOSE to FITRON's window: no /F.
  nsExec::Exec 'taskkill /IM "${MAINBINARYNAME}.exe" /FI "USERNAME eq $R8"'
  Pop $R9
  StrCpy $R7 0
  fitron_wait_${FITRON_ID}:
    nsExec::Exec 'cmd /c tasklist /FI "IMAGENAME eq ${MAINBINARYNAME}.exe" /FI "USERNAME eq $R8" /NH | find /I "${MAINBINARYNAME}.exe"'
    Pop $R9
    ${If} $R9 != 0
      nsExec::Exec 'cmd /c tasklist /FI "IMAGENAME eq fitron-node.exe" /FI "USERNAME eq $R8" /NH | find /I "fitron-node.exe"'
      Pop $R9
    ${EndIf}
    ; find answers 0 when the program is still running.
    ${If} $R9 = 0
    ${AndIf} $R7 < 60
      Sleep 500
      IntOp $R7 $R7 + 1
      Goto fitron_wait_${FITRON_ID}
    ${EndIf}
  ${If} $R9 = 0
    nsExec::Exec 'taskkill /F /IM "${MAINBINARYNAME}.exe" /FI "USERNAME eq $R8"'
    Pop $R9
    nsExec::Exec 'taskkill /F /IM fitron-node.exe /FI "USERNAME eq $R8"'
    Pop $R9
    Sleep 1000
  ${EndIf}
  Pop $R9
  Pop $R8
  Pop $R7
  !undef FITRON_ID
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro FITRON_CLOSE_RUNNING
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro FITRON_CLOSE_RUNNING
!macroend

; After an uninstall, say where the gym's data is and that it was kept. Worded to fit both a real uninstall and the one
; a newer installer runs before installing ("Uninstall before installing"). Not shown for Tauri's updater (/UPDATE)
; or silent uninstalls (/SD).
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    Push $R9
    ReadEnvStr $R9 LOCALAPPDATA
    MessageBox MB_OK|MB_ICONINFORMATION "FITRON Gym Accounting's program files were removed.$\n$\nYour gym's records were not deleted. Members, payments, invoices, expenses, documents and backups stay in:$\n$R9\FITRON$\n$\nFITRON opens them as they are when it is installed again. To remove them for good, first copy a backup somewhere safe, then delete that folder yourself." /SD IDOK
    Pop $R9
  ${EndIf}
!macroend
