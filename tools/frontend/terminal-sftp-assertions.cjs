const assert = require('node:assert/strict')

// An unrelated directory request can finish between snapshots. Only the target
// directory proves invalidation, and repeated target requests are also failures.
function assertFreshSftpListing(before, after, path) {
  const previous = before.filter(value => value === path).length
  const current = after.filter(value => value === path).length
  assert.ok(previous > 0, `Cache SFTP não foi aquecido para ${path}`)
  assert.equal(current, previous + 1, `Comando mutável não invalidou exatamente uma listagem SFTP de ${path}: antes=${previous}, depois=${current}`)
  return { path, before: previous, after: current }
}
// Typing can issue distinct prefixes for the same directory. Assert the
// navigation and transport, not an absolute position in that asynchronous log.
function assertSessionSftpNavigation(requests, restRequests) {
  assert.equal(restRequests.length, 0, 'Autocomplete abriu transporte REST em vez do SFTP da sessão')
  assert.equal(requests[0], '/', 'Navegação SFTP não iniciou na raiz')
  let cursor = -1
  for (const path of ['/', '/var', '/var/log', '/var/log/anaconda']) {
    cursor = requests.indexOf(path, cursor + 1)
    assert.ok(cursor >= 0, `Navegação SFTP ausente ou fora de ordem: ${path}`)
  }
}
module.exports = { assertFreshSftpListing, assertSessionSftpNavigation }
