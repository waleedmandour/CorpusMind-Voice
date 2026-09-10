# Optional Authenticode signing for CorpusMind Voice Windows installers.
#
# Called by .github/workflows/build.yml AFTER the Tauri bundle step and BEFORE
# artifact upload. Behaviour:
#
#   - Repo secrets WINDOW_PFX_BASE64 + WINDOW_PFX_PASSWORD absent:
#     prints a notice and exits 0, so OSS contributors and fork builds stay
#     unsigned exactly as before. Nothing is required to build locally.
#   - Secrets present: signs every NSIS .exe / MSI .msi under
#     src-tauri/target/*/release/bundle/ with SHA-256 and an RFC 3161
#     timestamp, then verifies the signature. A failure fails the job, so a
#     broken certificate can never ship silently.
#
# The timestamp server is contacted by the BUILD MACHINE only. The packaged
# app itself performs no network calls - the offline/privacy model is intact.
#
# Local use (optional): set CMV_SIGN_PFX_BASE64 and CMV_SIGN_PFX_PASSWORD and
# run `pwsh scripts/sign-windows.ps1` after `bun tauri build`.

$ErrorActionPreference = 'Stop'

if (-not $env:CMV_SIGN_PFX_BASE64 -or -not $env:CMV_SIGN_PFX_PASSWORD) {
    Write-Host "CMV_SIGN: no certificate secrets (WINDOW_PFX_BASE64 / WINDOW_PFX_PASSWORD) set - skipping signing, installers stay unsigned."
    exit 0
}

Write-Host "CMV_SIGN: certificate secret found - signing Windows installers."

# Decode the PFX (base64 may contain newlines from the secret editor).
$pfxPath = Join-Path $env:RUNNER_TEMP "cmv-sign.pfx"
$clean = ($env:CMV_SIGN_PFX_BASE64 -replace '\s', '')
[IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($clean))

# Locate signtool from the newest Windows SDK installed on the runner.
$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter 'signtool.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object { [version]($_.Directory.Parent.Name) } -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool) { throw "CMV_SIGN: signtool.exe not found - install the Windows SDK." }
Write-Host "CMV_SIGN: using $signtool"

$files = Get-ChildItem 'src-tauri\target' -Recurse -Include '*.exe', '*.msi' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\bundle\\(nsis|msi)\\' }
if (-not $files) { throw "CMV_SIGN: no installers found under src-tauri\target to sign." }

foreach ($file in $files) {
    Write-Host "CMV_SIGN: signing $($file.Name)"
    & $signtool sign `
        /fd SHA256 `
        /td SHA256 `
        /tr https://timestamp.digicert.com `
        /f $pfxPath `
        /p $env:CMV_SIGN_PFX_PASSWORD `
        "$($file.FullName)"
    if ($LASTEXITCODE -ne 0) { throw "CMV_SIGN: signing failed for $($file.FullName) (exit $LASTEXITCODE)." }

    & $signtool verify /pa /all "$($file.FullName)"
    if ($LASTEXITCODE -ne 0) { throw "CMV_SIGN: signature verification failed for $($file.FullName)." }
    Write-Host "CMV_SIGN: signed and verified $($file.Name)"
}

Remove-Item $pfxPath -Force
Write-Host "CMV_SIGN: done."
