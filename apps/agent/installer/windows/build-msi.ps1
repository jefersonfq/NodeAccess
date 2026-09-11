param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
if ($env:NODEACCESS_DEVELOPMENT_UNSIGNED -ne 'true' -and (-not $env:NODEACCESS_CODE_SIGN_CERTIFICATE -or -not $env:NODEACCESS_RELEASE_SIGNING_KEY -or -not $env:NODEACCESS_RELEASE_PUBLIC_KEY)) {
  throw 'Release exige certificado Authenticode e chaves de assinatura. NODEACCESS_DEVELOPMENT_UNSIGNED=true somente para laboratorio.'
}
$AgentRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Package = Get-Content (Join-Path $AgentRoot "package.json") -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $Package.version }

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "A versao do MSI deve usar major.minor.patch. Recebido: $Version"
}
if ($Version -ne $Package.version) { throw "A versao deve corresponder a apps/agent/package.json" }
$VersionParts = $Version.Split('.')
if ([long]$VersionParts[0] -gt 255 -or [long]$VersionParts[1] -gt 255 -or [long]$VersionParts[2] -gt 65535) {
  throw "Versao fora dos limites MSI: major/minor <= 255 e patch <= 65535"
}
# Reuse isolated native tools when present; never install tools implicitly.
$NativeTools = Join-Path $AgentRoot 'node_modules\.native-build-tools'
$env:PATH = "$(Join-Path $NativeTools 'wix');$(Join-Path $NativeTools 'node_modules\.bin');$env:PATH"
if (-not (Get-Command wix -ErrorAction SilentlyContinue)) {
  throw "WiX Toolset 4 nao encontrado. Instale com: dotnet tool install --global wix --version 4.*"
}
$PSNativeCommandUseErrorActionPreference = $false
$SigningTool = Join-Path $PSScriptRoot '..\release-signing.mjs'
& node $SigningTool trust (Join-Path $PSScriptRoot 'release-trust.json')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao configurar identidade confiavel do editor' }
$ArtifactTool = Join-Path $PSScriptRoot 'artifacts.mjs'
$SourceDigest = (& node $ArtifactTool source-digest | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "Falha ao identificar as fontes do agente" }

Push-Location $AgentRoot
try {
  npm.cmd run build:win
  if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o EXE Windows; MSI nao sera gerado" }
} finally { Pop-Location }

