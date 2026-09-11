# Diagnostico opt-in. Nao substitui config.json nem agent.token.
param(
  [Parameter(Mandatory=$true)][string]$Server,
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'NodeAccess')
)
$ErrorActionPreference = 'Stop'
$Setup = Join-Path $InstallDir 'AgentSetup.ps1'
$Executable = Join-Path $InstallDir 'nodeaccess-agent.exe'
if (-not (Test-Path $Setup) -or -not (Test-Path $Executable)) {
  throw 'Instalacao nao localizada. Informe -InstallDir com a pasta instalada.'
}
. $Setup -LibraryOnly
$Server = Get-AgentServer $Server
Initialize-AgentDirectory
& $Executable --version
Write-Host ('Configuracao salva existente: ' + (Test-Path $ConfigPath))
$Candidate = Join-Path $StateRoot ([guid]::NewGuid().ToString() + '.diagnostic.token')
$SecureToken = Read-Host 'Cole o token do agente (entrada oculta)' -AsSecureString
$Buffer = [IntPtr]::Zero
$PlainToken = $null
try {
  $Buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
  $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Buffer).Trim()
  if (-not $PlainToken) { throw 'Token vazio.' }
  [IO.File]::WriteAllText($Candidate, $PlainToken, (New-Object Text.UTF8Encoding($false)))
  Write-Host 'Verificando registro por ate 10 segundos; configuracao anterior sera preservada...'
  # Invocacao direta permite comparar o resultado real com o Start-Process do assistente.
  $PreviousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $Output = & $Executable --check --server $Server --token-file $Candidate 2>&1
    $CheckExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $PreviousPreference }
  foreach ($Line in $Output) {
    $SafeLine = ([string]$Line).Replace($PlainToken, '[TOKEN OCULTO]')
    $SafeLine = $SafeLine -replace '(?i)(token=)[^\s&"'']+', '$1[OCULTO]'
    Write-Host $SafeLine
  }
  Write-Host "Codigo de saida do registro: $CheckExitCode"
  Write-Host '0 = registro aceito; outro valor = falha. Nenhuma configuracao foi substituida.'
} finally {
  if (Test-Path $Candidate) { Remove-Item $Candidate -Force }
  if ($Buffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Buffer) }
  $PlainToken = $null
  $SecureToken.Dispose()
}
