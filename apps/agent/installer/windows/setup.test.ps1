$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'AgentSetup.ps1') -LibraryOnly
$StateRoot = Join-Path ([IO.Path]::GetTempPath()) ('nodeaccess-setup-test-' + [guid]::NewGuid().ToString())
$ConfigPath = Join-Path $StateRoot 'config.json'
$TokenPath = Join-Path $StateRoot 'agent.token'
$PolicyPath = Join-Path $StateRoot 'policy.json'
$ProcessPath = Join-Path $StateRoot 'process.json'
$StatusPath = Join-Path $StateRoot 'status.json'
$StartupLink = Join-Path $StateRoot 'startup-test.lnk'
$RealStartAgent = ${function:Start-AgentProcess}
$RealCompatibility = ${function:Assert-AgentCompatible}
$RealInspection = ${function:Invoke-AgentInspection}
$RealSetStartup = ${function:Set-AgentStartup}
$TestState = @{ ExitCode = 2; Stops = 0; Starts = 0; Startup = $false }
function Assert-AgentCompatible { }
function Start-Process {
  $Probe = [pscustomobject]@{ ExitCode = $TestState.ExitCode; HasExited = $true }
  $Probe | Add-Member ScriptMethod WaitForExit { param($Timeout) return $true }
  $Probe | Add-Member ScriptMethod Dispose { }
  $Probe | Add-Member ScriptMethod Kill { }
  return $Probe
}
function Stop-AgentProcess { $TestState.Stops++ }
function Start-AgentProcess { $TestState.Starts++ }
function Set-AgentStartup([bool]$Enabled) { $TestState.Startup = $Enabled }
try {
  if ((Get-AgentServer 'https://example.com/') -ne 'https://example.com') { throw 'URL normalization failed' }
  foreach ($Invalid in @('http://example.com', 'file:///tmp', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com/?token=secret')) {
    $Rejected = $false
    try { Get-AgentServer $Invalid | Out-Null } catch { $Rejected = $true }
    if (-not $Rejected) { throw 'Unsafe server URL accepted' }
  }
  Initialize-AgentDirectory
  $MissingRejected = $false
  try { & $RealStartAgent } catch { $MissingRejected = $_.Exception.Message -like '*Ainda nao configurado*' }
  if (-not $MissingRejected) { throw 'Missing configuration did not give actionable guidance' }
  $OriginalExe = $AgentExe
  $AgentExe = $PSCommandPath
  function Invoke-AgentInspection { param($Arguments) return 'NodeAccess Agent 1.0.0 --token --server' }
  $LegacyRejected = $false
  try { & $RealCompatibility } catch { $LegacyRejected = $_.Exception.Message -like '*incompativel*' }
  if (-not $LegacyRejected) { throw 'Legacy executable accepted' }
  function Invoke-AgentInspection { param($Arguments) return 'NodeAccess Agent 1.1.1 --token-file --check --status-file' }
  & $RealCompatibility
  $AgentExe = $OriginalExe
  ${function:Invoke-AgentInspection} = $RealInspection
  foreach ($Code in @('tls', 'dns', 'refused', 'rejected', 'http', 'timeout', 'network')) {
    @{ diagnostic = $Code; token = 'never-display-this-token' } | ConvertTo-Json | Set-Content $StatusPath
    $Message = Get-AgentRegistrationError $StatusPath
    if (-not $Message -or $Message.Contains('never-display-this-token')) { throw 'Unsafe or missing diagnostic' }
  }
  & $RealSetStartup $true
  $Link = (New-Object -ComObject WScript.Shell).CreateShortcut($StartupLink)
  if (-not $Link.Arguments.Contains('AgentSetup.ps1') -or -not $Link.Arguments.EndsWith('-Run')) { throw 'Startup shortcut does not run the assistant launcher' }
  if ($Link.Arguments.Contains('credential')) { throw 'Startup shortcut contains credentials' }
  & $RealSetStartup $false
  if (Test-Path $StartupLink) { throw 'Startup shortcut was not removed' }
  [IO.File]::WriteAllText($TokenPath, 'previous-test-credential')
  [IO.File]::WriteAllText($ConfigPath, '{"server":"https://old.example.com"}')
  $Rejected = $false
  try { Save-AgentConfiguration 'https://new.example.com' 'candidate-test-credential' $true } catch { $Rejected = $true }
  if (-not $Rejected -or $TestState.Stops -ne 0) { throw 'Failed validation interrupted the old agent' }
  if ([IO.File]::ReadAllText($TokenPath) -ne 'previous-test-credential') { throw 'Failed validation replaced the token' }
  if ((Get-ChildItem $StateRoot -Filter '*.token').Count -ne 1) { throw 'Candidate token was not cleaned up' }
  $TestState.ExitCode = 0
  Save-AgentConfiguration 'https://new.example.com' 'candidate-test-credential' $true
  if ($TestState.Stops -ne 1 -or $TestState.Starts -ne 1 -or -not $TestState.Startup) { throw 'Successful setup did not start the agent' }
  if ((Get-Content $ConfigPath -Raw | ConvertFrom-Json).server -ne 'https://new.example.com') { throw 'Configuration not saved' }
  if ((Get-Content $ConfigPath -Raw).Contains('candidate-test-credential')) { throw 'Token leaked into config JSON' }
  $Acl = Get-Acl $StateRoot
  if (-not $Acl.AreAccessRulesProtected) { throw 'Token directory inherits permissions' }
  Write-Host 'PASS: server validation, failed token preservation, candidate cleanup, successful setup and protected ACL'
} finally { if (Test-Path $StateRoot) { Remove-Item -Recurse -Force $StateRoot } }
