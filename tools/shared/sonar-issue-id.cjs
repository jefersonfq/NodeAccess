// Public metadata names the Sonar finding identifier; API objects retain their native key.
function readIssue(row) {
  if (row.key !== undefined && row.issueId !== undefined && row.key !== row.issueId) {
    throw new Error('Conflicting Sonar issue identifiers')
  }
  const { issueId, ...rest } = row
  return { ...rest, key: issueId ?? row.key }
}
function publicIssue(row) {
  const { key, ...rest } = readIssue(row)
  return { issueId: key, ...rest }
}
module.exports = { readIssue, publicIssue }
