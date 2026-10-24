import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, symlinkSync, lstatSync, statSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { configureTrial, validateTrialConfiguration } from '../../scripts/deploy/configure-trial.mjs'

const valid = {
  TRIAL_PUBLIC_URL: 'https://demo.example.com', TRIAL_PROVISIONER_URL: 'https://provisioner.internal.example',
  TRIAL_PROVISIONER_TOKEN: 'disposable-test-token-with-at-least-32-characters',
  TRIAL_SMTP_HOST: 'smtp.example.com', TRIAL_SMTP_PORT: '587', TRIAL_SMTP_USER: 'sender',
  TRIAL_SMTP_PASSWORD: 'private-test-fixture', TRIAL_SMTP_FROM: 'trial@example.com',
}
function fixture(t, extra = '') {
  const root = mkdtempSync(join(tmpdir(), 'na-trial-install-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = join(root, '.env')
  writeFileSync(env, Object.entries(valid).map(([k,v]) => `${k}=${v}`).join('\n') + '\n' + extra, { mode: 0o600 })
  return { root, env }
}

test('enable and disable alter only the signup flag and preserve original backup', t => {
  const { root, env } = fixture(t, 'DATABASE_URL=mysql://same-db\nUNRELATED="a=b # exact"\nTRIAL_REGISTRATION_ENABLED=false\n')
  const before = readFileSync(env, 'utf8')
  assert.deepEqual(configureTrial(env, 'enable'), { changed: true, enabled: true })
  assert.equal(readFileSync(env, 'utf8'), before.replace('TRIAL_REGISTRATION_ENABLED=false', 'TRIAL_REGISTRATION_ENABLED=true'))
  const backup = readdirSync(root).find(n => n.endsWith('.bak'))
  assert.equal(readFileSync(join(root, backup), 'utf8'), before)
  assert.equal(statSync(join(root, backup)).mode & 0o777, 0o600)
  assert.deepEqual(configureTrial(env, 'enable'), { changed: false, enabled: true })
  assert.deepEqual(configureTrial(env, 'disable'), { changed: true, enabled: false })
  assert.equal(readFileSync(env, 'utf8'), before)
})
test('shared env symlink is preserved and target updated', t => {
  const { root, env } = fixture(t)
  const link = join(root, 'current.env'); symlinkSync(env, link)
  configureTrial(link, 'enable')
  assert.equal(lstatSync(link).isSymbolicLink(), true)
  assert.match(readFileSync(env, 'utf8'), /TRIAL_REGISTRATION_ENABLED=true/)
})
test('check without flag preserves standard installation byte for byte', t => {
  const { env } = fixture(t)
  const before = readFileSync(env, 'utf8')
  assert.deepEqual(configureTrial(env, 'check'), { changed: false, enabled: false })
  assert.equal(readFileSync(env, 'utf8'), before)
})
test('disable works when provider or SMTP configuration is missing', t => {
  const { env } = fixture(t); writeFileSync(env, 'TRIAL_REGISTRATION_ENABLED=true\n')
  configureTrial(env, 'disable')
  assert.equal(readFileSync(env, 'utf8'), 'TRIAL_REGISTRATION_ENABLED=false\n')
})
test('duplicate flags are rejected without editing', t => {
  const { env } = fixture(t, 'TRIAL_REGISTRATION_ENABLED=true\nexport TRIAL_REGISTRATION_ENABLED=false\n')
  const before = readFileSync(env, 'utf8')
  assert.throws(() => configureTrial(env, 'enable'), /duplicada/)
  assert.equal(readFileSync(env, 'utf8'), before)
})
test('existing operation lock prevents concurrent changes', t => {
  const { env } = fixture(t); mkdirSync(`${env}.trial.lock`)
  assert.throws(() => configureTrial(env, 'enable'), /EEXIST/)
})
test('quoted env values and literal shell substitutions are never executed', t => {
  const { root, env } = fixture(t)
  const marker = join(root, 'executed')
  writeFileSync(env, readFileSync(env, 'utf8') + `UNRELATED=$(touch ${marker})\nTRIAL_REGISTRATION_ENABLED="false"\n`)
  configureTrial(env, 'enable')
  assert.equal(existsSync(marker), false)
  assert.match(readFileSync(env, 'utf8'), /UNRELATED=\$\(touch/)
})
for (const [name, replacement] of [
  ['TRIAL_PUBLIC_URL', 'http://demo.example.com'], ['TRIAL_PROVISIONER_URL', 'https://user:secret@example.com'],
  ['TRIAL_PROVISIONER_URL', 'https://example.com?token=secret'], ['TRIAL_PROVISIONER_TOKEN', 'short'],
  ['TRIAL_SMTP_PORT', '65536'], ['TRIAL_SMTP_PORT', '1.5'], ['TRIAL_SMTP_FROM', 'malformed'], ['TRIAL_SMTP_PASSWORD', ''],
]) {
  test(`invalid ${name} (${replacement.length} chars) is rejected without secret output`, () => {
    assert.throws(() => validateTrialConfiguration({ ...valid, [name]: replacement }), error => {
      assert.match(error.message, new RegExp(name))
      assert.equal(error.message.includes('private-test-fixture'), false)
      return true
    })
  })
}
test('CLI rejects unexpected arguments and does not print secrets', t => {
  const { env } = fixture(t)
  const result = spawnSync(process.execPath, ['scripts/deploy/configure-trial.mjs', '--env-file', env, '--enable', '--disable'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.doesNotMatch(result.stdout + result.stderr, /private-test-fixture/)
})

function backupFixture(t) {
  const { root, env } = fixture(t)
  const deployment = join(root, 'deployment'); mkdirSync(deployment)
  writeFileSync(join(deployment, 'VERSION'), '2.0.0\n')
  const compose = join(deployment, 'docker-compose.prod.yml'); writeFileSync(compose, 'services: {}\n')
  const bin = join(root, 'bin'); mkdirSync(bin)
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == compose ]]; then
  [[ "\u0024{FAIL_STAGE:-}" != containers ]] || exit 7
  printf 'api\\ngateway\\nfrontend\\n'
elif [[ "$1" == inspect ]]; then
  service="\u0024{!#}"; [[ "$service" != gateway ]] || service=ssh-gateway
  printf '%s sha256:%064d\\n' "$service" 1
elif [[ "$1" == image && "$2" == save ]]; then
  [[ "\u0024{FAIL_STAGE:-}" != images ]] || exit 8
  printf 'test image archive'
else exit 9
fi
`, { mode: 0o700 })
  const backup = join(root, 'backup.sh')
  writeFileSync(backup, '#!/usr/bin/env bash\nset -euo pipefail\n[[ "${FAIL_STAGE:-}" != database ]] || exit 10\nprintf "fixture db" > "$1/mysql.sql.gz"\n', { mode: 0o700 })
  const output = join(root, 'recovery')
  const run = fail => spawnSync('bash', ['scripts/backup/backup-release-state.sh', output], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEPLOYMENT_ROOT: deployment,
      ENV_FILE: env, COMPOSE_FILE: compose, BACKUP_ALL_SCRIPT: backup, FAIL_STAGE: fail ?? '' },
  })
  return { run, root, output }
}
test('recovery backup archives exact image IDs, private config and checksums', t => {
  const { run, output } = backupFixture(t)
  const result = run(); assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(join(output, 'BACKUP-COMPLETE')))
  assert.match(readFileSync(join(output, 'compose.rollback-images.yml'), 'utf8'), /pull_policy: never/)
  assert.equal(statSync(join(output, 'config', '.env')).mode & 0o777, 0o600)
  assert.equal(statSync(output).mode & 0o777, 0o700)
  assert.doesNotMatch(result.stdout + result.stderr, /private-test-fixture/)
  const checks = spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: output, encoding: 'utf8' })
  assert.equal(checks.status, 0, checks.stderr)
  assert.notEqual(run().status, 0, 'existing recovery point must not be overwritten')
})
for (const stage of ['containers', 'images', 'database']) {
  test(`failure at ${stage} never reports a complete recovery point`, t => {
    const { run, output } = backupFixture(t)
    assert.notEqual(run(stage).status, 0)
    assert.equal(existsSync(join(output, 'BACKUP-COMPLETE')), false)
  })
}
