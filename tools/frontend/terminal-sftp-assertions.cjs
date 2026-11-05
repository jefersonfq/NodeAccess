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
module.exports = { assertFreshSftpListing }
