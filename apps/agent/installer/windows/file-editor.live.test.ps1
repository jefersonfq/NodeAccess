param([string]$ScreenshotPath = '')
$ErrorActionPreference = 'Stop'
$Root = Join-Path ([IO.Path]::GetTempPath()) ('nodeaccess-editor-test-' + [guid]::NewGuid())
New-Item -ItemType Directory $Root | Out-Null
try {
  $Editor = Join-Path $Root 'editor.exe'
  $Source = @'
using System;
using System.IO;
class EditorTest {
  static void Main(string[] args) {
    if (args.Length != 1) throw new Exception("Expected one private file path");
    File.AppendAllText(args[0], "\nNATIVE_EDIT");
  }
}
'@
  Add-Type -TypeDefinition $Source -OutputAssembly $Editor -OutputType ConsoleApplication
  $env:NODEACCESS_EDITOR = $Editor
  & node --test (Join-Path $PSScriptRoot '..\..\src\desktop-edit.windows.test.js')
  if ($LASTEXITCODE -ne 0) { throw 'Native editor integration failed' }
  & node --test (Join-Path $PSScriptRoot '..\..\src\desktop-edit.test.js')
  if ($LASTEXITCODE -ne 0) { throw 'Windows save/rename/conflict tests failed' }
  & (Join-Path $PSScriptRoot 'setup-ui.test.ps1') -ScreenshotPath $ScreenshotPath
  Write-Host 'PASS: native Windows editor launch, automatic upload, private ACL, rename/save/conflict and agent configuration UI'
} finally {
  Remove-Item Env:NODEACCESS_EDITOR -ErrorAction SilentlyContinue
  Remove-Item $Root -Recurse -Force
}
