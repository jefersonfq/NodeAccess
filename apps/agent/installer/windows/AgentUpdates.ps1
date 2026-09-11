# Loaded in a background job: no token, no UI and no changes to the running agent.
$ErrorActionPreference = 'Stop'
function Get-UpdateServer([string]$Server) {
  $Uri = $null
  if (-not [Uri]::TryCreate($Server, [UriKind]::Absolute, [ref]$Uri) -or $Uri.Scheme -notin @('https', 'wss') -or $Uri.UserInfo -or $Uri.Query -or $Uri.Fragment -or $Uri.AbsolutePath -ne '/') { throw 'Servidor de atualizacao invalido.' }
  return 'https://' + $Uri.Authority
}
function Assert-UpdateMetadata($Metadata) {
  if ($Metadata.schemaVersion -ne 1 -or $Metadata.platform -ne 'windows' -or $Metadata.architecture -ne 'x64' -or
      $Metadata.version -notmatch '^\d+\.\d+\.\d+$' -or $Metadata.sha256 -cnotmatch '^[a-f0-9]{64}$' -or
      $Metadata.downloadPath -cne '/api/v1/agents/download/windows_msi' -or
      $Metadata.size -isnot [ValueType] -or $Metadata.size -le 0 -or $Metadata.size -gt 536870912 -or [math]::Floor($Metadata.size) -ne $Metadata.size) { throw 'Metadados de atualizacao invalidos.' }
  $null = [version]$Metadata.version
}
function Get-ReleaseTrust {
  $Trust = Get-Content (Join-Path $PSScriptRoot 'release-trust.json') -Raw | ConvertFrom-Json
  if (-not $Trust.keys -or $Trust.publisherThumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'Identidade confiavel do editor ausente. Repare a instalacao com um pacote oficial.' }
  return $Trust
}
function Convert-Base64Url([string]$Value) {
  $Value = $Value.Replace('-', '+').Replace('_', '/')
  return [Convert]::FromBase64String($Value.PadRight($Value.Length + ((4 - $Value.Length % 4) % 4), '='))
}
function Assert-ReleaseProof($Metadata) {
  $Trust = Get-ReleaseTrust
  if (-not $Metadata.releaseProof -or $Metadata.releaseProof.payload.Length -gt 8192 -or $Metadata.releaseProof.signature.Length -gt 2048) { throw 'Manifesto sem assinatura valida.' }
  $Payload = [Convert]::FromBase64String($Metadata.releaseProof.payload)
  $Signature = [Convert]::FromBase64String($Metadata.releaseProof.signature)
  $Valid = $false
  foreach ($Key in $Trust.keys) {
    $Rsa = New-Object Security.Cryptography.RSACryptoServiceProvider
    try {
      $Parameters = New-Object Security.Cryptography.RSAParameters
      $Parameters.Modulus = Convert-Base64Url $Key.n; $Parameters.Exponent = Convert-Base64Url $Key.e
      if ($Parameters.Modulus.Length -lt 384) { continue }
      $Rsa.ImportParameters($Parameters)
      if ($Rsa.VerifyData($Payload, 'SHA256', $Signature)) { $Valid = $true; break }
    } finally { $Rsa.Dispose() }
  }
  if (-not $Valid) { throw 'Assinatura do manifesto nao confiavel.' }
  $Signed = [Text.Encoding]::UTF8.GetString($Payload) | ConvertFrom-Json
  Assert-UpdateMetadata $Signed
  foreach ($Field in @('schemaVersion', 'platform', 'architecture', 'version', 'size', 'sha256', 'downloadPath')) {
    if ([string]$Signed.$Field -cne [string]$Metadata.$Field) { throw 'Manifesto alterado apos assinatura.' }
  }
}
function Assert-InstallerPublisher([string]$Path) {
  $Trust = Get-ReleaseTrust
  $Signature = Get-AuthenticodeSignature -FilePath $Path
  if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Thumbprint -ine $Trust.publisherThumbprint) { throw 'Assinatura ou editor do instalador nao confiavel.' }
}
function Invoke-UpdateRequest([string]$Url, [string]$Destination, [long]$Limit, [int]$TimeoutSeconds) {
  Add-Type -AssemblyName System.Net.Http
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $Handler = New-Object Net.Http.HttpClientHandler
  $Handler.AllowAutoRedirect = $false
  $Client = New-Object Net.Http.HttpClient($Handler)
  $Client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
  $Response = $null; $Stream = $null; $Output = $null
  $Cancellation = New-Object Threading.CancellationTokenSource
  $Cancellation.CancelAfter($TimeoutSeconds * 1000)
  try {
    $Response = $Client.GetAsync($Url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $Cancellation.Token).GetAwaiter().GetResult()
    if (-not $Response.IsSuccessStatusCode) { throw 'Servidor sem atualizacao disponivel ou temporariamente indisponivel.' }
    if ($Response.Content.Headers.ContentLength -gt $Limit) { throw 'Pacote excede o tamanho permitido.' }
    $Stream = $Response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $Output = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $Buffer = New-Object byte[] 65536
    [long]$Total = 0
    $Clock = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
      $Remaining = [int][Math]::Max(0, $TimeoutSeconds * 1000 - $Clock.ElapsedMilliseconds)
      $PendingRead = $Stream.ReadAsync($Buffer, 0, $Buffer.Length, $Cancellation.Token)
      if (-not $PendingRead.Wait($Remaining)) { throw 'Tempo limite no download.' }
      $Read = $PendingRead.GetAwaiter().GetResult()
      if ($Read -eq 0) { break }
      $Total += $Read
      if ($Total -gt $Limit) { throw 'Resposta excede o tamanho permitido.' }
      $Output.Write($Buffer, 0, $Read)
    }
  } finally {
    if ($Output) { $Output.Dispose() }; if ($Stream) { $Stream.Dispose() }
    if ($Response) { $Response.Dispose() }; $Client.Dispose(); $Handler.Dispose(); $Cancellation.Dispose()
  }
}
function Invoke-AgentUpdate([string]$Server, [string]$CurrentVersion, [string]$Directory, [bool]$Download = $false) {
  $Origin = Get-UpdateServer $Server
  $Current = [version]$CurrentVersion
  $ManifestFile = Join-Path $Directory ([guid]::NewGuid().ToString() + '.json')
  $Partial = Join-Path $Directory ([guid]::NewGuid().ToString() + '.partial')
  try {
    Invoke-UpdateRequest ($Origin + '/api/v1/agents/updates/windows') $ManifestFile 16384 20
    $Metadata = Get-Content $ManifestFile -Raw | ConvertFrom-Json
    Assert-UpdateMetadata $Metadata
    Assert-ReleaseProof $Metadata
    if ([version]$Metadata.version -le $Current) { return [pscustomobject]@{ state = 'current'; version = $CurrentVersion; server = $Server } }
    if (-not $Download) { return [pscustomobject]@{ state = 'available'; version = $Metadata.version; server = $Server } }
    # Re-read metadata for each download: a release may have changed since the notification.
    Invoke-UpdateRequest ($Origin + $Metadata.downloadPath) $Partial ([long]$Metadata.size) 180
    if ((Get-Item $Partial).Length -ne $Metadata.size -or (Get-FileHash $Partial -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Metadata.sha256) { throw 'Integridade do instalador invalida. Tente baixar novamente.' }
    $PackageDirectory = Join-Path $Directory ([guid]::NewGuid().ToString())
    New-Item -ItemType Directory $PackageDirectory | Out-Null
    $Package = Join-Path $PackageDirectory 'nodeaccess-agent-windows-x64.msi'
    Move-Item $Partial $Package
    try { Assert-InstallerPublisher $Package } catch { Remove-Item $PackageDirectory -Recurse -Force; throw }
    return [pscustomobject]@{ state = 'downloaded'; version = $Metadata.version; server = $Server; path = $Package; sha256 = $Metadata.sha256 }
  } finally {
    Remove-Item $ManifestFile, $Partial -Force -ErrorAction SilentlyContinue
  }
}
