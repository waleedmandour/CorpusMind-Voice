; CorpusMind Voice - NSIS installer hooks (Tauri 2 bundle.windows.nsis.installerHooks).
;
; The app runs a bundled node.exe sidecar that hosts the local Next.js server.
; If the app (or an older version's orphaned sidecar) is still running, Windows
; locks node.exe and the Prisma query engine DLL and the installer fails with
; "Error opening file for writing". Close every CorpusMind Voice related
; process BEFORE any file operation, for install and uninstall alike.

!macro CMV_STOP_PROCESSES
  DetailPrint "Closing CorpusMind Voice if it is running..."

  ; Main window process: graceful close first, then force.
  nsExec::Exec 'taskkill /IM "CorpusMind Voice.exe" /T'
  Sleep 600
  nsExec::Exec 'taskkill /IM "CorpusMind Voice.exe" /T /F'
  Sleep 400

  ; Bundled Node sidecar: kill node.exe ONLY when its image lives inside
  ; $INSTDIR, so the user's own Node.js processes are never touched.
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -eq '$INSTDIR\node.exe' } | Stop-Process -Force"`
  Sleep 400
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CMV_STOP_PROCESSES
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CMV_STOP_PROCESSES
!macroend
