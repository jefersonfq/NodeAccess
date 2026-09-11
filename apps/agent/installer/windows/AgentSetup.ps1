param([switch]$Run, [switch]$LibraryOnly)
$ErrorActionPreference = 'Stop'
$AgentExe = Join-Path $PSScriptRoot 'nodeaccess-agent.exe'
$StateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'NodeAccess\Agent'
$ConfigPath = Join-Path $StateRoot 'config.json'
$TokenPath = Join-Path $StateRoot 'agent.token'
$PolicyPath = Join-Path $StateRoot 'policy.json'
$StatusPath = Join-Path $StateRoot 'status.json'
$ProcessPath = Join-Path $StateRoot 'process.json'
$StartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'NodeAccess Agent.lnk'

function Get-AgentServer([string]$Value) {
  $Uri = $null
  if (-not [Uri]::TryCreate($Value.Trim(), [UriKind]::Absolute, [ref]$Uri) -or
      $Uri.Scheme -notin @('https', 'wss') -or -not $Uri.Host -or $Uri.UserInfo -or $Uri.Query -or $Uri.Fragment -or $Uri.AbsolutePath -ne '/') {
    throw 'Informe a URL HTTPS do NodeAccess, sem caminho, usuario ou token. Exemplo: https://nodeaccess.empresa.com'
  }
  return $Uri.GetLeftPart([UriPartial]::Authority)
}
function Initialize-AgentDirectory {
  New-Item -ItemType Directory -Force $StateRoot | Out-Null
  $Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe $StateRoot /inheritance:r /grant:r "*${Sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel proteger o diretorio de configuracao.' }
}
function Invoke-AgentInspection([string]$Arguments) {
  Initialize-AgentDirectory
  $OutputPath = Join-Path $StateRoot ([guid]::NewGuid().ToString() + '.out')
  $ErrorPath = $OutputPath + '.err'
  $Child = $null
  try {
    $Child = Start-Process -FilePath $AgentExe -ArgumentList $Arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $OutputPath -RedirectStandardError $ErrorPath
    $null = $Child.Handle
    if (-not $Child.WaitForExit(5000)) { $Child.Kill(); throw 'Executavel do agente nao respondeu. Repare a instalacao.' }
    $Child.WaitForExit()
    return ((Get-Content $OutputPath -Raw -ErrorAction SilentlyContinue) + (Get-Content $ErrorPath -Raw -ErrorAction SilentlyContinue))
  } finally {
    if ($Child) { $Child.Dispose() }
    Remove-Item $OutputPath, $ErrorPath -Force -ErrorAction SilentlyContinue
  }
}
function Assert-AgentCompatible {
  if (-not (Test-Path $AgentExe)) { throw 'Executavel ausente. Instale ou repare o NodeAccess Agent.' }
  $Version = Invoke-AgentInspection '--version'
  $Help = Invoke-AgentInspection '--help'
  if ($Version -notmatch 'NodeAccess Agent \d+\.\d+\.\d+' -or $Help -notmatch '--token-file' -or $Help -notmatch '--check' -or $Help -notmatch '--status-file') {
    throw 'Executavel incompativel com o assistente. Instale ou repare o pacote atual do NodeAccess Agent antes de informar o token.'
  }
}
function Get-AgentRegistrationError([string]$Path) {
  $Code = ''
  try { $Code = (Get-Content $Path -Raw | ConvertFrom-Json).diagnostic } catch { }
  switch ($Code) {
    'tls' { return 'Certificado TLS nao confiavel ou invalido. Confira a cadeia do certificado do servidor.' }
    'dns' { return 'Servidor nao encontrado no DNS. Confira o endereco e a VPN.' }
    'refused' { return 'Servidor recusou a conexao. Confira o endereco, firewall e disponibilidade.' }
    'rejected' { return 'Registro recusado pelo servidor. Confira o token e as permissoes do agente.' }
    'http' { return 'Resposta HTTP inesperada. Confira a rota /ws/agent no proxy do servidor.' }
    'timeout' { return 'Tempo limite no registro. Confira servidor, rede e VPN.' }
    default { return 'Conexao de registro interrompida. Confira servidor, rede e VPN.' }
  }
}
function Get-AgentProcess {
  if (-not (Test-Path $ProcessPath)) { return $null }
  try {
    $Record = Get-Content $ProcessPath -Raw | ConvertFrom-Json
    $Process = Get-Process -Id $Record.id -ErrorAction Stop
    if ($Process.Path -eq $AgentExe -and $Process.StartTime.ToUniversalTime().Ticks.ToString() -eq $Record.started) { return $Process }
  } catch { }
  return $null
}
function Stop-AgentProcess {
  $Process = Get-AgentProcess
  if ($Process) { Stop-Process -Id $Process.Id -ErrorAction Stop; $Process.WaitForExit() }
}
function Start-AgentProcess {
  if (Get-AgentProcess) { return }
  if (-not (Test-Path $ConfigPath)) { throw 'Ainda nao configurado. Informe servidor e token e clique em Validar e conectar.' }
  Assert-AgentCompatible
  try { $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json } catch { throw 'Configuracao local invalida. Configure novamente em Validar e conectar.' }
  $Server = Get-AgentServer $Config.server
  if (-not (Test-Path $TokenPath)) { throw 'Configure o token antes de iniciar.' }
  $Arguments = '--server "' + $Server + '" --token-file "' + $TokenPath + '" --status-file "' + $StatusPath + '"'
  if (Test-Path $PolicyPath) { $Arguments += ' --policy "' + $PolicyPath + '"' }
  $Process = Start-Process -FilePath $AgentExe -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  @{ id = $Process.Id; started = $Process.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json | Set-Content $ProcessPath -Encoding UTF8
}
function Set-AgentStartup([bool]$Enabled) {
  if ($Enabled) {
    $Shell = New-Object -ComObject WScript.Shell
    $Link = $Shell.CreateShortcut($StartupLink)
    $Link.TargetPath = Join-Path $PSHOME 'powershell.exe'
    $Link.Arguments = '-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Run'
    $DesktopExe = Join-Path $PSScriptRoot 'nodeaccess-desktop.exe'
    if (Test-Path $DesktopExe) { $Link.TargetPath = $DesktopExe; $Link.Arguments = '-Run' }
    $Link.IconLocation = (Join-Path $PSScriptRoot 'nodeaccess.ico') + ',0'
    $Link.Description = 'NodeAccess Agent - conexoes e status'
    $Link.WorkingDirectory = $PSScriptRoot
    $Link.Save()
  } elseif (Test-Path $StartupLink) { Remove-Item $StartupLink }
}
function Save-AgentConfiguration([string]$Server, [string]$Token, [bool]$AutoStart) {
  $Server = Get-AgentServer $Server
  if (-not $Token.Trim()) { throw 'Cole o token gerado no painel de Agentes.' }
  Assert-AgentCompatible
  Initialize-AgentDirectory
  $Candidate = Join-Path $StateRoot ([guid]::NewGuid().ToString() + '.token')
  $ProbeStatus = $Candidate + '.status.json'
  $Probe = $null
  try {
    [IO.File]::WriteAllText($Candidate, $Token.Trim(), (New-Object Text.UTF8Encoding($false)))
    $Probe = Start-Process -FilePath $AgentExe -ArgumentList ('--check --server "' + $Server + '" --token-file "' + $Candidate + '" --status-file "' + $ProbeStatus + '"') -WindowStyle Hidden -PassThru
    $null = $Probe.Handle
    if (-not $Probe.WaitForExit(12000)) { $Probe.Kill(); throw 'Tempo limite. Verifique servidor, VPN e certificado TLS.' }
    $Probe.WaitForExit()
    if ($null -eq $Probe.ExitCode -or $Probe.ExitCode -ne 0) { throw ((Get-AgentRegistrationError $ProbeStatus) + ' Nenhuma configuracao foi substituida.') }
    Stop-AgentProcess
    Copy-Item $Candidate $TokenPath -Force
    @{ server = $Server; autoStart = $AutoStart } | ConvertTo-Json | Set-Content $ConfigPath -Encoding UTF8
    Set-AgentStartup $AutoStart
    Start-AgentProcess
  } finally {
    if ($Probe) { if (-not $Probe.HasExited) { $Probe.Kill() }; $Probe.Dispose() }
    if (Test-Path $ProbeStatus) { Remove-Item $ProbeStatus -Force }
    if (Test-Path $Candidate) { Remove-Item $Candidate -Force }
  }
}
if ($LibraryOnly) { return }
# One desktop per Windows session. A second launch asks the existing window to open.
$InstanceName = 'Local\NodeAccess.Agent.Desktop.' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$Created = $false
$DesktopMutex = New-Object Threading.Mutex($true, $InstanceName, [ref]$Created)
$OpenEvent = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, ($InstanceName + '.Open'))
if (-not $Created) {
  if (-not $Run) { $null = $OpenEvent.Set() }
  $OpenEvent.Dispose(); $DesktopMutex.Dispose(); return
}


Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$Form = New-Object Windows.Forms.Form
$Form.Text = 'NodeAccess Agent - Configuracao e status'
$Form.Size = New-Object Drawing.Size(660, 680)
$Form.BackColor = [Drawing.Color]::FromArgb(248, 250, 252)
$Form.ForeColor = [Drawing.Color]::FromArgb(30, 41, 59)
$BrandRoot = $PSScriptRoot
if (-not (Test-Path (Join-Path $BrandRoot 'logo.png'))) { $BrandRoot = Join-Path $PSScriptRoot '..\branding' }
if (Test-Path (Join-Path $BrandRoot 'nodeaccess.ico')) { $Form.Icon = New-Object Drawing.Icon((Join-Path $BrandRoot 'nodeaccess.ico')) }
$Form.MinimumSize = $Form.Size
$Form.StartPosition = 'CenterScreen'
$Form.Font = New-Object Drawing.Font('Segoe UI', 10)
$Form.AutoScaleMode = 'Dpi'
$Layout = New-Object Windows.Forms.TableLayoutPanel
$Layout.Dock = 'Fill'; $Layout.Padding = New-Object Windows.Forms.Padding(24)
$Layout.AutoScroll = $true
$Layout.ColumnCount = 1; $Layout.RowCount = 0
$Layout.GrowStyle = 'AddRows'
$Form.Controls.Add($Layout)
$Brand = New-Object Windows.Forms.PictureBox
$Brand.Size = New-Object Drawing.Size(420, 104)
$Brand.SizeMode = 'Zoom'; $Brand.AccessibleName = 'NodeAccess'
if (Test-Path (Join-Path $BrandRoot 'logo.png')) { $Brand.Image = [Drawing.Image]::FromFile((Join-Path $BrandRoot 'logo.png')) }
$Layout.Controls.Add($Brand)

