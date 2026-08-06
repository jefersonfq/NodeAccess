export const DELIVERY_STATES = [
  'LOCAL_WIP',
  'COMMITTED',
  'PUSHED',
  'PR_OPEN',
  'MERGED',
  'MASTER_SYNCED',
]

export function deriveDeliveryStatus(input) {
  const states = {
    LOCAL_WIP: input.dirty ? 'active' : 'clear',
    COMMITTED: input.hasCommits ? 'complete' : 'pending',
    PUSHED: input.pushed ? 'complete' : 'pending',
    PR_OPEN: input.prOpen === true ? 'complete' : input.prOpen === false ? 'pending' : 'manual',
    MERGED: input.merged ? 'complete' : 'pending',
    MASTER_SYNCED: input.merged && input.masterSynced ? 'complete' : 'pending',
  }

  let nextAction = 'none'
  if (input.dirty) nextAction = 'review_and_commit'
  else if (!input.hasCommits) nextAction = 'implement_or_commit'
  else if (!input.pushed) nextAction = 'push_branch'
  else if (input.prOpen !== true && !input.merged) nextAction = 'open_or_confirm_pr'
  else if (!input.merged) nextAction = 'review_and_merge_pr'
  else if (!input.masterSynced) nextAction = 'sync_default_branch'

  return {
    states,
    nextAction,
    visibleInCurrentWorkspace: input.workspaceOnTopic
      || (input.workspaceOnDefault && input.merged && input.masterSynced),
  }
}
