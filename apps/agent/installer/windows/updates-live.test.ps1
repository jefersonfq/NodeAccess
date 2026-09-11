$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'AgentUpdates.ps1')
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$Directory = Join-Path $env:TEMP ('agent-update-live-' + [guid]::NewGuid())
New-Item -ItemType Directory $Directory | Out-Null
$PortFile = Join-Path $Directory 'port'; $ModeFile = Join-Path $Directory 'mode'
[IO.File]::WriteAllText($ModeFile, 'ok')
$Server = $null; $Job = $null
try {
  $Fixture = Join-Path $Root 'tools\agent\update-server.cjs'
  $Server = Start-Process node -ArgumentList ('"' + $Fixture + '" "' + $PortFile + '" "' + $ModeFile + '"') -PassThru -WindowStyle Hidden
  for ($Attempt = 0; $Attempt -lt 100 -and -not (Test-Path $PortFile); $Attempt++) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path $PortFile)) { throw 'Fixture failed to start' }
  $Origin = 'http://127.0.0.1:' + (Get-Content $PortFile -Raw)
  # Only the fixture bypasses the production HTTPS-origin requirement.
  function Get-UpdateServer { return $Origin }
  $Result = Invoke-AgentUpdate 'fixture' '1.0.0' $Directory $true
  if ($Result.state -ne 'downloaded') { throw 'Native HTTP download failed' }
  $Job = Start-Job -ArgumentList (Join-Path $PSScriptRoot 'AgentUpdates.ps1'), $Origin, $Directory -ScriptBlock {
    param($Worker, $Origin, $Directory)
    . $Worker
    function Get-UpdateServer { return $Origin }
    Invoke-AgentUpdate 'fixture' '1.0.0' $Directory
  }
  if (-not (Wait-Job $Job -Timeout 20)) { throw 'Background check did not complete' }
  $Result = Receive-Job $Job -ErrorAction Stop
  if ($Result.state -ne 'available') { throw 'Background job lost update result' }
  Remove-Job $Job; $Job = $null
  foreach ($Mode in @('corrupt', 'oversize', 'redirect', 'unavailable')) {
    [IO.File]::WriteAllText($ModeFile, $Mode)
    $Failed = $false
    try { Invoke-AgentUpdate 'fixture' '1.0.0' $Directory $true | Out-Null } catch { $Failed = $true }
    if (-not $Failed) { throw "Unsafe response accepted: $Mode" }
    if (Get-ChildItem $Directory -Filter '*.partial') { throw 'Incomplete installer remains after failure' }
  }
  foreach ($SlowMode in @('slow', 'body-slow')) {
  [IO.File]::WriteAllText($ModeFile, $SlowMode)
  $Failed = $false; $Clock = [Diagnostics.Stopwatch]::StartNew()
  try { Invoke-UpdateRequest $Origin (Join-Path $Directory 'timeout') 100 1 } catch { $Failed = $true }
  if (-not $Failed -or $Clock.Elapsed.TotalSeconds -gt 10) { throw 'Request timeout did not bound a stalled server' }
  Remove-Item (Join-Path $Directory 'timeout') -Force -ErrorAction SilentlyContinue
  }
  Write-Host 'PASS: native HTTP streaming, valid installer, corrupt/oversize rejection, redirects blocked, 503 and timeout'
} finally {
  if ($Job) { Stop-Job $Job; Remove-Job $Job -Force }
  if ($Server) { if (-not $Server.HasExited) { Stop-Process -Id $Server.Id }; $Server.Dispose() }
  Remove-Item $Directory -Recurse -Force
}
