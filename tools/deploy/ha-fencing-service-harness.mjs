import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../ha-witness/fencing-service.mjs', import.meta.url), 'utf8')

assert.match(source, /timingSafeEqual/)
assert.match(source, /failureThreshold/)
assert.match(source, /requesterHealthy, targetHealthy/)
assert.match(source, /mode !== 'enforce'/)
assert.match(source, /requestedMode !== 'enforce'/)
assert.match(source, /controlvm', target\.vm, 'poweroff'/)
assert.match(source, /fencing não confirmado/)
assert.match(source, /emitEvidence/)
assert.match(source, /sign\('sha256'/)
assert.match(source, /acquireLease/)
assert.doesNotMatch(source, /exec\(/)

process.stdout.write('[nodeaccess] Contrato do serviço de fencing validado.\n')
