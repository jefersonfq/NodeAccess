function assertLoopbackOrigin(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('FRONTEND_BASE deve apontar para localhost ou 127.0.0.1')
  }
  return url.origin
}

function summarizePass(pass) {
  const resources = pass.resources || []
  return {
    label: pass.label,
    durationMs: pass.durationMs,
    resourceCount: resources.length,
    apiCount: resources.filter(item => item.kind === 'api').length,
    frontendCount: resources.filter(item => item.kind === 'frontend').length,
    transferBytes: resources.reduce((sum, item) => sum + (item.transferSize || 0), 0),
    longTaskCount: pass.longTasks?.length || 0,
    longTaskTotalMs: Math.round((pass.longTasks || []).reduce((sum, item) => sum + item.duration, 0)),
    errorCount: pass.errors?.length || 0,
  }
}

function comparePasses(first, second) {
  const before = summarizePass(first)
  const after = summarizePass(second)
  const deltaMs = after.durationMs - before.durationMs
  return {
    first: before,
    second: after,
    durationDeltaMs: deltaMs,
    durationDeltaPercent: before.durationMs > 0 ? Number(((deltaMs / before.durationMs) * 100).toFixed(1)) : null,
    transferDeltaBytes: after.transferBytes - before.transferBytes,
  }
}

module.exports = { assertLoopbackOrigin, comparePasses, summarizePass }
