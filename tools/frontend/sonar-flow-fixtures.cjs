const timestamp = '2026-11-03T12:00:00.000Z'
const settings = {
  tenant: { id: 7, name: 'Tenant de teste', slug: 'fixture' },
  license: {
    maxUsers: 10, maxHosts: 5, activeUsers: 8, registeredHosts: 5, hasKey: true,
    multiConnect: true, sessionAuditEnabled: true, sessionAuditAiEnabled: true,
    sessionAuditAiProvider: 'automatic', sessionAuditAiAutoSummaryEnabled: false,
    featureEntitlements: { integrations: true, agents: true, secrets: true, snippets: true, portForwarding: true, feedback: false, localAi: true, terminalAutocomplete: true, terminalAi: true, mcp: true, aiSshActions: true, ha: false },
    integrationEntitlements: { jira: true, google: true, ldap: false, onepassword: true, oidc: true, scim: true },
  },
  sessionLimits: { activeSessions: 1, maxPerUser: 3, maxPerTenant: 10 },
  passwordPolicy: { minLength: 12, regex: '.{12,}', description: 'Doze caracteres' },
  tenantSettings: { totpIssuer: 'Fixture', hostsDefaultView: 'home' },
  jitAccess: { enabled: false, expiryMinutes: [5], maxExpiryMinutes: 30, pinRequired: false },
  sharedSessions: { expiryMinutes: [5], maxExpiryMinutes: 30 },
}
function diagnosticFixture() {
  const commands = ['completed', 'failed', 'running', 'skipped'].map((status, index) => ({
    id: index + 1, commandId: `check-${index}`, command: ['uptime', 'df -h', 'free -m', 'uname -a'][index],
    status, exitCode: index === 1 ? 1 : 0, outputPreview: 'Evidência sintética', outputBody: `Saída sintética ${index}`,
    redactionApplied: index === 1, startedAt: timestamp, finishedAt: index === 2 ? null : timestamp,
  }))
  const run = { id: 41, hostId: 11, hostName: 'Host de laboratório', hostIp: '192.0.2.11', playbookId: 3,
    playbookName: 'Diagnóstico de laboratório', status: 'completed', requestedById: 7, approvedById: 7,
    triggerSource: 'manual', errorMessage: null, aiSummaryStatus: null, aiSummaryText: null, aiSummaryStructured: null,
    startedAt: timestamp, finishedAt: timestamp, createdAt: timestamp, updatedAt: timestamp, commands }
  const report = { version: 1, generatedAt: timestamp,
    identity: { runId: 41, hostId: 11, hostName: run.hostName, hostIp: run.hostIp, playbookId: 3, playbookName: run.playbookName, status: run.status, startedAt: timestamp, finishedAt: timestamp },
    traceability: { sessionId: null, ticketKey: 'LAB-42', actionRunId: null, note: 'Referências sintéticas do mesmo tenant.' },
    summary: { status: null, text: null, structured: null },
    evidence: { total: 4, completed: 1, failed: 1, skipped: 1, redacted: 1,
      commands: commands.map(item => ({ commandId: item.commandId, command: item.command, status: item.status, exitCode: item.exitCode, redactionApplied: item.redactionApplied, output: item.outputBody })) },
    integrity: { algorithm: 'sha256', checksum: 'a'.repeat(64) },
  }
  const side = { playbookId: 3, playbookName: run.playbookName, status: 'completed', finishedAt: timestamp, riskLevel: 'low', checksum: 'a'.repeat(64) }
  const comparison = { version: 1, generatedAt: timestamp, host: { id: 11, name: run.hostName, ip: run.hostIp },
    baseline: { ...side, runId: 40 }, current: { ...side, runId: 41 }, verdict: 'mixed',
    metrics: ['improved', 'regressed', 'unchanged'].map((change, index) => ({ key: ['completed', 'failed', 'skipped'][index], label: `Métrica ${index}`, baseline: '1', current: '2', change })),
    commands: ['improved', 'regressed', 'unchanged', 'added', 'removed'].map((change, index) => ({ commandId: `comparison-${index}`, command: `show fixture-${index}`, baselineStatus: 'completed', currentStatus: 'failed', baselineExitCode: 0, currentExitCode: 1, change })),
    findings: { resolved: ['Resolvido no laboratório'], new: ['Novo no laboratório'], persistent: ['Persistente no laboratório'] },
    warnings: ['Comparação sintética, sem inferir causalidade.'],
  }
  return { run, report, comparison }
}
function dashboardFixture() {
  const user = { userId: 9, userName: 'Operador de teste', userEmail: 'operator@example.invalid' }
  const host = { hostId: 11, hostName: 'Host de laboratório', hostIp: '192.0.2.11', hostDeleted: false, accessCount: 3 }
  return { activeUsers: 8, maxUsers: 10, totalHosts: 5, deletedHosts: 1, activeSessions: 1, sessionsToday: 6,
    clientUx: { current: { sessionExpired: 4, sessionExpiredTerminal: 1, staleReloadRecovered: 3, staleReloadFailed: 0 }, previous: { sessionExpired: 2, sessionExpiredTerminal: 1, staleReloadRecovered: 1, staleReloadFailed: 2 } },
    hostKey: { current: { trusted: 2, updated: 1 }, previous: { trusted: 1, updated: 1 } },
    recentAuthLogs: [
      { id: 1, userId: 9, userName: user.userName, userEmail: user.userEmail, eventType: 'LOGIN', userAgent: null, success: true, ip: '192.0.2.9', timestamp },
      { id: 2, userId: null, userName: null, userEmail: null, eventType: 'LOGIN_FAILED', userAgent: null, success: false, ip: null, timestamp },
    ],
    tagStats: [{ tag: { id: 1, name: 'Laboratório', color: '#22c55e' }, hostCount: 3 }],
    adoption: {
      topActiveUsers: [{ ...user, sessionCount: 3, lastAccessedAt: timestamp, primaryHostName: host.hostName }],
      topHosts: [{ ...host, uniqueUsers: 1 }], topScreens: [{ screenId: 1, screenLabel: 'Hosts', viewCount: 5 }],
      topResources: [{ resourceType: 'ssh', label: 'SSH', usageCount: 3 }],
      userResourceUsage: [{ ...user, sessions: 3, snippets: 1, sshTunnels: 1, liveSessions: 1 }],
      userDrilldowns: [{ ...user, topHosts: [host], recentAccesses: [{ ...host, sessionId: 25, startedAt: timestamp }] }],
    },
  }
}
const jiraResult = { ticketKey: 'LAB-42', checksum: 'a'.repeat(64), queuedActions: ['COMMENT_DIAGNOSTIC_REPORT'] }
module.exports = { settings, diagnosticFixture, dashboardFixture, jiraResult }
