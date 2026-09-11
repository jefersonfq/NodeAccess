$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'AgentUpdates.ps1')
$Directory = Join-Path $env:TEMP ('agent-update-test-' + [guid]::NewGuid())
New-Item -ItemType Directory $Directory | Out-Null
$Bytes = [Text.Encoding]::UTF8.GetBytes('test-installer')
$Sha = [Security.Cryptography.SHA256]::Create()
$Hash = ([BitConverter]::ToString($Sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant(); $Sha.Dispose()
$Metadata = @{ schemaVersion = 1; platform = 'windows'; architecture = 'x64'; version = '1.10.0'; downloadPath = '/api/v1/agents/download/windows_msi'; size = $Bytes.Length; sha256 = $Hash }
$SigningKey = New-Object Security.Cryptography.RSACryptoServiceProvider(3072)
$Parameters = $SigningKey.ExportParameters($false)
function To-Base64Url($Bytes) { return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
$Trust = @{ keys = @(@{ n = (To-Base64Url $Parameters.Modulus); e = (To-Base64Url $Parameters.Exponent) }); publisherThumbprint = ('a' * 40) }
function Get-ReleaseTrust { return $Trust }
function Get-AuthenticodeSignature { return @{ Status = 'Valid'; SignerCertificate = @{ Thumbprint = ('a' * 40) } } }
$Payload = [Text.Encoding]::UTF8.GetBytes(($Metadata | ConvertTo-Json -Compress))
$Metadata.releaseProof = @{ payload = [Convert]::ToBase64String($Payload); signature = [Convert]::ToBase64String($SigningKey.SignData($Payload, 'SHA256')) }
$script:Mode = 'ok'
$script:Requests = @()
function Invoke-UpdateRequest($Url, $Destination, $Limit, $TimeoutSeconds) {
  $script:Requests += $Url
  if ($script:Mode -eq 'offline') { throw 'Connection unavailable' }
  if ($Url.EndsWith('/updates/windows')) { $Metadata | ConvertTo-Json | Set-Content $Destination -Encoding UTF8 }
  elseif ($script:Mode -eq 'corrupt') { [IO.File]::WriteAllBytes($Destination, [Text.Encoding]::UTF8.GetBytes('bad-installer!')) }
  elseif ($script:Mode -eq 'partial') { [IO.File]::WriteAllBytes($Destination, @([byte]1)); throw 'Interrupted' }
  else { [IO.File]::WriteAllBytes($Destination, $Bytes) }
}
function Expect-Failure([scriptblock]$Action) {
  $Failed = $false
  try { & $Action | Out-Null } catch { $Failed = $true }
  if (-not $Failed) { throw 'Expected update rejection' }
}
try {
  foreach ($Bad in @('http://example.test', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test/?token=x')) { Expect-Failure { Get-UpdateServer $Bad } }
  if ((Get-UpdateServer 'wss://example.test:8443') -ne 'https://example.test:8443') { throw 'WSS normalization failed' }
  $Result = Invoke-AgentUpdate 'https://example.test' '1.9.0' $Directory
  if ($Result.state -ne 'available' -or $script:Requests.Count -ne 1) { throw 'Check downloaded a package or compared versions lexically' }
  foreach ($Version in @('1.10.0', '2.0.0')) { if ((Invoke-AgentUpdate 'https://example.test' $Version $Directory).state -ne 'current') { throw 'Downgrade offered' } }
  $Result = Invoke-AgentUpdate 'https://example.test' '1.9.0' $Directory $true
  if ($Result.state -ne 'downloaded' -or (Get-FileHash $Result.path).Hash.ToLowerInvariant() -ne $Hash) { throw 'Verified download failed' }
  foreach ($Mode in @('corrupt', 'partial', 'offline')) {
    $script:Mode = $Mode
    Expect-Failure { Invoke-AgentUpdate 'https://example.test' '1.9.0' $Directory $true }
    if (Get-ChildItem $Directory -File) { throw 'Failed request left temporary files' }
  }
  $script:Mode = 'ok'
  $Metadata.downloadPath = 'https://other.test/installer.msi'
  Expect-Failure { Invoke-AgentUpdate 'https://example.test' '1.9.0' $Directory $true }
  $Metadata.downloadPath = '/api/v1/agents/download/windows_msi'; $Metadata.sha256 = 'wrong'
  Expect-Failure { Invoke-AgentUpdate 'https://example.test' '1.9.0' $Directory $true }
  $Metadata.sha256 = $Hash
  $Signature = $Metadata.releaseProof.signature
  $Metadata.releaseProof.signature = [Convert]::ToBase64String((New-Object byte[] 384))
  Expect-Failure { Assert-ReleaseProof $Metadata }
  $Metadata.releaseProof.signature = $Signature
  $Trust.publisherThumbprint = ('b' * 40)
  Expect-Failure { Assert-InstallerPublisher 'mock-package.msi' }
  Write-Host 'PASS: updates compare numeric versions, avoid downgrade, require HTTPS and fixed origin, verify hashes, clean partial downloads and tolerate offline failures'
} finally { $SigningKey.Dispose(); Remove-Item $Directory -Recurse -Force }
