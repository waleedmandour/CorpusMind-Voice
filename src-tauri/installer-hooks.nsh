; CorpusMind Voice - NSIS installer hooks (Tauri 2 bundle.windows.nsis.installerHooks).
;
; The app runs a bundled node.exe sidecar that hosts the local Next.js server.
; If the app (or an older version's orphaned sidecar) is still running, Windows
; locks node.exe and the Prisma query engine DLL and the installer fails with
; "Error opening file for writing". Close every CorpusMind Voice related
; process BEFORE any file operation, for install and uninstall alike.
;
; Path-matching hardening: the install directory is passed to PowerShell via
; the CMV_INSTALL_DIR environment variable (SetEnvironmentVariable) instead of
; being interpolated into the command string. The PowerShell command itself is
; a fixed literal, so spaces in "C:\Program Files\CorpusMind Voice", localized
; Program Files folder names, user names with apostrophes (O'Brien) and
; non-ASCII characters can never break parsing.

!macro CMV_STOP_PROCESSES
  DetailPrint "Closing CorpusMind Voice if it is running..."

  ; Main window process: graceful close first, then force.
  nsExec::Exec 'taskkill /IM "CorpusMind Voice.exe" /T'
  Sleep 600
  nsExec::Exec 'taskkill /IM "CorpusMind Voice.exe" /T /F'
  Sleep 400

  ; Bundled Node sidecar: kill node.exe ONLY when its image lives in the
  ; install directory, so the user's own Node.js processes are never touched.
  System::Call 'kernel32::SetEnvironmentVariable(t"CMV_INSTALL_DIR", t"$INSTDIR")'
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$target = Join-Path $$env:CMV_INSTALL_DIR 'node.exe'; Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and ($$_.Path -ieq $$target) } | Stop-Process -Force"`
  Sleep 400

  ; Belt and braces: also stop sidecars running from a subfolder of the
  ; install directory (future layouts), still scoped to our own folder only.
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$root = $$env:CMV_INSTALL_DIR; Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$root, [System.StringComparison]::OrdinalIgnoreCase) -and ($$_.Path -ine (Join-Path $$root 'node.exe')) } | Stop-Process -Force"`
  Sleep 400

  System::Call 'kernel32::SetEnvironmentVariable(t"CMV_INSTALL_DIR", t"")'
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CMV_STOP_PROCESSES
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CMV_STOP_PROCESSES
!macroend