function Add-Label([string]$Text) {
  $Label = New-Object Windows.Forms.Label
  $Label.Text = $Text; $Label.AutoSize = $true; $Label.MaximumSize = New-Object Drawing.Size(540, 0)
  $Label.Margin = New-Object Windows.Forms.Padding(0, 4, 0, 6)
  $Layout.Controls.Add($Label)
  return $Label
}
$Heading = Add-Label 'Sua rede, conectada com seguranca.'
$Heading.Font = New-Object Drawing.Font('Segoe UI', 14, [Drawing.FontStyle]::Bold)
$null = Add-Label 'Informe o servidor e cole o token do portal. O agente usa a rede e a VPN deste usuario Windows para as conexoes autorizadas.'
$null = Add-Label '&Servidor (HTTPS)'
$ServerInput = New-Object Windows.Forms.TextBox
$ServerInput.Font = New-Object Drawing.Font('Segoe UI', 11)
$ServerInput.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 10)
$ServerInput.Dock = 'Top'; $ServerInput.AccessibleName = 'Servidor NodeAccess'; $Layout.Controls.Add($ServerInput)
$null = Add-Label '&Token gerado no painel de Agentes'
$TokenInput = New-Object Windows.Forms.TextBox
$TokenInput.Font = New-Object Drawing.Font('Segoe UI', 11)
$TokenInput.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 10)
$TokenInput.Dock = 'Top'; $TokenInput.UseSystemPasswordChar = $true; $TokenInput.AccessibleName = 'Token do agente'; $Layout.Controls.Add($TokenInput)
$AutoStart = New-Object Windows.Forms.CheckBox
$AutoStart.Text = 'Iniciar quando eu entrar no Windows'; $AutoStart.Checked = $true; $AutoStart.AutoSize = $true
$Layout.Controls.Add($AutoStart)
$Buttons = New-Object Windows.Forms.FlowLayoutPanel
$Buttons.AutoSize = $true; $Buttons.Dock = 'Top'; $Layout.Controls.Add($Buttons)
function Add-Button([string]$Text) {
  $Button = New-Object Windows.Forms.Button
  $Button.Text = $Text; $Button.AutoSize = $true; $Button.FlatStyle = 'Flat'; $Button.Padding = New-Object Windows.Forms.Padding(10, 6, 10, 6); $Button.Margin = New-Object Windows.Forms.Padding(0, 10, 8, 12); $Buttons.Controls.Add($Button); return $Button
}
$Save = Add-Button 'Validar e conectar'
$Save.BackColor = [Drawing.Color]::FromArgb(37, 99, 235)
$Save.ForeColor = [Drawing.Color]::White
$Save.FlatAppearance.BorderSize = 0
$Form.AcceptButton = $Save
$Start = Add-Button 'Iniciar'
$Stop = Add-Button 'Parar'
$CheckUpdate = Add-Button 'Verificar atualizacoes'
$CheckUpdate.Enabled = $false
$DownloadUpdate = Add-Button 'Baixar atualizacao'
$DownloadUpdate.Visible = $false
$Status = Add-Label 'Ainda nao configurado. Informe o servidor e o primeiro token.'
$Status.Font = New-Object Drawing.Font('Segoe UI', 10, [Drawing.FontStyle]::Bold)
$Status.BackColor = [Drawing.Color]::FromArgb(226, 232, 240)
$Status.Padding = New-Object Windows.Forms.Padding(10)
$UpdateStatus = Add-Label 'Atualizacoes: consultadas no servidor configurado, em segundo plano.'
$Feedback = Add-Label 'Para trocar o token, gere um novo no portal e cole acima. A troca interrompe conexoes deste agente.'
$null = Add-Label 'Fechar esta janela oculta o aplicativo ao lado do relogio. Use o icone NodeAccess para abrir o status ou parar o agente. A inicializacao pode ser desativada no Gerenciador de Tarefas.'
if (Test-Path $ConfigPath) {
  try { $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json; $ServerInput.Text = $Config.server; $AutoStart.Checked = $Config.autoStart } catch { $Feedback.Text = 'Configuracao local invalida. Informe os dados novamente.' }
}
$script:Saving = $false
$script:Compatible = $true
try { Assert-AgentCompatible } catch { $script:Compatible = $false; $Feedback.Text = $_.Exception.Message }
function Update-AgentButtons {
  $Configured = (Test-Path $ConfigPath) -and (Test-Path $TokenPath)
  $Running = $null -ne (Get-AgentProcess)
  $Save.Enabled = $script:Compatible -and -not $script:Saving
  $TokenInput.Enabled = $script:Compatible -and -not $script:Saving
  $Start.Enabled = $script:Compatible -and $Configured -and -not $Running -and -not $script:Saving
  $Stop.Enabled = $Running -and -not $script:Saving
}
Update-AgentButtons
$Save.Add_Click({
  if (Get-AgentProcess) {
    $Answer = [Windows.Forms.MessageBox]::Show('Trocar a configuracao interrompe as conexoes deste agente. Continuar?', 'Confirmar troca', 'YesNo', 'Warning')
    if ($Answer -ne 'Yes') { return }
  }
  $script:Saving = $true; $Save.Enabled = $false; $Start.Enabled = $false; $Stop.Enabled = $false
  $Feedback.Text = 'Validando token e conexao (ate 12 segundos)...'; $Form.Refresh()
  try {
    Save-AgentConfiguration $ServerInput.Text $TokenInput.Text $AutoStart.Checked
    $TokenInput.Clear(); $Status.Text = 'Agente iniciando...'; $Feedback.Text = 'Configuracao salva. Acompanhe abaixo a conexao com o servidor.'
  } catch { $Feedback.Text = $_.Exception.Message }
  finally { $script:Saving = $false; Update-AgentButtons }
})
$Start.Add_Click({ try { Initialize-AgentDirectory; Start-AgentProcess } catch { $Feedback.Text = $_.Exception.Message } })
$Stop.Add_Click({
  if ([Windows.Forms.MessageBox]::Show('Parar interrompe as conexoes deste agente. Continuar?', 'Parar agente', 'YesNo', 'Warning') -eq 'Yes') {
    try { Stop-AgentProcess } catch { $Feedback.Text = $_.Exception.Message }
  }
})
$Tray = New-Object Windows.Forms.NotifyIcon
$Tray.Icon = $Form.Icon
$Tray.Text = 'NodeAccess Agent - iniciando'
$TrayMenu = New-Object Windows.Forms.ContextMenuStrip
$TrayStatus = $TrayMenu.Items.Add('NodeAccess Agent')
$TrayStatus.Enabled = $false
$TrayDetails = $TrayMenu.Items.Add('Abra o status para ver os detalhes')
$TrayDetails.Enabled = $false
$null = $TrayMenu.Items.Add('-')
$TrayOpen = $TrayMenu.Items.Add('Abrir configuracao e status')
$TrayStart = $TrayMenu.Items.Add('Iniciar agente')
$TrayStop = $TrayMenu.Items.Add('Parar agente...')
$null = $TrayMenu.Items.Add('-')
$TrayCheckUpdate = $TrayMenu.Items.Add('Verificar atualizacoes')
$TrayDownloadUpdate = $TrayMenu.Items.Add('Baixar atualizacao')
$TrayDownloadUpdate.Visible = $false
$TrayExit = $TrayMenu.Items.Add('Sair e parar agente...')
$Tray.ContextMenuStrip = $TrayMenu
$Tray.Visible = $true
$script:ExitDesktop = $false
function Show-AgentWindow {
  $Form.Show(); $Form.WindowState = 'Normal'; $Form.Activate()
}
$Tray.Add_DoubleClick({ Show-AgentWindow })
$TrayOpen.Add_Click({ Show-AgentWindow })
$TrayStart.Add_Click({ Show-AgentWindow; $Start.PerformClick() })
$TrayStop.Add_Click({ Show-AgentWindow; $Stop.PerformClick() })
$TrayExit.Add_Click({
  if ([Windows.Forms.MessageBox]::Show('Sair para o agente e interrompe suas conexoes. Continuar?', 'Sair do NodeAccess Agent', 'YesNo', 'Warning') -eq 'Yes') {
    try { Stop-AgentProcess; $script:ExitDesktop = $true; $Form.Close() } catch { $Feedback.Text = $_.Exception.Message; Show-AgentWindow }
  }
})
$UpdateWorker = Join-Path $PSScriptRoot 'AgentUpdates.ps1'
$script:UpdateJob = $null
$script:UpdatePackage = $null
$script:NextUpdateCheck = [DateTime]::UtcNow.AddSeconds(30 + (Get-Random -Maximum 30))
$script:NotifiedUpdate = ''
$DesktopFile = Join-Path $PSScriptRoot 'nodeaccess-desktop.exe'
$LocalVersion = if (Test-Path $DesktopFile) { ([version][Diagnostics.FileVersionInfo]::GetVersionInfo($DesktopFile).FileVersion).ToString(3) } else { '' }
function Get-ConfiguredUpdateServer {
  try { return (Get-Content $ConfigPath -Raw | ConvertFrom-Json).server } catch { return '' }
}
function Start-UpdateCheck([bool]$Download = $false) {
  if ($script:UpdateJob -or -not $LocalVersion -or -not (Test-Path $UpdateWorker)) { return }
  $Server = Get-ConfiguredUpdateServer
  if (-not $Server) { $UpdateStatus.Text = 'Configure o servidor antes de consultar atualizacoes.'; return }
  try {
    Initialize-AgentDirectory
    $Directory = Join-Path $StateRoot 'updates'
    New-Item -ItemType Directory -Force $Directory | Out-Null
    $script:UpdatePackage = $null
    $DownloadUpdate.Visible = $false; $TrayDownloadUpdate.Visible = $false
    $UpdateStatus.Text = if ($Download) { 'Baixando e conferindo o instalador...' } else { 'Consultando atualizacoes...' }
    $script:UpdateJob = Start-Job -ArgumentList $UpdateWorker, $Server, $LocalVersion, $Directory, $Download -ScriptBlock {
      param($Worker, $Server, $Version, $Directory, $Download)
      try { . $Worker; Invoke-AgentUpdate $Server $Version $Directory $Download }
      catch { [pscustomobject]@{ state = 'error'; server = $Server } }
    }
    $script:NextUpdateCheck = [DateTime]::UtcNow.AddHours(6)
  } catch { $UpdateStatus.Text = 'Nao foi possivel consultar atualizacoes. Tente novamente.'; $script:NextUpdateCheck = [DateTime]::UtcNow.AddMinutes(15) }
}
function Complete-UpdateCheck {
  if (-not $script:UpdateJob -or $script:UpdateJob.State -notin @('Completed', 'Failed', 'Stopped')) { return }
  $DownloadUpdate.Visible = $false; $TrayDownloadUpdate.Visible = $false
  $script:UpdatePackage = $null
  $Result = Receive-Job $script:UpdateJob -ErrorAction SilentlyContinue
  Remove-Job $script:UpdateJob -Force
  $script:UpdateJob = $null
  if ($Result -and $Result.server -ne (Get-ConfiguredUpdateServer)) { $UpdateStatus.Text = 'Servidor alterado. Consulte novamente as atualizacoes.'; return }
  switch ($Result.state) {
    'available' {
      $UpdateStatus.Text = "Atualizacao $($Result.version) disponivel (instalada: $LocalVersion)."
      $DownloadUpdate.Text = 'Baixar atualizacao'; $DownloadUpdate.Visible = $true
      $TrayDownloadUpdate.Text = 'Baixar atualizacao'; $TrayDownloadUpdate.Visible = $true
      if ($script:NotifiedUpdate -ne ($Result.server + $Result.version)) {
        $Tray.ShowBalloonTip(8000, 'Atualizacao do NodeAccess Agent', "Versao $($Result.version) disponivel. Abra o agente para baixar.", [Windows.Forms.ToolTipIcon]::Info)
        $script:NotifiedUpdate = $Result.server + $Result.version
      }
    }
    'downloaded' {
      $script:UpdatePackage = $Result
      $UpdateStatus.Text = "Instalador $($Result.version) baixado e verificado. Abra quando puder interromper as conexoes."
      $DownloadUpdate.Text = 'Abrir instalador'; $DownloadUpdate.Visible = $true
      $TrayDownloadUpdate.Text = 'Abrir instalador'; $TrayDownloadUpdate.Visible = $true
    }
    'current' { $UpdateStatus.Text = "Versao $LocalVersion atualizada em relacao a este servidor." }
    default { $UpdateStatus.Text = 'Nao foi possivel verificar ou baixar. Confira a rede e a disponibilidade da release no servidor e tente novamente.'; $script:NextUpdateCheck = [DateTime]::UtcNow.AddMinutes(15) }
  }
}
function Open-AgentUpdate {
  if (-not $script:UpdatePackage) { Start-UpdateCheck $true; return }
  if ($script:UpdatePackage.server -ne (Get-ConfiguredUpdateServer)) { $script:UpdatePackage = $null; Start-UpdateCheck; return }
  $WasRunning = $null -ne (Get-AgentProcess)
  try {
    $Package = $script:UpdatePackage.path
    if (-not (Test-Path $Package) -or (Get-FileHash $Package).Hash.ToLowerInvariant() -cne $script:UpdatePackage.sha256) { throw 'O arquivo baixado mudou. Baixe a atualizacao novamente.' }
    . (Join-Path $PSScriptRoot 'AgentUpdates.ps1')
    Assert-InstallerPublisher $Package
    if ([Windows.Forms.MessageBox]::Show('Abrir o instalador para o agente e interrompe suas conexoes. Se cancelar a instalacao, reabra NodeAccess Agent pelo menu Iniciar. Continuar?', 'Atualizar NodeAccess Agent', 'YesNo', 'Warning') -ne 'Yes') { return }
    Stop-AgentProcess
    Start-Process msiexec.exe -ArgumentList ('/i "' + $Package + '" /norestart') -ErrorAction Stop
    $script:ExitDesktop = $true; $Form.Close()
  } catch {
    $UpdateStatus.Text = 'Nao foi possivel abrir o instalador. Verifique o arquivo ou baixe novamente.'
    $script:UpdatePackage = $null; $DownloadUpdate.Text = 'Baixar atualizacao'
    if ($WasRunning) { try { Start-AgentProcess } catch { $Feedback.Text = $_.Exception.Message } }
  }
}
$CheckUpdate.Add_Click({ Start-UpdateCheck })
$DownloadUpdate.Add_Click({ Open-AgentUpdate })
$TrayCheckUpdate.Add_Click({ Show-AgentWindow; Start-UpdateCheck })
$TrayDownloadUpdate.Add_Click({ Show-AgentWindow; Open-AgentUpdate })
$Tray.Add_BalloonTipClicked({ Show-AgentWindow })
$Form.Add_FormClosing({
  if (-not $script:ExitDesktop -and $_.CloseReason -eq [Windows.Forms.CloseReason]::UserClosing) {
    $_.Cancel = $true; $Form.Hide()
  }
})
$Timer = New-Object Windows.Forms.Timer
$Timer.Interval = 1000
function Update-AgentStatus {
  Update-AgentButtons
  if (-not $script:Compatible) { $Status.Text = 'Instalacao precisa de reparo.'; return }
  if (-not (Test-Path $ConfigPath)) { $Status.Text = 'Ainda nao configurado. Informe servidor e token.'; return }
  if (-not (Get-AgentProcess)) { $Status.Text = 'Agente parado.'; return }
  try {
    $State = Get-Content $StatusPath -Raw | ConvertFrom-Json
    $StateLabel = switch ($State.state) { 'connected' { 'Conectado' } 'connecting' { 'Conectando' } default { 'Desconectado / reconectando' } }
    $AgentProcess = Get-AgentProcess
    if ($State.pid -ne $AgentProcess.Id) { $Status.Text = 'Agente iniciando...'; return }
    $Status.Text = "$StateLabel - $($State.name)`nServidor: $($State.server)`nConexoes ativas: $($State.activeConnections) | Versao: $($State.version)`nProcesso: nodeaccess-agent.exe (PID $($AgentProcess.Id))"
  } catch { $Status.Text = 'Agente iniciando...' }
}
$Timer.Add_Tick({
  if ($OpenEvent.WaitOne(0)) { Show-AgentWindow }
  Update-AgentStatus
  Complete-UpdateCheck
  $CanCheck = $script:Compatible -and -not $script:Saving -and -not $script:UpdateJob -and [bool]$LocalVersion -and (Test-Path $UpdateWorker) -and [bool](Get-ConfiguredUpdateServer)
  $CheckUpdate.Enabled = $CanCheck; $TrayCheckUpdate.Enabled = $CanCheck
  $DownloadUpdate.Enabled = $CanCheck; $TrayDownloadUpdate.Enabled = $CanCheck
  if ($CanCheck -and -not $script:UpdatePackage -and [DateTime]::UtcNow -ge $script:NextUpdateCheck) { Start-UpdateCheck }
  $TrayStatus.Text = ($Status.Text -split "`n")[0]
  $TrayDetails.Text = (($Status.Text -split "`n" | Select-Object -Skip 1) -join ' | ')
  $Tip = 'NodeAccess - ' + $TrayStatus.Text
  $Tray.Text = $Tip.Substring(0, [Math]::Min(63, $Tip.Length))
  $TrayStart.Enabled = $Start.Enabled; $TrayStop.Enabled = $Stop.Enabled
})
# Refresh only an existing shortcut: keep its identity and Windows StartupApproved choice.
if ((Test-Path $StartupLink) -and (Test-Path (Join-Path $PSScriptRoot 'nodeaccess-desktop.exe'))) {
  try { Set-AgentStartup $true } catch { $Feedback.Text = 'Nao foi possivel atualizar o atalho de inicializacao.' }
}
if ($Run) {
  try { Initialize-AgentDirectory; Start-AgentProcess } catch { $Feedback.Text = $_.Exception.Message }
  $Form.Add_Shown({ $Form.Hide() })
}
$Form.Add_FormClosed({ $Timer.Stop(); $Timer.Dispose() })
$Timer.Start()
try {
[Windows.Forms.Application]::Run($Form)
} finally {
  $Timer.Stop(); $Timer.Dispose()
  if ($script:UpdateJob) { Stop-Job $script:UpdateJob; Remove-Job $script:UpdateJob -Force }
  $Tray.Visible = $false; $Tray.Dispose(); $TrayMenu.Dispose()
  $OpenEvent.Dispose(); $DesktopMutex.ReleaseMutex(); $DesktopMutex.Dispose()
}
if ($Brand.Image) { $Brand.Image.Dispose() }
$Form.Dispose()