function Sign-Artifact([string]$Path) {
  if (-not $env:NODEACCESS_CODE_SIGN_CERTIFICATE) { return }
  if (-not (Test-Path $env:NODEACCESS_CODE_SIGN_CERTIFICATE)) {
    throw "Certificado de assinatura nao encontrado: $env:NODEACCESS_CODE_SIGN_CERTIFICATE"
  }
  if (-not (Get-Command signtool -ErrorAction SilentlyContinue)) {
    throw "signtool nao encontrado. Instale o Windows SDK para assinar os artefatos."
  }
  $arguments = @(
    'sign', '/fd', 'SHA256', '/td', 'SHA256',
    '/tr', $(if ($env:NODEACCESS_TIMESTAMP_URL) { $env:NODEACCESS_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' }),
    '/f', $env:NODEACCESS_CODE_SIGN_CERTIFICATE
  )
  if ($env:NODEACCESS_CODE_SIGN_PASSWORD) { $arguments += @('/p', $env:NODEACCESS_CODE_SIGN_PASSWORD) }
  $arguments += $Path
  & signtool @arguments
  if ($LASTEXITCODE -ne 0) { throw "Falha ao assinar $Path" }
  $Signature = Get-AuthenticodeSignature $Path
  if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Thumbprint -ine $env:NODEACCESS_CODE_SIGN_THUMBPRINT) { throw "Editor ou assinatura inesperados: $Path" }
}

$AgentExecutable = Join-Path $AgentRoot "dist\nodeaccess-agent-win.exe"
if (-not (Test-Path $AgentExecutable)) {
  throw "Executavel Windows nao encontrado: $AgentExecutable"
}
Sign-Artifact $AgentExecutable

# Executa o proprio artefato que sera distribuido. Isso evita empacotar um EXE
# antigo que nao entenda os argumentos usados pelos scripts do painel.
$DetectedVersion = (& $AgentExecutable --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $DetectedVersion -ne "NodeAccess Agent $Version") {
  throw "Versao inesperada no EXE: '$DetectedVersion' (esperada: NodeAccess Agent $Version)"
}
$PreviousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$AgentHelp = (& $AgentExecutable 2>&1 | Out-String)
$ErrorActionPreference = $PreviousErrorActionPreference
if ($AgentHelp -notmatch [regex]::Escape('--token-file') -or $AgentHelp -notmatch '--check' -or $AgentHelp -notmatch '--status-file') {
  throw "EXE incompativel: a opcao --token-file nao foi encontrada"
}

$DesktopExecutable = Join-Path $AgentRoot 'dist\nodeaccess-desktop.exe'
$VersionSource = Join-Path $AgentRoot 'dist\DesktopVersion.cs'
[IO.File]::WriteAllText($VersionSource, ('[assembly: System.Reflection.AssemblyVersion("' + $Version + '.0")]'))
$Compiler = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'
& $Compiler /nologo /target:winexe /platform:x64 "/out:$DesktopExecutable" /reference:System.Windows.Forms.dll "/win32icon:$(Join-Path $PSScriptRoot '..\branding\nodeaccess.ico')" (Join-Path $PSScriptRoot 'Desktop.cs') $VersionSource
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o aplicativo da bandeja' }
Sign-Artifact $DesktopExecutable

$Output = Join-Path $AgentRoot "dist\nodeaccess-agent-windows-x64.msi"
wix build `
  (Join-Path $PSScriptRoot "NodeAccessAgent.wxs") `
  -arch x64 `
  -pdbtype none `
  -d "ProductVersion=$Version" `
  -d "AgentExecutable=$AgentExecutable" `
  -d "DesktopExecutable=$DesktopExecutable" `
  -d "BrandingDir=$(Join-Path $PSScriptRoot '..\branding')" `
  -d "AgentReleaseTrust=$(Join-Path $PSScriptRoot 'release-trust.json')" `
  -d "AgentUpdatesScript=$(Join-Path $PSScriptRoot 'AgentUpdates.ps1')" `
  -d "AgentSetupScript=$(Join-Path $PSScriptRoot 'AgentSetup.ps1')" `
  -o $Output

if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o MSI" }
Sign-Artifact $Output
$FinalSourceDigest = (& node $ArtifactTool source-digest | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $FinalSourceDigest -ne $SourceDigest) {
  throw "Fontes alteradas durante o build; gere novamente os artefatos"
}

$Artifacts = @($AgentExecutable, $Output)
foreach ($Artifact in $Artifacts) {
  $Hash = (Get-FileHash -Algorithm SHA256 $Artifact).Hash.ToLowerInvariant()
  $ChecksumPath = "$Artifact.sha256"
  # LF mantem o arquivo compativel com sha256sum no Linux e Get-FileHash no Windows.
  [IO.File]::WriteAllText($ChecksumPath, "$Hash  $([IO.Path]::GetFileName($Artifact))`n", [Text.Encoding]::ASCII)
}

$Manifest = [ordered]@{
  product = 'NodeAccess Agent'
  version = $Version
  platform = 'windows'
  architecture = 'x64'
  sourceSha256 = $SourceDigest
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  artifacts = @($Artifacts | ForEach-Object {
    $Item = Get-Item $_
    [ordered]@{
      file = $Item.Name
      size = $Item.Length
      sha256 = (Get-FileHash -Algorithm SHA256 $Item.FullName).Hash.ToLowerInvariant()
    }
  })
}
$ManifestPath = Join-Path $AgentRoot 'dist\nodeaccess-agent-windows-x64.json'
$ManifestJson = $Manifest | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($ManifestPath, "$ManifestJson`n", (New-Object Text.UTF8Encoding($false)))
& node $SigningTool sign-windows (Join-Path $AgentRoot 'dist\nodeaccess-agent-windows-x64.json')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao assinar manifesto' }
& node $ArtifactTool validate
if ($LASTEXITCODE -ne 0) { throw "Falha na validacao final dos artefatos Windows" }
Write-Host "MSI gerado: $Output"
