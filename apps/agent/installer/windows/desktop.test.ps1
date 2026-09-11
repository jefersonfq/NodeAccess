$ErrorActionPreference = 'Stop'
$Root = Join-Path ([IO.Path]::GetTempPath()) ('nodeaccess-desktop-test-' + [guid]::NewGuid())
$Child = $null
try {
  New-Item -ItemType Directory $Root | Out-Null
  $Exe = Join-Path $Root 'nodeaccess-desktop.exe'
  Copy-Item (Join-Path $PSScriptRoot '..\..\dist\nodeaccess-desktop.exe') $Exe
  $Expected = (Get-Content (Join-Path $PSScriptRoot '..\..\package.json') -Raw | ConvertFrom-Json).version
  $Info = [Diagnostics.FileVersionInfo]::GetVersionInfo($Exe)
  if ($Info.FileDescription -ne 'NodeAccess Agent' -or $Info.FileVersion -ne "$Expected.0") { throw 'Task Manager metadata mismatch' }
  'param([switch]$Run); Start-Sleep -Seconds 2; if ($Run) { exit 7 } else { exit 8 }' | Set-Content (Join-Path $Root 'AgentSetup.ps1')
  $Child = Start-Process $Exe -ArgumentList '-Run' -PassThru
  $null = $Child.Handle
  if ($Child.ProcessName -ne 'nodeaccess-desktop') { throw 'Wrong process identity' }
  if (-not $Child.WaitForExit(15000)) { throw 'Desktop did not exit with its assistant' }
  $Child.WaitForExit()
  if ($Child.ExitCode -ne 7) { throw 'Startup argument or child exit code lost' }
  Write-Host 'PASS: desktop process identity, product/version metadata, startup argument and lifecycle'
} finally {
  if ($Child) { if (-not $Child.HasExited) { $Child.Kill() }; $Child.Dispose() }
  Remove-Item $Root -Recurse -Force
}
