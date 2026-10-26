import { isFullTrialProfile } from './trial-capabilities.js'
import { isIPv4, isIP } from 'node:net'
import { validateTrialCustomAddress } from './trial-address-policy.js'
import { AppError } from '../../shared/errors.js'

export interface TrialAccess {
  status: string
  expiresAt: Date | null
  profileJson: unknown
}
export type TrialPolicyReader = (tenantId: number) => Promise<TrialAccess | null>
let readTrial: TrialPolicyReader = () => Promise.resolve(null)
export type TrialUserReader = (tenantId: number, userId: number, sessionVersion?: number) => Promise<boolean>
let readTrialUser: TrialUserReader = () => Promise.resolve(true)
let protectedAddresses: readonly string[] = []
export function configureTrialProtectedAddresses(addresses: readonly string[]): void { protectedAddresses = addresses.length > 0 && addresses.every(address => isIP(address) !== 0) ? [...addresses] : [] }
export function trialProtectedAddresses(): readonly string[] { return [...protectedAddresses] }
export interface TrialHostIdentity { id: number; ip: string; port: number }
let readTrialHost: (tenantId: number, host: TrialHostIdentity) => Promise<boolean> = () => Promise.resolve(true)
export function configureTrialHostReader(reader: typeof readTrialHost): void { readTrialHost = reader }
export function configureTrialUserReader(reader: TrialUserReader): void { readTrialUser = reader }

// Installed in API and gateway startup; deliberately independent of the signup switch.
export function configureTrialPolicy(reader: TrialPolicyReader): void { readTrial = reader }
export function trialDenied(code = 'TRIAL_EXPIRED'): AppError {
  const messages: Record<string, string> = {
    TRIAL_EXPIRED: 'Período de teste encerrado ou indisponível',
    TRIAL_SESSION_LIMIT: 'Limite de sessões simultâneas do teste atingido',
    TRIAL_USER_REVOKED: 'Acesso ao teste revogado',
    TRIAL_USER_LIMIT: 'Limite de usuários do teste atingido. Convites pendentes também ocupam vagas.',
    TRIAL_HOST_LIMIT: 'Limite de hosts do teste atingido.',
    TRIAL_MANAGED_HOST: 'O host de demonstração é gerenciado automaticamente. Cadastre seus próprios hosts para editar configurações.',
    TRIAL_AI_LIMIT: 'Limite de requisições de IA ou de execuções simultâneas do teste atingido.',
    TRIAL_CAPACITY_UNAVAILABLE: 'Não foi possível verificar os limites do teste. Tente novamente.',
    TRIAL_DESTINATION_DENIED: 'Destino indisponível no teste. Use um IPv4 público ou um agente do seu tenant para acessar seu parque privado.',
  }
  const message = messages[code] ?? 'Operação indisponível no teste'
  return new AppError(message, 403, code)
}
export async function assertTrialAccess(tenantId: number): Promise<TrialAccess | null> {
  const trial = await readTrial(tenantId)
  if (trial && (trial.status !== 'ACTIVE' || !trial.expiresAt || !Number.isFinite(trial.expiresAt.getTime()) || trial.expiresAt.getTime() <= Date.now())) throw trialDenied()
  return trial
}
export async function assertTrialUserAccess(tenantId: number, userId: number, sessionVersion?: number): Promise<TrialAccess | null> {
  const trial = await assertTrialAccess(tenantId)
  if (trial && !await readTrialUser(tenantId, userId, sessionVersion)) throw trialDenied('TRIAL_USER_REVOKED')
  return trial
}
export function trialResourceEnabled(trial: TrialAccess, resource: string): boolean {
  const profile = trial.profileJson as { resources?: unknown } | null
  return !!profile && Array.isArray(profile.resources) && profile.resources.includes(resource)
}
export async function assertTrialResource(tenantId: number, resource: string): Promise<TrialAccess | null> {
  const trial = await assertTrialAccess(tenantId)
  if (trial && !trialResourceEnabled(trial, resource)) throw trialDenied('TRIAL_FEATURE_DISABLED')
  return trial
}
export async function assertNotTrial(tenantId: number): Promise<void> {
  if (await readTrial(tenantId)) throw trialDenied('TRIAL_FEATURE_DISABLED')
}

