# Update the installed Windows agent from this checkout's verified distribution.
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$Dist = Join-Path $Root 'apps\agent\dist'
$Manifest = Get-Content (Join-Path $Dist 'nodeaccess-agent-windows-x64.json') -Raw | ConvertFrom-Json
$Version = (Get-Content (Join-Path $Root 'apps\agent\package.json') -Raw | ConvertFrom-Json).version
if ($Manifest.version -ne $Version) { throw 'Manifest and package versions differ. Rebuild the Windows package.' }
foreach ($Artifact in $Manifest.artifacts) {
  if ($Artifact.file -notin @('nodeaccess-agent-win.exe', 'nodeaccess-agent-windows-x64.msi')) { throw 'Unexpected artifact name' }
  if ((Get-FileHash (Join-Path $Dist $Artifact.file) -Algorithm SHA256).Hash -ne $Artifact.sha256) { throw 'Artifact checksum mismatch' }
}
$Exe = Join-Path $Dist 'nodeaccess-agent-win.exe'
if ((& $Exe --version | Out-String).Trim() -ne "NodeAccess Agent $Version") { throw 'Runtime version mismatch' }
$Folder = Join-Path $env:TEMP ('NodeAccessUpdate-' + [guid]::NewGuid())
New-Item -ItemType Directory $Folder | Out-Null
$Msi = Join-Path $Folder 'nodeaccess-agent-windows-x64.msi'
Copy-Item (Join-Path $Dist 'nodeaccess-agent-windows-x64.msi') $Msi
$Log = Join-Path $Folder 'install.log'
$p = Start-Process msiexec.exe -Verb RunAs -PassThru -ArgumentList "/i `"$Msi`" /norestart /L*v `"$Log`""
$null = $p.Handle
$p.WaitForExit()
Write-Host "Installer exit code: $($p.ExitCode); log: $Log"
if ($p.ExitCode -eq 1602) { Write-Host 'Atualizacao cancelada pelo usuario.'; exit 1602 }
if ($p.ExitCode -eq 3010) { Write-Host 'Windows restart required to complete the update. No automatic restart was requested.'; exit 3010 }
if ($p.ExitCode -ne 0) { throw 'Windows Installer failed. Inspect the log before retrying.' }
$Installed = Join-Path $env:ProgramFiles 'NodeAccess\nodeaccess-agent.exe'
if ((& $Installed --version | Out-String).Trim() -ne "NodeAccess Agent $Version") { throw 'Installed runtime version mismatch' }
if ((Get-FileHash $Installed).Hash -ne (Get-FileHash $Exe).Hash) { throw 'Installed executable differs from the distribution' }
Write-Host "PASS: installed agent $Version matches the distribution. Open NodeAccess Agent to check the connection."
