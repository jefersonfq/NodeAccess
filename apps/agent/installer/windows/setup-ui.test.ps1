param([string]$ScreenshotPath = '')
$ErrorActionPreference = 'Stop'
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('nodeaccess-setup-ui-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory $TestRoot | Out-Null
Copy-Item (Join-Path $PSScriptRoot '..\branding\logo.png') $TestRoot
Copy-Item (Join-Path $PSScriptRoot '..\branding\nodeaccess.ico') $TestRoot
$Source = Get-Content (Join-Path $PSScriptRoot 'AgentSetup.ps1') -Raw
$TestState = Join-Path $TestRoot 'state'
$Source = $Source.Replace("Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'NodeAccess\Agent'", "'$($TestState.Replace("'", "''"))'")
$Source = $Source.Replace("'Local\NodeAccess.Agent.Desktop.'", "'Local\NodeAccess.Agent.Test.$([guid]::NewGuid()).'")
$Source = $Source.Replace("Join-Path ([Environment]::GetFolderPath('Startup')) 'NodeAccess Agent.lnk'", "'$TestRoot\startup.lnk'")
$Probe = @'
$Form.Show()
[Windows.Forms.Application]::DoEvents()
if (-not $Brand.Image -or -not $Form.Icon) { throw 'Missing NodeAccess branding' }
if ($Start.Enabled -or $Stop.Enabled) { throw 'Unconfigured agent permits start/stop' }
if (-not $TokenInput.UseSystemPasswordChar) { throw 'Token input is not masked' }
if ($Form.AcceptButton -ne $Save) { throw 'Enter does not activate the primary action' }
if (-not $Save.Enabled -or -not $ServerInput.AccessibleName -or -not $TokenInput.AccessibleName) { throw 'Missing accessible controls' }
$ServerInput.Text = 'https://nodeaccess.example.com'
$TokenInput.Text = 'ui-test-credential'
function Get-AgentProcess { return $null }
function Save-AgentConfiguration { throw 'Token recusado (simulacao)' }
$Save.PerformClick()
if (-not $Feedback.Text.Contains('Token recusado') -or -not $Save.Enabled) { throw 'Validation failure is not actionable' }
function Save-AgentConfiguration { }
$Save.PerformClick()
if ($TokenInput.Text -ne '' -or -not $Feedback.Text.Contains('Configuracao salva')) { throw 'Successful configuration did not clear the token' }
New-Item -ItemType Directory -Force $StateRoot | Out-Null
'{}' | Set-Content $ConfigPath
'fixture' | Set-Content $TokenPath
function Get-AgentProcess { return [pscustomobject]@{ Id = 717 } }
@{ pid = 717; state = 'connected'; name = 'Agente de teste'; server = 'https://example.test'; activeConnections = 2; version = '1.3.0' } | ConvertTo-Json | Set-Content $StatusPath
Update-AgentStatus
if ($Status.Text -notmatch 'Conectado' -or $Status.Text -notmatch 'Conexoes ativas: 2' -or $Status.Text -notmatch 'PID 717') { throw 'Connected details are missing' }
@{ pid = 999; state = 'connected' } | ConvertTo-Json | Set-Content $StatusPath
Update-AgentStatus
if ($Status.Text -ne 'Agente iniciando...') { throw 'Stale status from another process accepted' }
function Get-AgentProcess { return $null }
Update-AgentStatus
if ($Status.Text -ne 'Agente parado.') { throw 'Stopped process displayed as connected' }
$LocalVersion = '1.3.1'
function Get-ConfiguredUpdateServer { return 'https://example.test' }
function Receive-Job { return $script:FixtureUpdate }
function Remove-Job { }
$script:NotifiedUpdate = 'https://example.test9.0.0'
$script:FixtureUpdate = [pscustomobject]@{ state = 'available'; version = '9.0.0'; server = 'https://example.test' }
$script:UpdateJob = [pscustomobject]@{ State = 'Completed' }
Complete-UpdateCheck
if (-not $DownloadUpdate.Visible -or $DownloadUpdate.Text -ne 'Baixar atualizacao' -or $UpdateStatus.Text -notmatch '9.0.0') { throw 'Update offer is missing' }
$script:FixtureUpdate = [pscustomobject]@{ state = 'downloaded'; version = '9.0.0'; server = 'https://example.test'; path = 'fixture.msi'; sha256 = 'fixture' }
$script:UpdateJob = [pscustomobject]@{ State = 'Completed' }
Complete-UpdateCheck
if ($DownloadUpdate.Text -ne 'Abrir instalador' -or -not $script:UpdatePackage) { throw 'Verified package cannot be opened explicitly' }
$script:UpdatePackage = $null
$script:FixtureUpdate = [pscustomobject]@{ state = 'error'; server = 'https://example.test' }
$script:UpdateJob = [pscustomobject]@{ State = 'Completed' }
Complete-UpdateCheck
if ($UpdateStatus.Text -notmatch 'tente novamente') { throw 'Update failure lacks retry guidance' }
$script:FixtureUpdate = [pscustomobject]@{ state = 'available'; version = '9.0.0'; server = 'https://old.example.test' }
$script:UpdateJob = [pscustomobject]@{ State = 'Completed' }
Complete-UpdateCheck
if ($UpdateStatus.Text -notmatch 'Servidor alterado') { throw 'Response from old server accepted' }
if ($env:NODEACCESS_SETUP_SCREENSHOT) {
  $Bitmap = New-Object Drawing.Bitmap($Form.Width, $Form.Height)
  $Form.DrawToBitmap($Bitmap, (New-Object Drawing.Rectangle(0, 0, $Form.Width, $Form.Height)))
  $Bitmap.Save($env:NODEACCESS_SETUP_SCREENSHOT, [Drawing.Imaging.ImageFormat]::Png)
  $Bitmap.Dispose()
}
$Form.Close()
if ($Form.Visible -or -not $Tray.Visible) { throw 'Closing window must preserve tray' }
Show-AgentWindow
if (-not $Form.Visible) { throw 'Tray cannot reopen window' }
$script:ExitDesktop = $true
$Form.Close()
Write-Host 'PASS: assistant UI masks token, shows failure, permits retry and clears credentials on success'
'@
$Source = $Source.Replace('[Windows.Forms.Application]::Run($Form)', $Probe)
$Source = $Source.Replace('try { Assert-AgentCompatible } catch', 'try { } catch')
$TestScript = Join-Path $TestRoot 'ui-test.ps1'
[IO.File]::WriteAllText($TestScript, $Source)
try {
  $env:NODEACCESS_SETUP_SCREENSHOT = $ScreenshotPath
  & $TestScript
} finally {
  Remove-Item Env:NODEACCESS_SETUP_SCREENSHOT -ErrorAction SilentlyContinue
  Remove-Item $TestRoot -Recurse -Force
}
