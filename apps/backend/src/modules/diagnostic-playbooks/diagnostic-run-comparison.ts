import type { DiagnosticRunComparison, DiagnosticRunReport } from '@nodeaccess/shared'

const riskRank = { low: 0, medium: 1, high: 2 } as const

function classifyDelta(current: number, baseline: number, lowerIsBetter: boolean) {
  if (current === baseline) return 'unchanged' as const
  const improved = lowerIsBetter ? current < baseline : current > baseline
  return improved ? 'improved' as const : 'regressed' as const
}

function normalizeFinding(value: string) {
  return value.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')
}

export function compareDiagnosticRunReports(
  baseline: DiagnosticRunReport,
  current: DiagnosticRunReport,
): DiagnosticRunComparison {
  const baselineRisk = baseline.summary.structured?.riskLevel ?? null
  const currentRisk = current.summary.structured?.riskLevel ?? null
  const riskChange = baselineRisk && currentRisk
    ? classifyDelta(riskRank[currentRisk], riskRank[baselineRisk], true)
    : 'unchanged'
  const metrics: DiagnosticRunComparison['metrics'] = [
    { key: 'completed', label: 'Concluídas', baseline: String(baseline.evidence.completed), current: String(current.evidence.completed), change: classifyDelta(current.evidence.completed, baseline.evidence.completed, false) },
    { key: 'failed', label: 'Falhas', baseline: String(baseline.evidence.failed), current: String(current.evidence.failed), change: classifyDelta(current.evidence.failed, baseline.evidence.failed, true) },
    { key: 'skipped', label: 'Ignoradas', baseline: String(baseline.evidence.skipped), current: String(current.evidence.skipped), change: classifyDelta(current.evidence.skipped, baseline.evidence.skipped, true) },
    { key: 'redacted', label: 'Saídas mascaradas', baseline: String(baseline.evidence.redacted), current: String(current.evidence.redacted), change: 'unchanged' },
    { key: 'risk', label: 'Risco apontado', baseline: baselineRisk ?? 'indisponível', current: currentRisk ?? 'indisponível', change: riskChange },
  ]

  const baselineCommands = new Map(baseline.evidence.commands.map((item) => [item.commandId, item]))
  const currentCommands = new Map(current.evidence.commands.map((item) => [item.commandId, item]))
  const commandIds = [...new Set([...baselineCommands.keys(), ...currentCommands.keys()])]
  const commands: DiagnosticRunComparison['commands'] = commandIds.map((commandId) => {
    const before = baselineCommands.get(commandId)
    const after = currentCommands.get(commandId)
    let change: DiagnosticRunComparison['commands'][number]['change'] = 'unchanged'
    if (!before) change = 'added'
    else if (!after) change = 'removed'
    else if (before.status === 'completed' && after.status !== 'completed') change = 'regressed'
    else if (before.status !== 'completed' && after.status === 'completed') change = 'improved'
    else if (before.status !== after.status || before.exitCode !== after.exitCode) change = 'regressed'
    return {
      commandId,
      command: after?.command ?? before?.command ?? '',
      baselineStatus: before?.status ?? null,
      currentStatus: after?.status ?? null,
      baselineExitCode: before?.exitCode ?? null,
      currentExitCode: after?.exitCode ?? null,
      change,
    }
  })

  const beforeFindings = new Map((baseline.summary.structured?.keyFindings ?? []).map((item) => [normalizeFinding(item), item]))
  const afterFindings = new Map((current.summary.structured?.keyFindings ?? []).map((item) => [normalizeFinding(item), item]))
  const findings = {
    resolved: [...beforeFindings].filter(([key]) => !afterFindings.has(key)).map(([, value]) => value),
    new: [...afterFindings].filter(([key]) => !beforeFindings.has(key)).map(([, value]) => value),
    persistent: [...afterFindings].filter(([key]) => beforeFindings.has(key)).map(([, value]) => value),
  }
  const signals = [...metrics.map((metric) => metric.change), ...commands.map((command) => command.change)]
  const hasImprovement = signals.includes('improved')
  const hasRegression = signals.includes('regressed')
  const verdict = hasImprovement && hasRegression ? 'mixed' : hasImprovement ? 'improved' : hasRegression ? 'regressed' : 'unchanged'
  const warnings: string[] = []
  if (baseline.identity.playbookId !== current.identity.playbookId) warnings.push('As execuções usam playbooks diferentes; compare comandos equivalentes com cautela.')
  if (!baselineRisk || !currentRisk) warnings.push('O risco não pôde ser comparado porque ao menos um resumo estruturado está indisponível.')
  if (commands.some((command) => command.change === 'added' || command.change === 'removed')) warnings.push('A composição de comandos mudou entre as execuções.')

  const side = (report: DiagnosticRunReport) => ({
    runId: report.identity.runId,
    playbookId: report.identity.playbookId,
    playbookName: report.identity.playbookName,
    status: report.identity.status,
    finishedAt: report.identity.finishedAt,
    riskLevel: report.summary.structured?.riskLevel ?? null,
    checksum: report.integrity.checksum,
  })
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    host: { id: current.identity.hostId, name: current.identity.hostName, ip: current.identity.hostIp },
    baseline: side(baseline),
    current: side(current),
    verdict,
    metrics,
    commands,
    findings,
    warnings,
  }
}
