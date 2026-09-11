param([string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path)
$ErrorActionPreference = 'Stop'
. (Join-Path $ProjectRoot 'apps/agent/installer/windows/AgentSetup.ps1') -LibraryOnly
$StateRoot = Join-Path ([IO.Path]::GetTempPath()) ('nodeaccess-config-fault-' + [guid]::NewGuid())
$ConfigPath = Join-Path $StateRoot 'config.json'
$TokenPath = Join-Path $StateRoot 'agent.token'
$ProcessPath = Join-Path $StateRoot 'process.json'
$StatusPath = Join-Path $StateRoot 'status.json'
$TestState = @{ Launches = 0; Stops = 0; Kills = 0; Disposals = 0; Mode = 'timeout'; Process = $null }
function Assert-AgentCompatible { }
function Start-Process {
  $TestState.Launches++
  if ($TestState.Mode -eq 'missing-executable') { throw 'Executable unavailable' }
  $Probe = [pscustomobject]@{ ExitCode = 2; HasExited = $false }
  $Probe | Add-Member ScriptMethod WaitForExit { param($Timeout) return $false }
  $Probe | Add-Member ScriptMethod Kill { $TestState.Kills++; $this.HasExited = $true }
  $Probe | Add-Member ScriptMethod Dispose { $TestState.Disposals++ }
  return $Probe
}
function Stop-AgentProcess { $TestState.Stops++ }
function Get-Process { return $TestState.Process }
try {
  Initialize-AgentDirectory
  $OriginalConfig = '{"server":"https://old.example.com","autoStart":false}'
  [IO.File]::WriteAllText($ConfigPath, $OriginalConfig)
  [IO.File]::WriteAllText($TokenPath, 'original-private-token')
  foreach ($Case in @(
    @{ Server = 'http://unsafe.example.com'; Token = 'candidate'; Mode = 'timeout'; Launches = 0 },
    @{ Server = 'https://new.example.com'; Token = '   '; Mode = 'timeout'; Launches = 0 },
    @{ Server = 'https://new.example.com'; Token = 'candidate'; Mode = 'timeout'; Launches = 1 },
    @{ Server = 'https://new.example.com'; Token = 'candidate'; Mode = 'missing-executable'; Launches = 1 }
  )) {
    $Before = $TestState.Launches
    $TestState.Mode = $Case.Mode
    $Rejected = $false
    try { Save-AgentConfiguration $Case.Server $Case.Token $false } catch { $Rejected = $true }
    if (-not $Rejected) { throw 'Invalid configuration unexpectedly succeeded' }
    if ($TestState.Launches - $Before -ne $Case.Launches) { throw 'Validation launched an unexpected process' }
    if ($TestState.Stops -ne 0) { throw 'Failed validation stopped the working agent' }
    if ([IO.File]::ReadAllText($ConfigPath) -ne $OriginalConfig) { throw 'Failed validation changed configuration' }
    if ([IO.File]::ReadAllText($TokenPath) -ne 'original-private-token') { throw 'Failed validation replaced token' }
    if ((Get-ChildItem $StateRoot -Filter '*.token').Count -ne 1) { throw 'Temporary credential leaked' }
  }
  if ($TestState.Kills -ne 1 -or $TestState.Disposals -ne 1) { throw 'Timed-out probe was not killed and disposed exactly once' }

  # A reused PID, another executable, or corrupt metadata cannot identify our agent.
  $Now = [DateTime]::UtcNow
  @{ id = 1234; started = $Now.Ticks.ToString() } | ConvertTo-Json | Set-Content $ProcessPath
  $TestState.Process = [pscustomobject]@{ Path = $AgentExe; StartTime = $Now.AddSeconds(1) }
  if (Get-AgentProcess) { throw 'Reused PID accepted' }
  $TestState.Process = [pscustomobject]@{ Path = 'C:\unrelated.exe'; StartTime = $Now }
  if (Get-AgentProcess) { throw 'Unrelated executable accepted' }
  $TestState.Process = [pscustomobject]@{ Path = $AgentExe; StartTime = $Now }
  if (-not (Get-AgentProcess)) { throw 'Matching process not recognized' }
  $Before = $TestState.Launches
  Start-AgentProcess
  if ($TestState.Launches -ne $Before) { throw 'Repeated start launched another agent' }
  [IO.File]::WriteAllText($ProcessPath, '{invalid')
  if (Get-AgentProcess) { throw 'Corrupt process metadata accepted' }
  Write-Host 'PASS: invalid URL, empty token, timeout, missing executable, credential preservation, probe cleanup, PID reuse, repeated start, corrupt metadata'
} finally {
  if (Test-Path $StateRoot) { Remove-Item $StateRoot -Recurse -Force }
}
