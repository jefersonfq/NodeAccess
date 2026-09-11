$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'AgentSetup.ps1') -LibraryOnly
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$AgentExe = if ($env:AGENT_TEST_EXECUTABLE) { $env:AGENT_TEST_EXECUTABLE } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..\dist\nodeaccess-agent-win.exe')).Path }
$StateRoot = Join-Path ([IO.Path]::GetTempPath()) ('nodeaccess-setup-live-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory $StateRoot | Out-Null
$ConfigPath = Join-Path $StateRoot 'config.json'
$TokenPath = Join-Path $StateRoot 'agent.token'
$PolicyPath = Join-Path $StateRoot 'policy.json'
$ProcessPath = Join-Path $StateRoot 'process.json'
$StatusPath = Join-Path $StateRoot 'status.json'
# URL/TLS policy is tested separately. Use loopback WebSocket only for this
# isolated transport fixture, without changing the installed assistant.
function Get-AgentServer([string]$Value) { return $Value }
function Set-AgentStartup([bool]$Enabled) { }
$NativeStartProcess = Get-Command Start-Process -CommandType Cmdlet
function Start-Process {
  [CmdletBinding()]
  param([string]$FilePath, [string]$ArgumentList, [switch]$PassThru, [string]$WindowStyle, [string]$RedirectStandardOutput, [string]$RedirectStandardError)
  if ($FilePath -eq $AgentExe) { $PSBoundParameters['ArgumentList'] = $ArgumentList + ' --development' }
  & $NativeStartProcess @PSBoundParameters
}
$ServerFile = Join-Path $StateRoot 'server.cjs'
$PortFile = Join-Path $StateRoot 'port'
$Source = @'
const fs = require('fs');
const { WebSocketServer } = require(require.resolve('ws', { paths: [process.argv[2]] }));
const server = new WebSocketServer({ host:'127.0.0.1', port:0 });
server.on('listening', () => fs.writeFileSync(process.argv[3], String(server.address().port)));
server.on('connection', (socket, request) => {
  const token = (request.headers.authorization || '').replace(/^Bearer /, '');
  if (!['valid-config-test','replacement-config-test'].includes(token)) return socket.close(1008,'Invalid token');
  socket.send(JSON.stringify({ type:'registered', accessMode:'managed_acl', agentId:1, name:'Local configuration test' }));
});
'@
[IO.File]::WriteAllText($ServerFile, $Source)
$ServerProcess = Start-Process (Get-Command node.exe).Source -ArgumentList ('"' + $ServerFile + '" "' + $RepoRoot + '" "' + $PortFile + '"') -WindowStyle Hidden -PassThru
try {
  for ($Attempt = 0; $Attempt -lt 50 -and -not (Test-Path $PortFile); $Attempt++) { Start-Sleep -Milliseconds 100 }
  $ServerUrl = 'ws://127.0.0.1:' + (Get-Content $PortFile -Raw)
  Save-AgentConfiguration $ServerUrl 'valid-config-test' $false
  for ($Attempt = 0; $Attempt -lt 50; $Attempt++) {
    if ((Test-Path $StatusPath) -and (Get-Content $StatusPath -Raw | ConvertFrom-Json).state -eq 'connected') { break }
    Start-Sleep -Milliseconds 100
  }
  if (Test-Path $PolicyPath) { throw 'Default setup unexpectedly created a local policy' }
  if ((Get-Content $StatusPath -Raw | ConvertFrom-Json).accessMode -ne 'managed_acl') { throw 'Default setup did not use managed ACL' }
  if (-not (Get-AgentProcess)) { throw 'Configured agent is not running' }
  if ((Get-Content $StatusPath -Raw | ConvertFrom-Json).state -ne 'connected') { throw 'Agent did not register' }
  $Rejected = $false
  try { Save-AgentConfiguration $ServerUrl 'invalid-config-test' $false } catch { $Rejected = $true }
  if (-not $Rejected -or (Get-Content $TokenPath -Raw) -ne 'valid-config-test' -or -not (Get-AgentProcess)) { throw 'Invalid token changed the running configuration' }
  Save-AgentConfiguration $ServerUrl 'replacement-config-test' $false
  if ((Get-Content $TokenPath -Raw) -ne 'replacement-config-test' -or -not (Get-AgentProcess)) { throw 'Replacement token did not start' }
  Stop-AgentProcess
  if (Get-AgentProcess) { throw 'Agent remained running after Stop' }
  Write-Host 'PASS: native setup registers, preserves config on invalid token, replaces credentials and stops only its own process'
} finally {
  Stop-AgentProcess
  if (-not $ServerProcess.HasExited) { $ServerProcess.Kill(); $ServerProcess.WaitForExit() }
  Remove-Item $StateRoot -Recurse -Force
}