/** Additional ingress must name its capability; a full trial never bypasses expiry. */
export async function assertTrialCapability(tenantId: number, capability: string): Promise<TrialAccess | null> {
  const trial = await readTrial(tenantId)
  if (!trial) return null
  const profile = trial.profileJson as { features?: Record<string, boolean> }
  if (!isFullTrialProfile(profile) || profile.features?.[capability] === false) throw trialDenied('TRIAL_FEATURE_DISABLED')
  if (!trialResourceEnabled(trial, 'sharing') && capability === 'sharing') throw trialDenied('TRIAL_FEATURE_DISABLED')
  if (trial.status !== 'ACTIVE' || !trial.expiresAt || !Number.isFinite(trial.expiresAt.getTime()) || trial.expiresAt.getTime() <= Date.now()) throw trialDenied()
  return trial
}

/** Full is an explicit tenant capability profile; normal installation flags stay unchanged. */
export async function trialFeatureAvailable(tenantId: number, installationEnabled: boolean, capability: string): Promise<boolean> {
  const trial = await assertTrialAccess(tenantId)
  if (!trial || !isFullTrialProfile(trial.profileJson)) return installationEnabled
  const profile = trial.profileJson as { features?: Record<string, boolean> }
  if (capability.startsWith('sessionAudit')) {
    if (!trialResourceEnabled(trial, 'audit')) return false
    if (capability.startsWith('sessionAuditAi') && profile.features?.localAi === false) return false
  }
  return profile.features?.[capability] !== false
}

export async function assertTrialDestination(tenantId: number, ip: string): Promise<void> {
  const trial = await assertTrialAccess(tenantId)
  if (trial) validateTrialDestination(trial, ip)
}
/** Private park addresses are allowed only when the caller guarantees an agent-only route. */
export async function assertTrialHostDestination(tenantId: number, ip: string, connectionMode = 'DIRECT'): Promise<void> {
  const trial = await assertTrialAccess(tenantId)
  if (!trial) return
  validateTrialRoutedDestination(trial, ip, connectionMode)
}
export function validateTrialRoutedDestination(trial: TrialAccess, ip: string, connectionMode: string): void {
  const profile = trial.profileJson as { networkCidr?: string; allowCustomHosts?: boolean; hostAddresses?: string[] }
  const agentOnly = ['AGENT', 'AGENT_USER', 'AGENT_TENANT_FALLBACK', 'PRIVATE_ACCESS_CONNECTOR'].includes(connectionMode)
  const privateAddress = isIPv4(ip) && ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].some(cidr => ipv4InCidr(ip, cidr))
  if (isFullTrialProfile(profile) && agentOnly && privateAddress && profile.allowCustomHosts === true && protectedAddresses.length
    && !protectedAddresses.includes(ip) && !(profile.networkCidr && ipv4InCidr(ip, profile.networkCidr))) return
  validateTrialDestination(trial, ip)
}

/** Loopback here is resolved by the already-authorized remote SSH server, never this API. */
export async function assertTrialTunnelDestination(tenantId: number, ip: string, connectionMode: string): Promise<void> {
  const trial = await assertTrialAccess(tenantId)
  if (!trial) return
  if (isFullTrialProfile(trial.profileJson) && ip === '127.0.0.1') return
  validateTrialRoutedDestination(trial, ip, connectionMode)
}

function validateTrialDestination(trial: TrialAccess, ip: string): void {
  const profile = trial.profileJson as { networkCidr?: unknown; hostAddresses?: unknown; allowCustomHosts?: boolean }
  const demo = typeof profile?.networkCidr === 'string' && Array.isArray(profile.hostAddresses)
    && profile.hostAddresses.includes(ip) && ipv4InCidr(ip, profile.networkCidr)
  if (demo) return
  if (profile?.allowCustomHosts !== true || !protectedAddresses.length) throw trialDenied('TRIAL_DESTINATION_DENIED')
  try { validateTrialCustomAddress(ip, protectedAddresses) } catch { throw trialDenied('TRIAL_DESTINATION_DENIED') }
}

