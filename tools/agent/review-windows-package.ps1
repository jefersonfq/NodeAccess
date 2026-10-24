# Read-only: does not run msiexec or change certificate trust.
param(
  [Parameter(Mandatory=$true)][string]$ArtifactDirectory,
  [string]$ExpectedVersion = '',
  [switch]$RequireSigned
)
$ErrorActionPreference = 'Stop'
$Directory = (Resolve-Path $ArtifactDirectory).Path
$Manifest = Get-Content (Join-Path $Directory 'nodeaccess-agent-windows-x64.json') -Raw | ConvertFrom-Json
if ($ExpectedVersion -and $Manifest.version -ne $ExpectedVersion) { throw 'Unexpected manifest version' }
$Artifacts = @()
foreach ($Name in @('nodeaccess-agent-win.exe', 'nodeaccess-agent-windows-x64.msi')) {
  $Path = Join-Path $Directory $Name
  $File = Get-Item $Path
  $Hash = (Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  $Entries = @($Manifest.artifacts | Where-Object { $_.file -ceq $Name })
  if ($Entries.Count -ne 1 -or $Entries[0].sha256 -cne $Hash -or $Entries[0].size -ne $File.Length) {
    throw "Manifest integrity mismatch: $Name"
  }
  if ((Get-Content "$Path.sha256" -Raw).Trim() -cne "$Hash  $Name") { throw "Checksum mismatch: $Name" }
  $Signature = Get-AuthenticodeSignature $Path
  if ($RequireSigned -and $Signature.Status -ne 'Valid') { throw "Invalid Authenticode signature: $Name" }
  $Artifacts += [pscustomobject]@{
    file = $Name; size = $File.Length; sha256 = $Hash
    signatureStatus = [string]$Signature.Status
    publisher = $(if ($Signature.SignerCertificate) { $Signature.SignerCertificate.Subject } else { $null })
  }
}
$Installer = New-Object -ComObject WindowsInstaller.Installer
$Database = $null
function Read-MsiRows([string]$Query, [string[]]$Columns) {
  $View = $Database.OpenView($Query.Replace('#', [string][char]96))
  try {
    $null = $View.Execute()
    while ($Record = $View.Fetch()) {
      try {
        $Row = [ordered]@{}
        for ($i = 0; $i -lt $Columns.Count; $i++) { $Row[$Columns[$i]] = $Record.StringData($i + 1) }
        [pscustomobject]$Row
      } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Record) }
    }
  } finally {
    $null = $View.Close()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($View)
  }
}
try {
  $Database = $Installer.OpenDatabase((Join-Path $Directory 'nodeaccess-agent-windows-x64.msi'), 0)
  $Properties = @(Read-MsiRows 'SELECT #Property#, #Value# FROM #Property#' @('name','value'))
  $Version = ($Properties | Where-Object { $_.name -eq 'ProductVersion' }).value
  if ($Version -ne $Manifest.version) { throw 'MSI/manifest version mismatch' }
  $Files = @(Read-MsiRows 'SELECT #FileName#, #FileSize# FROM #File#' @('name','size'))
  $ExpectedFiles = @('nodeaccess-agent.exe','nodeaccess-desktop.exe','AgentSetup.ps1','AgentUpdates.ps1','release-trust.json','nodeaccess.ico','logo.png')
  $ActualFiles = @($Files | ForEach-Object { ($_.name -split '\|')[-1] })
  if (Compare-Object ($ExpectedFiles | Sort-Object) ($ActualFiles | Sort-Object)) { throw ('Unexpected MSI payload inventory: ' + ($ActualFiles -join ', ')) }
  $Actions = @(Read-MsiRows 'SELECT #Action#, #Type#, #Source#, #Target# FROM #CustomAction#' @('name','type','source','target'))
  [pscustomobject]@{
    schemaVersion = 1; version = $Version; sourceSha256 = $Manifest.sourceSha256
    artifacts = $Artifacts
    properties = @($Properties | Where-Object { $_.name -in @('ProductName','ProductVersion','Manufacturer','UpgradeCode') })
    files = $Files; customActions = $Actions
    limitations = @('Does not verify manifest cryptographic signature: use artifacts.mjs validate with an independent release public key.',
      'Does not scan for malware, install the package, or measure SmartScreen reputation.',
      'RequireSigned checks signature validity; verify the expected publisher separately for production.')
  } | ConvertTo-Json -Depth 6
} finally {
  if ($Database) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Database) }
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Installer)
}
