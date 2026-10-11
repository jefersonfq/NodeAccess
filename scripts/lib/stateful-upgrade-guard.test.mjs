import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const guard = fileURLToPath(new URL('./stateful-upgrade-guard.sh', import.meta.url))
function check(overrides = {}) {
  return spawnSync('bash', ['-c', `
set -euo pipefail
source "$GUARD"
compose() {
  if [[ "$1" == ps ]]; then printf '%s' "$3"; else
    printf 'container-registry.oracle.com/mysql/community-server:%s\nredis:%s-alpine\n' "$TARGET_MYSQL" "$TARGET_REDIS"
  fi
}
docker() {
  [[ "$OFFLINE" != true ]] || return 1
  [[ "$1" == exec ]] || exit 99
  if [[ "$3" == sh ]]; then printf '%s' "$NATIVE_USERS"; return; fi
  if [[ "$2" == mysql ]]; then printf 'mysqld Ver %s for Linux' "$CURRENT_MYSQL"; else printf 'Redis server v=%s sha=0' "$CURRENT_REDIS"; fi
}
guard_stateful_images compose
`], { encoding: 'utf8', env: { ...process.env, GUARD: guard, CURRENT_MYSQL: '8.4.12', TARGET_MYSQL: '8.4.12',
    CURRENT_REDIS: '8.2.10', TARGET_REDIS: '8.2.10', OFFLINE: 'false', NATIVE_USERS: '0', STATEFUL_UPGRADE_APPROVED: 'false', ...overrides } })
}
test('same series and minor security patches require no migration override', () => {
  assert.equal(check().status, 0)
  assert.equal(check({ TARGET_MYSQL: '8.4', CURRENT_REDIS: '8.2.9' }).status, 0)
})
test('MySQL series and Redis major upgrades stop before recreation by default', () => {
  assert.match(check({ CURRENT_MYSQL: '8.0.46' }).stderr, /STATEFUL_UPGRADE_APPROVED/)
  assert.match(check({ CURRENT_REDIS: '7.4.10' }).stderr, /STATEFUL_UPGRADE_APPROVED/)
})
test('explicit rehearsal approval allows forward migrations', () => {
  assert.equal(check({ CURRENT_MYSQL: '8.0.46', CURRENT_REDIS: '7.4.10', STATEFUL_UPGRADE_APPROVED: 'true' }).status, 0)
})
test('downgrade remains forbidden even with upgrade approval', () => {
  assert.match(check({ TARGET_MYSQL: '8.0', STATEFUL_UPGRADE_APPROVED: 'true' }).stderr, /Downgrade/)
  assert.match(check({ TARGET_REDIS: '7', STATEFUL_UPGRADE_APPROVED: 'true' }).stderr, /Downgrade/)
})
test('unverifiable tags and stopped services fail closed', () => {
  assert.notEqual(check({ TARGET_MYSQL: 'latest' }).status, 0)
  assert.notEqual(check({ OFFLINE: 'true' }).status, 0)
})
test('legacy authentication blocks an approved MySQL upgrade until converted', () => {
  assert.match(check({ CURRENT_MYSQL: '8.0.46', STATEFUL_UPGRADE_APPROVED: 'true', NATIVE_USERS: '1' }).stderr, /mysql_native_password/)
})
