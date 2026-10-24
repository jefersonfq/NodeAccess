import { BlockList, isIP } from 'node:net'
import { z } from 'zod'

const httpsUrl = z.string().url().refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash
}, 'Use um endereço HTTPS sem credenciais')
export function validNetwork(value: string): boolean {
  const [ip, mask, extra] = value.split('/')
  const privateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(ip ?? '')
  return extra === undefined && privateIp && isIP(ip ?? '') === 4 && /^\d+$/.test(mask ?? '') && Number(mask) >= 16 && Number(mask) <= 30
}
export const trialProfileSchema = z.object({
  name: z.string().trim().min(3).max(80),
  resources: z.array(z.enum(['ssh', 'sftp', 'sharing', 'audit'])).min(1).max(4).default(['ssh', 'sftp', 'sharing']).refine(values => values.includes('ssh') && new Set(values).size === values.length),
  durationDays: z.number().int().min(1).max(30),
  expiryNoticeHours: z.number().int().min(1).max(23).default(6),
  maxUsers: z.number().int().min(1).max(10),
  maxHosts: z.number().int().min(1).max(10),
  machineCount: z.number().int().min(1).max(10),
  maxMachines: z.number().int().min(1).max(10).optional(),
  allowCustomHosts: z.boolean().optional(),
  maxCustomHosts: z.number().int().min(0).max(10).optional(),
  maxSessions: z.number().int().min(1).max(10).default(2),
  templateId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/),
  networkCidr: z.string().refine(validNetwork, 'Informe uma sub-rede IPv4 /16 a /30'),
  maxActiveTrials: z.number().int().min(1).max(100),
  retentionDays: z.number().int().min(1).max(365),
  privacyUrl: httpsUrl,
  termsUrl: httpsUrl,
  privacyVersion: z.string().trim().min(1).max(80),
}).strict().refine(p => p.machineCount <= p.maxHosts && (p.maxMachines ?? p.machineCount) >= p.machineCount && (p.maxMachines ?? p.machineCount) <= p.maxHosts, 'Confira as quantidades inicial, máxima e total de hosts')
  .refine(p => (p.maxCustomHosts ?? 0) <= p.maxHosts && (!p.allowCustomHosts || (p.maxCustomHosts ?? 0) > 0), 'Defina uma quota válida para hosts próprios')
export type TrialProfile = z.infer<typeof trialProfileSchema>
export const registrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform(s => s.toLowerCase()),
  termsAccepted: z.literal(true),
  privacyVersion: z.string().min(1).max(80),
  marketingConsent: z.boolean().default(false),
  researchConsent: z.boolean().default(false),
}).strict()
export const invitationSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254).transform(s => s.toLowerCase()) }).strict()
export const preferencesSchema = z.object({ marketingConsent: z.boolean(), researchConsent: z.boolean() }).strict()
export const opaqueTokenSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const activationSchema = z.object({ termsAccepted: z.literal(true).optional(), privacyVersion: z.string().max(80).optional(), marketingConsent: z.boolean().optional(), researchConsent: z.boolean().optional(), password: z.string().min(12).max(72)
  .refine(s => /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s), 'Use maiúsculas, minúsculas e números') }).strict()
export const labSchema = z.object({
  trialId: z.string().uuid(),
  state: z.enum(['preparing', 'ready', 'removed']),
  isolated: z.literal(true),
  hosts: z.array(z.object({
    name: z.string().min(1).max(80),
    ip: z.ipv4(),
    port: z.number().int().min(1).max(65535),
    sshUser: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/),
    password: z.string().min(20).max(512),
    fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}=?$/),
  }).strict()).max(10),
}).strict()
export type TrialLab = z.infer<typeof labSchema>
export function validateLab(lab: TrialLab, id: string, profile: TrialProfile): void {
  if (lab.trialId !== id) throw new Error('LAB_OWNERSHIP_MISMATCH')
  if (lab.state !== 'ready') return
  const [ip, mask] = profile.networkCidr.split('/')
  const network = new BlockList()
  network.addSubnet(ip!, Number(mask), 'ipv4')
  const numeric = (address: string): number => address.split('.').reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0)
  const maskBits = (0xffffffff << (32 - Number(mask))) >>> 0
  const base = (numeric(ip!) & maskBits) >>> 0
  const broadcast = (base | ~maskBits) >>> 0
  if (lab.hosts.length !== profile.machineCount || new Set(lab.hosts.map(h => h.ip)).size !== lab.hosts.length
    || lab.hosts.some(h => !network.check(h.ip, 'ipv4') || numeric(h.ip) === base || numeric(h.ip) === broadcast)) throw new Error('LAB_DESTINATION_INVALID')
}

/** Snapshot adds durable runtime metadata to the immutable public profile. */
export function trialProfileFromSnapshot(input: unknown): TrialProfile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return trialProfileSchema.parse(input)
  const raw = { ...(input as Record<string, unknown>) }
  delete raw.hostAddresses
  delete raw.requestedMachines
  delete raw.machineRequestError
  return trialProfileSchema.parse(raw)
}
