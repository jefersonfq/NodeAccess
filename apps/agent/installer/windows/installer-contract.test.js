import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const wxs = readFileSync(resolve(here, 'NodeAccessAgent.wxs'), 'utf8')
const build = readFileSync(resolve(here, 'build-msi.ps1'), 'utf8')

test('MSI installs the agent and configuration assistant without accepting credentials', () => {
  assert.match(wxs, /<MajorUpgrade\b/)
  assert.match(wxs, /ProgramFiles64Folder/)
  assert.match(wxs, /Name="nodeaccess-agent\.exe"/)
  assert.doesNotMatch(wxs, /agent\.token|ServiceInstall|Property Id="TOKEN"/)
  assert.match(wxs, /AgentSetup\.ps1/)
  assert.match(wxs, /AgentSetupComplete/)
})

test('MSI build uses the agent package version and fails when the EXE is missing', () => {
  assert.match(build, /Package\.version/)
  assert.match(build, /nodeaccess-agent-win\.exe/)
  assert.match(build, /Test-Path \$AgentExecutable/)
  assert.match(build, /wix build/)
  assert.match(build, /ProductVersion=\$Version/)
  assert.match(build, /NODEACCESS_CODE_SIGN_CERTIFICATE/)
  assert.match(build, /signtool/)
  assert.match(build, /NodeAccess Agent \$Version/)
  assert.match(build, /--token-file/)
  assert.match(build, /Get-FileHash -Algorithm SHA256/)
  assert.match(build, /nodeaccess-agent-windows-x64\.json/)
})
