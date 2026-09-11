# Disposable Windows CI runner only: installs/removes test products.
$ErrorActionPreference = 'Stop'
if ($env:RUN_AGENT_MSI_LIFECYCLE -ne 'true') { throw 'Opt-in required: RUN_AGENT_MSI_LIFECYCLE=true on a disposable Windows runner' }
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$InstalledExe = Join-Path $env:ProgramFiles 'NodeAccess\nodeaccess-agent.exe'
$Existing = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'NodeAccess Agent' }
if ((Test-Path $InstalledExe) -or $Existing) { throw 'Refusing to alter an existing user installation' }
$Temp = Join-Path $env:TEMP ('nodeaccess-msi-lifecycle-' + [guid]::NewGuid())
New-Item -ItemType Directory $Temp | Out-Null
$NewMsi = Join-Path $Root 'apps\agent\dist\nodeaccess-agent-windows-x64.msi'
$NewExe = Join-Path $Root 'apps\agent\dist\nodeaccess-agent-win.exe'
$Expected = (Get-Content (Join-Path $Root 'apps\agent\package.json') -Raw | ConvertFrom-Json).version
$LegacyExe = Join-Path $Temp 'legacy.exe'
Add-Type -TypeDefinition 'public class LegacyAgent { public static void Main() { System.Console.WriteLine("NodeAccess Agent 1.0.0"); } }' -OutputAssembly $LegacyExe -OutputType ConsoleApplication
$OldMsi = Join-Path $Temp 'NodeAccessAgent.msi'
& wix build (Join-Path $Root 'apps\agent\installer\windows\NodeAccessAgent.wxs') -arch x64 -pdbtype none -d "BrandingDir=$Root\apps\agent\installer\branding" -d "DesktopExecutable=$Root\apps\agent\dist\nodeaccess-desktop.exe" -d 'ProductVersion=1.0.0' -d "AgentExecutable=$LegacyExe" -d "AgentUpdatesScript=$Root\apps\agent\installer\windows\AgentUpdates.ps1" -d "AgentSetupScript=$Root\apps\agent\installer\windows\AgentSetup.ps1" -o $OldMsi
if ($LASTEXITCODE -ne 0) { throw 'Legacy fixture build failed' }
$StateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'NodeAccess\Agent'
if (Test-Path $StateRoot) { throw 'Refusing to alter existing agent configuration' }
New-Item -ItemType Directory $StateRoot | Out-Null
$FixtureToken = Join-Path $StateRoot 'agent.token'
$FixtureConfig = Join-Path $StateRoot 'config.json'
'ci-fixture-not-a-real-token' | Set-Content $FixtureToken
'{"server":"https://example.invalid","autoStart":false}' | Set-Content $FixtureConfig
$TokenHash = (Get-FileHash $FixtureToken).Hash
$ConfigHash = (Get-FileHash $FixtureConfig).Hash
$CleanupMsi = $null
function Invoke-Msi([string]$Arguments, [string]$Name) {
  $Log = Join-Path $Temp ($Name + '.log')
  $p = Start-Process msiexec.exe -ArgumentList "$Arguments /qn /norestart /L*v `"$Log`"" -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "MSI $Name failed: $($p.ExitCode); log: $Log" }
}
function Assert-Installed {
  if ((& $InstalledExe --version | Out-String).Trim() -ne "NodeAccess Agent $Expected") { throw 'Installed runtime version mismatch' }
  if ((Get-FileHash $InstalledExe).Hash -ne (Get-FileHash $NewExe).Hash) { throw 'Installed runtime hash mismatch' }
  if ((Get-FileHash (Join-Path (Split-Path $InstalledExe) 'AgentSetup.ps1')).Hash -ne (Get-FileHash (Join-Path $Root 'apps\agent\installer\windows\AgentSetup.ps1')).Hash) { throw 'Installed assistant mismatch' }
}
try {
  $CleanupMsi = $OldMsi
  Invoke-Msi "/i `"$OldMsi`"" 'install-legacy'
  if ((& $InstalledExe --version | Out-String).Trim() -ne 'NodeAccess Agent 1.0.0') { throw 'Legacy fixture not installed' }
  Invoke-Msi "/i `"$NewMsi`"" 'upgrade'
  $CleanupMsi = $NewMsi
  Assert-Installed
  if ((Get-FileHash $FixtureToken).Hash -ne $TokenHash -or (Get-FileHash $FixtureConfig).Hash -ne $ConfigHash) { throw 'Update/repair changed user configuration' }
  # Reproduce registered current MSI + stale EXE, then repair from another folder.
  Copy-Item $LegacyExe $InstalledExe -Force
  $RepairDir = Join-Path $Temp 'repair'
  New-Item -ItemType Directory $RepairDir | Out-Null
  $RepairMsi = Join-Path $RepairDir 'nodeaccess-agent-windows-x64.msi'
  Copy-Item $NewMsi $RepairMsi
  Invoke-Msi "/i `"$RepairMsi`" REINSTALL=ALL REINSTALLMODE=vamus" 'repair'
  Assert-Installed
  if ((Get-FileHash $FixtureToken).Hash -ne $TokenHash -or (Get-FileHash $FixtureConfig).Hash -ne $ConfigHash) { throw 'Update/repair changed user configuration' }
  Invoke-Msi "/x `"$RepairMsi`"" 'uninstall'
  $CleanupMsi = $null
  if (Test-Path $InstalledExe) { throw 'Uninstall left executable behind' }
  Invoke-Msi "/i `"$NewMsi`"" 'clean-install'
  $CleanupMsi = $NewMsi
  Assert-Installed
  if ((Get-FileHash $FixtureToken).Hash -ne $TokenHash -or (Get-FileHash $FixtureConfig).Hash -ne $ConfigHash) { throw 'Update/repair changed user configuration' }
  Write-Host 'PASS: legacy-name upgrade, runtime hash, stale EXE repair from another folder, uninstall and clean install'
} finally {
  if ($CleanupMsi) { Invoke-Msi "/x `"$CleanupMsi`"" 'cleanup' }
  Remove-Item $StateRoot -Recurse -Force
  Write-Host "Lifecycle logs: $Temp"
}
