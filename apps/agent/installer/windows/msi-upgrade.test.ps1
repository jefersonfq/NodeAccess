# Read-only checks against the compiled MSI; never installs or removes a product.
$ErrorActionPreference = 'Stop'
$Msi = (Resolve-Path (Join-Path $PSScriptRoot '..\..\dist\nodeaccess-agent-windows-x64.msi')).Path
$Installer = New-Object -ComObject WindowsInstaller.Installer
$Database = $Installer.OpenDatabase($Msi, 0)
function Read-Row([string]$Query, [int]$Count = 1) {
  $View = $Database.OpenView($Query)
  try {
    $null = $View.Execute()
    $Record = $View.Fetch()
    if (-not $Record) { return $null }
    $Values = @()
    for ($Index = 1; $Index -le $Count; $Index++) { $Values += $Record.StringData($Index) }
    return [pscustomobject]@{ Fields = $Values }
  } finally { $null = $View.Close() }
}
$Confirm = Read-Row 'SELECT `Condition`, `Sequence` FROM `InstallUISequence` WHERE `Action`=''AgentUpgradeConfirm''' 2
$Execute = Read-Row 'SELECT `Sequence` FROM `InstallUISequence` WHERE `Action`=''ExecuteAction'''
$Find = Read-Row 'SELECT `Sequence` FROM `InstallUISequence` WHERE `Action`=''FindRelatedProducts'''
if (-not $Confirm -or $Confirm.Fields[0] -notmatch 'WIX_UPGRADE_DETECTED AND NOT Installed' -or $Confirm.Fields[0] -notmatch 'REMOVE') { throw 'Upgrade offer is not scoped to an existing older product' }
if ([int]$Confirm.Fields[1] -ge [int]$Execute.Fields[0] -or [int]$Confirm.Fields[1] -le [int]$Find.Fields[0]) { throw 'Confirmation must follow detection and precede installation' }
$Cancel = Read-Row 'SELECT `Argument` FROM `ControlEvent` WHERE `Dialog_`=''AgentUpgradeConfirm'' AND `Control_`=''Cancel'' AND `Event`=''EndDialog'''
$Update = Read-Row 'SELECT `Argument` FROM `ControlEvent` WHERE `Dialog_`=''AgentUpgradeConfirm'' AND `Control_`=''Update'' AND `Event`=''EndDialog'''
if ($Cancel.Fields[0] -ne 'Exit' -or $Update.Fields[0] -ne 'Return') { throw 'Cancel/update actions are incorrect' }
$Initialize = Read-Row 'SELECT `Sequence` FROM `InstallExecuteSequence` WHERE `Action`=''InstallInitialize'''
$Remove = Read-Row 'SELECT `Sequence` FROM `InstallExecuteSequence` WHERE `Action`=''RemoveExistingProducts'''
$Finalize = Read-Row 'SELECT `Sequence` FROM `InstallExecuteSequence` WHERE `Action`=''InstallFinalize'''
if ([int]$Remove.Fields[0] -le [int]$Initialize.Fields[0] -or [int]$Remove.Fields[0] -ge [int]$Finalize.Fields[0]) { throw 'Old version removal is outside the rollback transaction' }
$Message = Read-Row 'SELECT `Text` FROM `Control` WHERE `Dialog_`=''AgentSetupComplete'' AND `Control`=''Message'''
if ($Message.Fields[0] -ne '[AGENT_COMPLETION_MESSAGE]') { throw 'Completion cannot distinguish upgrade from installation' }
Write-Host 'PASS: compiled MSI upgrade detection, pre-install confirmation, cancellation, completion and rollback sequencing'