export async function assertTrialHttpAccess(tenantId: number, method: string, rawUrl: string, checkedTrial?: TrialAccess | null): Promise<void> {
  const trial = checkedTrial === undefined ? await assertTrialAccess(tenantId) : checkedTrial
  if (!trial) return
  // Match the canonical route path, never query strings or arbitrary suffixes.
  const path = rawUrl.split('?')[0]!.replace(/^\/api\/v1/, '').replace(/\/$/, '')
  if (isFullTrialProfile(trial.profileJson)) {
    // Platform authorization remains mandatory even for a tenant administrator.
    if (/^\/(?:platform|tenants|trials\/admin)(?:\/|$)/.test(path) || /^\/settings\/(?:platform|license)(?:\/|$)/.test(path)) throw trialDenied('TRIAL_FEATURE_DISABLED')
    if (path.startsWith('/sftp/') && !trialResourceEnabled(trial, 'sftp')) throw trialDenied('TRIAL_FEATURE_DISABLED')
    if (path.startsWith('/shared-sessions') && !trialResourceEnabled(trial, 'sharing')) throw trialDenied('TRIAL_FEATURE_DISABLED')
    if (path.startsWith('/session-audit') && !trialResourceEnabled(trial, 'audit')) throw trialDenied('TRIAL_FEATURE_DISABLED')
    return
  }
  const read = method === 'GET' || method === 'HEAD'
  const allowedRead = /^\/(hosts(?:\/(?:\d+|sidebar-summary|sidebar-bootstrap|by-ids|quick-access|associated-links\/catalog))?|groups|folders|tags|inventory(?:\/.*)?|snippets|snippet-groups|features|settings(?:\/manual)?|user-dashboard(?:\/.*)?|users\/me(?:\/(?:preferences|avatar))?|sessions(?:\/access-map)?|bastions|pem-keys|forwardings|agents(?:\/status)?|session-audit(?:\/.*)?|terminal-highlights(?:\/.*)?)$/.test(path)
  const ownResources = (read && path === '/trials/me/resources') || (method === 'POST' && path === '/trials/me/machines')
  const customEnabled = (trial.profileJson as { allowCustomHosts?: boolean } | null)?.allowCustomHosts === true
  const ownHosts = customEnabled && ((method === 'POST' && path === '/trials/me/hosts') || (/^(PUT|DELETE)$/.test(method) && /^\/trials\/me\/hosts\/\d+$/.test(path)) || (method === 'POST' && /^\/hosts\/\d+\/trust-host-key$/.test(path)) || (read && /^\/hosts\/\d+\/host-key-history$/.test(path)))
  const ownPreferences = (method === 'PATCH' && path === '/users/me/preferences') || (method === 'POST' && path === '/users/me/change-password')
  const sftp = (method === 'GET' && /^\/sftp\/\d+\/(ping|list|download|download-backup|backup-diff|read)$/.test(path))
    || (method === 'POST' && /^\/sftp\/\d+\/(upload|mkdir|rename|touch|restore-backup)$/.test(path))
    || (method === 'PUT' && /^\/sftp\/\d+\/write$/.test(path))
    || (method === 'DELETE' && /^\/sftp\/\d+\/file$/.test(path))
  const sharing = /^(GET|POST|DELETE)$/.test(method) && /^\/shared-sessions(?:\/.*)?$/.test(path)
  const jiraPolicy = method === 'GET' && path === '/integrations/jira/session-policy'
  const discardedTelemetry = method === 'POST' && (/^\/logs\/(client-ux|user-productivity)$/.test(path) || /^\/snippets\/\d+\/execution-status$/.test(path))
  const logout = method === 'POST' && /^\/auth\/logout(?:-all)?$/.test(path)
  if (path.startsWith('/sftp/') && !trialResourceEnabled(trial, 'sftp')) throw trialDenied('TRIAL_FEATURE_DISABLED')
  if (path.startsWith('/shared-sessions') && !trialResourceEnabled(trial, 'sharing')) throw trialDenied('TRIAL_FEATURE_DISABLED')
  if (path.startsWith('/session-audit') && !trialResourceEnabled(trial, 'audit')) throw trialDenied('TRIAL_FEATURE_DISABLED')
  if (!(read && allowedRead) && !ownPreferences && !sftp && !sharing && !logout && !discardedTelemetry && !jiraPolicy && !ownResources && !ownHosts) throw trialDenied('TRIAL_FEATURE_DISABLED')
}

