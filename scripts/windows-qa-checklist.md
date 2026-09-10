# Windows installer / sidecar QA checklist

Manual repro script for the failure modes fixed by the installer hardening
(worklog Task 9, v1.2.1; Task 10, v1.2.2). Run on a real Windows machine or
VM against a freshly built `*-setup.exe`. Every step lists the exact command;
none of them need admin rights unless noted.

## 1. The original bug repro (orphaned sidecar, pre-1.2.1 builds)

Confirms the sidecar-kill + installer-hook fix end to end. When run against a
v1.2.0 or earlier installer, step 5 reproduces "Error opening file for
writing"; against v1.2.1+ it must stay silent.

1. Install the build under test normally.
2. Launch "CorpusMind Voice" from the Start menu and wait for the UI.
3. Find the sidecar and the shell processes:

   ```powershell
   Get-Process node, "CorpusMind Voice" -ErrorAction SilentlyContinue |
     Select-Object Name, Id, Path
   ```

   Expect one `node.exe` whose `Path` is inside the install folder and one
   `CorpusMind Voice.exe`.
4. **Force-kill the parent only** (simulates a crashed shell):

   ```powershell
   taskkill /F /IM "CorpusMind Voice.exe"
   Start-Sleep -Seconds 2
   Get-Process node -ErrorAction SilentlyContinue | Measure-Object | % Count
   ```

   v1.2.1+: the count must drop to 0 within about a second (Job Object +
   RunEvent::Exit cleanup). Pre-1.2.1: the orphaned `node.exe` remains.
5. Run the same installer again over the installed copy. With the hook
   hardening, there must be **no** "Error opening file for writing" dialog at
   any point; the installer closes leftovers itself and completes.
6. After the second install, launch the app once more and verify
   transcription still works (upload a short WAV; expect a real transcript).

## 2. Localized / spaced install paths

The hook matches the sidecar path via the `CMV_INSTALL_DIR` environment
variable, never by string interpolation, so it must be robust to spaces,
apostrophes and non-ASCII names.

1. Install to a path containing spaces and a non-ASCII character, e.g.
   `D:\Corpus Tests\CorpusMind Vöz\` (choose per-machine install in the NSIS
   wizard to get a custom directory field; needs admin).
2. Repeat steps 2-5 above.
3. Confirm no "Error opening file for writing" dialog and that Task Manager
   shows the `node.exe` from that exact folder being closed on app exit.
4. Uninstall from the same path; confirm the folder is removed cleanly.

## 3. User's own Node must never be touched

1. Start a long-lived unrelated Node process:

   ```powershell
   Start-Process node -ArgumentList "-e", "setInterval(()=>{},1<<30)"
   $mine = (Get-Process node)[0].Id
   ```

2. Run the installer upgrade over an existing install (step 5 above).
3. After the installer finishes:

   ```powershell
   Get-Process -Id $mine -ErrorAction SilentlyContinue
   ```

   The process must still be alive. The hook only kills `node.exe` images
   whose path is inside the install directory.

## 4. Upgrade path + clean uninstall (release gate)

1. Install the previous release, upload a clip, transcribe it, quit.
2. Install the new build over it without touching anything else.
3. Verify: the corpus from step 1 is intact, the app boots, a new recording
   transcribes, an export downloads, and closing the app leaves no `node.exe`
   in Task Manager.
4. Uninstall; confirm the install folder is gone and the app data folder
   (`%APPDATA%\..\Local\CorpusMind Voice`) remains (models + corpus survive
   reinstalls by design).

## 5. Signing verification (only when certificate secrets are configured)

```powershell
$signtool = (Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe |
  Where-Object { $_.FullName -match '\\x64\\' } | Select -First 1).FullName
& $signtool verify /pa /all ".\CorpusMind.Voice_<version>_x64-setup.exe"
```

Expect "Successfully verified" and the publisher name from the certificate.
Without secrets the build stays unsigned and SmartScreen shows the standard
"Windows protected your PC" prompt - documented in the user guide, section 1.
