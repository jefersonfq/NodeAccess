$ErrorActionPreference = 'Stop'
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$AgentRoot = Join-Path $TestRoot 'apps\agent'
$InstallerRoot = Join-Path $AgentRoot 'installer\windows'
New-Item -ItemType Directory -Force $InstallerRoot, (Join-Path $AgentRoot 'dist') | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'build-msi.ps1') $InstallerRoot
[IO.File]::WriteAllText((Join-Path $AgentRoot 'package.json'), '{"version":"1.0.0"}')
$StaleExe = Join-Path $AgentRoot 'dist\nodeaccess-agent-win.exe'
[IO.File]::WriteAllText($StaleExe, 'previous executable')
$NpmState = @{ Calls = 0 }
function node { $global:LASTEXITCODE = 0; return 'source-digest-fixture' }
function wix { throw 'WiX must not run after an npm failure' }
function npm.cmd { $NpmState.Calls++; $global:LASTEXITCODE = 37 }
try {
  $Failure = $null
  try { & (Join-Path $InstallerRoot 'build-msi.ps1') } catch { $Failure = $_.Exception.Message }
  if ($Failure -notmatch 'Falha ao compilar o EXE Windows') { throw "Falha nao interrompeu a build: $Failure" }
  if ($NpmState.Calls -ne 1) { throw 'Compilacao nao foi executada exatamente uma vez' }
  if ([IO.File]::ReadAllText($StaleExe) -ne 'previous executable') { throw 'EXE anterior foi alterado' }
  if (Test-Path (Join-Path $AgentRoot 'dist\nodeaccess-agent-windows-x64.msi')) { throw 'MSI gerado apos falha' }
  $Failure = $null
  try { & (Join-Path $InstallerRoot 'build-msi.ps1') -Version '1.0.1' } catch { $Failure = $_.Exception.Message }
  if ($Failure -notmatch 'versao deve corresponder') { throw 'Versao divergente aceita' }
  if ($NpmState.Calls -ne 1) { throw 'Compilacao executada para versao divergente' }
  Write-Host 'PASS: npm failure aborts before reusing an old EXE; mismatched version rejected'
} finally {
  Remove-Item -Recurse -Force $TestRoot
}
exit 0