export function ipv4InCidr(address: string, cidr: string): boolean {
  const [network, prefix, extra] = cidr.split('/')
  if (extra !== undefined || !network || !isIPv4(address) || !isIPv4(network) || !prefix || !/^\d{1,2}$/.test(prefix)) return false
  const bits = Number(prefix)
  if (bits < 1 || bits > 32) return false
  const value = (ip: string): number => ip.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0)
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (value(address) & mask) === (value(network) & mask)
}
interface TrialHost {
  ip: string
  accessProtocol: string
  connectionMode: string
  bastion?: unknown
  privateAccessConnectorId?: number | null
  onePasswordRef?: string | null
  passwordSecretId?: number | null
}
export async function assertTrialHostAccess(tenantId: number, host: TrialHost, agentRouteSupported = false): Promise<TrialAccess | null> {
  const trial = await assertTrialResource(tenantId, 'ssh')
  if (!trial) return null
  if (isFullTrialProfile(trial.profileJson)) {
    validateTrialRoutedDestination(trial, host.ip, agentRouteSupported ? host.connectionMode : 'DIRECT')
    if (host.bastion) {
      const bastion = host.bastion as { ip?: unknown }
      if (typeof bastion.ip !== 'string') throw trialDenied('TRIAL_DESTINATION_DENIED')
      validateTrialDestination(trial, bastion.ip)
    }
    return trial
  }
  const profile = trial.profileJson as { networkCidr?: unknown; hostAddresses?: unknown; allowCustomHosts?: boolean }
  if (!profile || host.accessProtocol !== 'SSH' || host.connectionMode !== 'DIRECT'
    || host.bastion || host.privateAccessConnectorId || host.onePasswordRef || host.passwordSecretId) throw trialDenied('TRIAL_DESTINATION_DENIED')
  const isDemo = typeof profile.networkCidr === 'string' && Array.isArray(profile.hostAddresses)
    && profile.hostAddresses.includes(host.ip) && ipv4InCidr(host.ip, profile.networkCidr)
  if (!isDemo) {
    if (profile.allowCustomHosts !== true || !protectedAddresses.length) throw trialDenied('TRIAL_DESTINATION_DENIED')
    try { validateTrialCustomAddress(host.ip, protectedAddresses) } catch { throw trialDenied('TRIAL_DESTINATION_DENIED') }
  }
  return trial
}

/** Deadline is local, so worker/Redis failure cannot extend a live session. Polling is trial-only. */
export function monitorTrialAccess(tenantId: number, initial: TrialAccess | null, close: () => void, user?: { id: number; sessionVersion?: number }, host?: TrialHostIdentity): () => void {
  if (!initial) return () => {}
  let stopped = false
  let checking = false
  let deadline: ReturnType<typeof setTimeout>
  const stop = (): void => { stopped = true; clearTimeout(deadline); clearInterval(poll) }
  const revoke = (): void => { if (stopped) return; stop(); close() }
  const schedule = (expiresAt: Date | null): void => {
    clearTimeout(deadline)
    const remaining = (expiresAt?.getTime() ?? 0) - Date.now()
    deadline = setTimeout(remaining > 2_147_483_647 ? (): void => schedule(expiresAt) : revoke, Math.max(0, Math.min(remaining, 2_147_483_647)))
    deadline.unref?.()
  }
  const poll = setInterval(() => {
    if (checking || stopped) return
    checking = true
    void (user ? assertTrialUserAccess(tenantId, user.id, user.sessionVersion) : assertTrialAccess(tenantId)).then(async current => {
      if (host && !await readTrialHost(tenantId, host)) { revoke(); return }
      if (stopped) return
      if (!current) revoke() // Trial metadata cannot disappear while a session lives.
      else schedule(current.expiresAt)
    }).catch(revoke).finally(() => { checking = false })
  }, 5_000)
  poll.unref?.()
  schedule(initial.expiresAt)
  return stop
}
