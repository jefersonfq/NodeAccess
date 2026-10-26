import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../config/env.js'
import { configureTrialPolicy, type TrialAccess } from './trial-policy.js'
import { SessionAuditAiService } from '../session-audit/session-audit-ai.service.js'
import { SessionAuditAiWorker } from '../session-audit/session-audit-ai.worker.js'
import { LocalAiService } from '../local-ai/local-ai.service.js'
import { DiagnosticRunAiService } from '../diagnostic-playbooks/diagnostic-run-ai.service.js'

const flags = [env.FEATURE_LOCAL_AI, env.FEATURE_SESSION_AUDIT_AI_SUMMARY, env.FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY]
const full = (): TrialAccess => ({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { experience: 'full', resources: ['ssh', 'audit'] } })
beforeEach(() => {
  env.FEATURE_LOCAL_AI = false
  env.FEATURE_SESSION_AUDIT_AI_SUMMARY = false
  env.FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY = false
})
afterEach(() => {
  ;[env.FEATURE_LOCAL_AI, env.FEATURE_SESSION_AUDIT_AI_SUMMARY, env.FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY] = flags
  configureTrialPolicy(() => Promise.resolve(null))
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const integration = (): { isSessionAuditAiLicensed: ReturnType<typeof vi.fn>; findLicenseSnapshot: ReturnType<typeof vi.fn>; findByProvider: ReturnType<typeof vi.fn> } => ({
  isSessionAuditAiLicensed: vi.fn().mockResolvedValue(true),
  findLicenseSnapshot: vi.fn().mockResolvedValue({ sessionAuditAiProvider: 'openai', featureEntitlements: { sessionAuditAiAutoSummary: true } }),
  findByProvider: vi.fn().mockResolvedValue({ enabled: true, config: JSON.stringify({ apiKeyEncrypted: 'fixture', apiKeyIv: 'fixture', healthStatus: 'healthy', lastCheckedAt: new Date().toISOString() }) }),
})

describe('trial AI uses persisted tenant capability when installation flags are off', () => {
  it.each([false, true])('manual and automatic audit scheduling full=%s', async isFull => {
    configureTrialPolicy(() => Promise.resolve(isFull ? full() : null))
    const repo = { enqueueManualSummaryJob: vi.fn(), enqueueAutoSummaryJob: vi.fn() }
    const service = new SessionAuditAiService(integration() as never, repo as never, {} as never)
    if (isFull) await service.scheduleManualSummary(1, 8, 3, 'summary-v1')
    else await expect(service.scheduleManualSummary(1, 8, 3, 'summary-v1')).rejects.toMatchObject({ code: 'SESSION_AUDIT_AI_SUMMARY_DISABLED' })
    await service.schedulePostSessionSummary(1, 8)
    expect(repo.enqueueManualSummaryJob).toHaveBeenCalledTimes(isFull ? 1 : 0)
    expect(repo.enqueueAutoSummaryJob).toHaveBeenCalledTimes(isFull ? 1 : 0)
  })

  it.each([false, true])('local AI status reaches ordinary licensing only for full=%s', async isFull => {
    configureTrialPolicy(() => Promise.resolve(isFull ? full() : null))
    const entitlements = { isFeatureEnabled: vi.fn().mockResolvedValue(false) }
    const service = new LocalAiService({} as never, entitlements as never, {} as never, {} as never, {} as never, {} as never)
    await service.getStatus({ sub: '3', tenantId: 8, role: 'admin', email: 'fixture@example.invalid', stage: 'authenticated' })
    expect(entitlements.isFeatureEnabled).toHaveBeenCalledTimes(isFull ? 1 : 0)
  })

  it.each([false, true])('diagnostic AI preserves ordinary licensing with full=%s', async isFull => {
    configureTrialPolicy(() => Promise.resolve(isFull ? full() : null))
    const repo = integration()
    repo.isSessionAuditAiLicensed.mockResolvedValue(false)
    const service = new DiagnosticRunAiService(repo as never, {} as never, {} as never, {} as never)
    await expect(service.requestSummary(1, 8)).resolves.toBe(false)
    expect(repo.isSessionAuditAiLicensed).toHaveBeenCalledTimes(isFull ? 1 : 0)
  })

  it('diagnostic generation uses trial transport and rejects plaintext before provider I/O', async () => {
    configureTrialPolicy(() => Promise.resolve(full()))
    const network = vi.fn()
    vi.stubGlobal('fetch', network)
    const repo = { findDetailById: vi.fn().mockResolvedValue({ id: 1, commands: [{ outputBody: '', exitCode: 0 }] }), markAiSummaryProcessing: vi.fn(), markAiSummaryFailed: vi.fn() }
    const provider = { normalizeBaseUrl: vi.fn().mockReturnValue('http://public.example.invalid'), decryptApiKey: vi.fn().mockReturnValue('synthetic') }
    const service = new DiagnosticRunAiService(integration() as never, repo as never, provider as never, {} as never)
    await expect(service.requestSummary(1, 8)).resolves.toBe(true)
    await vi.waitFor(() => expect(repo.markAiSummaryFailed).toHaveBeenCalledWith(1, expect.stringContaining('HTTPS')))
    expect(network).not.toHaveBeenCalled()
  })

  it.each(['normal', 'full', 'expired'] as const)('worker checks %s job before context or provider I/O', async kind => {
    vi.useFakeTimers()
    configureTrialPolicy(() => Promise.resolve(kind === 'normal' ? null : { ...full(), ...(kind === 'expired' ? { expiresAt: new Date(0) } : {}) }))
    const repo = { requeueStaleProcessingJobs: vi.fn().mockResolvedValue(0), listPendingSummaryJobs: vi.fn().mockResolvedValue([{ id: 1, tenantId: 8, sessionId: 1, triggerSource: 'AUTO_POST_SESSION' }]), markCanceled: vi.fn(), markProcessing: vi.fn(), markFailed: vi.fn() }
    const context = { buildAiSummaryContext: vi.fn().mockRejectedValue(new Error('fixture stops before provider')) }
    const worker = new SessionAuditAiWorker(repo as never, {} as never, {} as never, {} as never, context as never)
    worker.start()
    await vi.advanceTimersByTimeAsync(env.SESSION_AUDIT_AI_WORKER_INITIAL_DELAY_MS)
    await worker.stop()
    expect(repo.listPendingSummaryJobs).toHaveBeenCalledWith(10, true)
    expect(repo.requeueStaleProcessingJobs).toHaveBeenCalledWith(expect.any(Date), true)
    expect(context.buildAiSummaryContext).toHaveBeenCalledTimes(kind === 'full' ? 1 : 0)
    expect(repo.markCanceled).toHaveBeenCalledTimes(kind === 'normal' ? 1 : 0)
    expect(repo.markFailed).toHaveBeenCalledTimes(kind === 'normal' ? 0 : 1)
    await vi.advanceTimersByTimeAsync(env.SESSION_AUDIT_AI_WORKER_POLL_MS * 2)
    expect(repo.listPendingSummaryJobs).toHaveBeenCalledTimes(1)
  })
})
