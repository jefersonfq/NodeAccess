import type { TacacsHealthStore } from './tacacs-health.js'
import { Prisma, type PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { DeviceProfileSchema } from '@nodeaccess/shared'
import { ValidationError } from '../../shared/errors.js'
import type { SshRepository } from '../ssh/ssh.repository.js'

export const NetworkSettingsSchema = z.object({ defaultProfile: DeviceProfileSchema, tacacsEnabled: z.boolean() }).strict()
export const CertificateFingerprintSchema = z.string().trim().regex(/^(?:[a-fA-F0-9]{64}|(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2})$/, 'Informe a impressão SHA-256 do certificado (64 dígitos hexadecimais)').transform(value => value.replaceAll(':', '').toLowerCase())
export const DeviceSchema = z.object({ hostId: z.number().int().positive(), sourceIp: z.string().refine(v => isIP(v) > 0 && !v.includes('%'), 'Informe um IP sem identificador de interface').transform(v => isIP(v) === 6 ? new URL(`http://[${v}]/`).hostname.slice(1, -1) : v).refine(v => !v.startsWith('::ffff:'), 'Use o endereço IPv4 sem prefixo IPv6'), certificateFingerprintSha256: CertificateFingerprintSchema, enabled: z.boolean() }).strict()
export const CredentialSchema = z.object({ userId: z.number().int().positive(), username: z.string().regex(/^[a-zA-Z0-9_.@-]{1,64}$/), password: z.string().min(16).max(72).refine(v => Buffer.byteLength(v, 'utf8') <= 72, 'Senha deve ter no máximo 72 bytes UTF-8'), enabled: z.boolean() }).strict()
const token = z.string().min(1).max(128).regex(/^[^\x00-\x20\x7f;|&<>]+$/)
export const GrantSchema = z.object({ userId: z.number().int().positive(), hostId: z.number().int().positive(), commands: z.array(z.array(token).min(1).max(32)).max(100) }).strict()
function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) throw new ValidationError(result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  return result.data
}
export interface TacacsDevice { id: number; tenantId: number; hostId: number }
type Settings = { defaultProfile: string; tacacsEnabled: boolean }
type DeviceOverview = { id: number; hostId: number; name: string; sourceIp: string; certificateFingerprintSha256: string | null; enabled: boolean }
type CredentialOverview = { userId: number; username: string; name: string; enabled: boolean }
type EventOverview = { id: string; username: string; deviceId: number; kind: string; outcome: string; command: string; createdAt: Date }
type Overview = { settings: Settings; devices: DeviceOverview[]; credentials: CredentialOverview[]; grants: Array<{ userId: number; hostId: number; commands: string[][] }>; events: EventOverview[] }
type Identity = { userId: number; role: 'ADMIN' | 'USER'; hash: string }
function parseCommands(value: string): string[][] {
  const parsed: unknown = JSON.parse(value)
  return GrantSchema.shape.commands.parse(parsed)
}


// Compare complete argument vectors: no regex, prefix matching, abbreviation or shell expansion.
export function commandAllowed(allowed: string[][], args: string[]): boolean {
  const service = args.filter(v => v.startsWith('service='))
  if (service.length !== 1 || service[0] !== 'service=shell') return false
  if (args.some(v => !v.startsWith('service=') && !v.startsWith('cmd=') && !v.startsWith('cmd-arg='))) return false
  const commands = args.filter(v => v.startsWith('cmd='))
  if (commands.length !== 1) return false
  const command = commands[0]!.slice(4)
  const argv = args.filter(v => v.startsWith('cmd-arg=')).map(v => v.slice(8))
  if (command === '') return argv.length === 0 // exec authorization; connect ACL checked separately
  const requested = [command, ...argv]
  return allowed.some(rule => rule.length === requested.length && rule.every((v, i) => v === requested[i]))
}

export class NetworkAccessService {
  constructor(private readonly db: PrismaClient, private readonly ssh: SshRepository, private readonly healthStore?: Pick<TacacsHealthStore, 'read'>) {}
  async health(tenantId: number): Promise<Awaited<ReturnType<TacacsHealthStore['read']>>> {
    const settings = await this.settings(tenantId)
    if (!settings.tacacsEnabled) return { status: 'disabled', instances: [] }
    try { return this.healthStore ? await this.healthStore.read(tenantId) : { status: 'unobserved', instances: [] } }
    catch { return { status: 'unavailable', instances: [] } }
  }
  async settings(tenantId: number): Promise<Settings> {
    const rows = await this.db.$queryRaw<Array<{ defaultProfile: string; tacacsEnabled: boolean | number }>>(Prisma.sql`SELECT default_profile AS defaultProfile, tacacs_enabled AS tacacsEnabled FROM network_settings WHERE tenant_id = ${tenantId}`)
    return { defaultProfile: rows[0]?.defaultProfile ?? 'server_ssh', tacacsEnabled: Boolean(rows[0]?.tacacsEnabled) }
  }
  async overview(tenantId: number): Promise<Overview> {
    const [settings, devices, credentials, grants, events] = await Promise.all([
      this.settings(tenantId),
      this.db.$queryRaw<DeviceOverview[]>(Prisma.sql`SELECT d.id, d.host_id AS hostId, h.name, d.source_ip AS sourceIp, d.certificate_fingerprint_sha256 AS certificateFingerprintSha256, d.enabled FROM network_tacacs_devices d JOIN hosts h ON h.id=d.host_id WHERE d.tenant_id=${tenantId}`),
      this.db.$queryRaw<CredentialOverview[]>(Prisma.sql`SELECT c.user_id AS userId, c.username, u.name, c.enabled FROM network_tacacs_credentials c JOIN users u ON u.id=c.user_id WHERE c.tenant_id=${tenantId}`),
      this.db.$queryRaw<Array<{userId:number;hostId:number;commands:string}>>(Prisma.sql`SELECT user_id AS userId, host_id AS hostId, commands_json AS commands FROM network_tacacs_grants WHERE tenant_id=${tenantId}`),
      this.db.$queryRaw<EventOverview[]>(Prisma.sql`SELECT CAST(id AS CHAR) AS id, username, device_id AS deviceId, kind, outcome, command_json AS command, created_at AS createdAt FROM network_tacacs_events WHERE tenant_id=${tenantId} ORDER BY id DESC LIMIT 100`),
    ])
    return { settings, devices, credentials, grants: grants.map(g => ({ ...g, commands: parseCommands(g.commands) })), events }
  }
  private async audit(tx: Prisma.TransactionClient, tenantId: number, actorId: number, action: string, targetId: number, details: unknown): Promise<void> {
    await tx.adminLog.create({ data: { adminId: actorId, action: `NETWORK_${action}`, targetType: 'network_access', targetId, details: JSON.stringify({ tenantId, ...details as object }) } })
  }
  async saveSettings(tenantId: number, actorId: number, input: unknown): Promise<z.infer<typeof NetworkSettingsSchema>> {
    const data = parseInput(NetworkSettingsSchema, input)
    await this.db.$transaction(async tx => {
      const before = await tx.$queryRaw(Prisma.sql`SELECT default_profile, tacacs_enabled FROM network_settings WHERE tenant_id=${tenantId} FOR UPDATE`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO network_settings (tenant_id,default_profile,tacacs_enabled) VALUES (${tenantId},${data.defaultProfile},${data.tacacsEnabled}) ON DUPLICATE KEY UPDATE default_profile=VALUES(default_profile),tacacs_enabled=VALUES(tacacs_enabled),updated_at=CURRENT_TIMESTAMP(3)`)
      await this.audit(tx, tenantId, actorId, 'SETTINGS_UPDATED', tenantId, { before, after: data })
    })
    return data
  }
  async saveDevice(tenantId: number, actorId: number, input: unknown): Promise<void> {
    const data = parseInput(DeviceSchema, input)
    await this.db.$transaction(async tx => {
      const host = await tx.host.findFirst({ where: { id: data.hostId, tenantId, deletedAt: null } })
      if (!host || host.accessProtocol !== 'SSH') throw new ValidationError('Selecione um host SSH deste cliente')
      await tx.$executeRaw(Prisma.sql`INSERT INTO network_tacacs_devices (tenant_id,host_id,source_ip,certificate_fingerprint_sha256,enabled) VALUES (${tenantId},${data.hostId},${data.sourceIp},${data.certificateFingerprintSha256},${data.enabled}) ON DUPLICATE KEY UPDATE certificate_fingerprint_sha256=IF(tenant_id=${tenantId} AND host_id=${data.hostId},VALUES(certificate_fingerprint_sha256),certificate_fingerprint_sha256),secret_cipher=IF(tenant_id=${tenantId} AND host_id=${data.hostId},NULL,secret_cipher),source_ip=IF(tenant_id=${tenantId} AND host_id=${data.hostId},VALUES(source_ip),source_ip),enabled=IF(tenant_id=${tenantId} AND host_id=${data.hostId},VALUES(enabled),enabled)`)
      const own = await tx.$queryRaw<Array<{id:number}>>(Prisma.sql`SELECT id FROM network_tacacs_devices WHERE tenant_id=${tenantId} AND host_id=${data.hostId} AND source_ip=${data.sourceIp} AND certificate_fingerprint_sha256=${data.certificateFingerprintSha256}`)
      if (!own.length) throw new ValidationError('Origem ou certificado já reservado. Cada equipamento deve ter IP de origem e certificado exclusivos.')
      await this.audit(tx, tenantId, actorId, 'DEVICE_SAVED', data.hostId, { sourceIp: data.sourceIp, enabled: data.enabled, certificateFingerprintSha256: data.certificateFingerprintSha256 })
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || (error.code === 'P2010' && error.meta?.code === '1062'))) {
        throw new ValidationError('Origem ou certificado já reservado. Cada equipamento deve ter IP de origem e certificado exclusivos.')
      }
      throw error
    })
  }
  async saveCredential(tenantId: number, actorId: number, input: unknown): Promise<void> {
    const data = parseInput(CredentialSchema, input)
    const hash = await bcrypt.hash(data.password, 12)
    await this.db.$transaction(async tx => {
      if (!await tx.user.findFirst({ where: { id: data.userId, tenantId, active: true, deletedAt: null } })) throw new ValidationError('Usuário ativo deste cliente não encontrado')
      const collision = await tx.$queryRaw<Array<{userId:number}>>(Prisma.sql`SELECT user_id AS userId FROM network_tacacs_credentials WHERE tenant_id=${tenantId} AND username=${data.username}`)
      if (collision.some(row => row.userId !== data.userId)) throw new ValidationError('Login AAA já vinculado a outro usuário deste cliente')
      // UPDATE then INSERT avoids a conflicting username modifying a different identity.
      const existing = await tx.$queryRaw<Array<{userId:number}>>(Prisma.sql`SELECT user_id AS userId FROM network_tacacs_credentials WHERE tenant_id=${tenantId} AND user_id=${data.userId} FOR UPDATE`)
      if (existing.length) await tx.$executeRaw(Prisma.sql`UPDATE network_tacacs_credentials SET username=${data.username},password_hash=${hash},enabled=${data.enabled} WHERE tenant_id=${tenantId} AND user_id=${data.userId}`)
      else await tx.$executeRaw(Prisma.sql`INSERT INTO network_tacacs_credentials (tenant_id,user_id,username,password_hash,enabled) VALUES (${tenantId},${data.userId},${data.username},${hash},${data.enabled})`)
      await this.audit(tx, tenantId, actorId, 'CREDENTIAL_SAVED', data.userId, { username: data.username, enabled: data.enabled, credentialRotated: true })
    })
  }
  async saveGrant(tenantId: number, actorId: number, input: unknown): Promise<void> {
    const data = parseInput(GrantSchema, input)
    await this.db.$transaction(async tx => {
      if (!await tx.user.findFirst({ where: { id:data.userId,tenantId,deletedAt:null } }) || !await tx.host.findFirst({ where:{id:data.hostId,tenantId,deletedAt:null} })) throw new ValidationError('Usuário e host devem pertencer a este cliente')
      const before = await tx.$queryRaw(Prisma.sql`SELECT commands_json FROM network_tacacs_grants WHERE tenant_id=${tenantId} AND user_id=${data.userId} AND host_id=${data.hostId} FOR UPDATE`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO network_tacacs_grants (tenant_id,user_id,host_id,commands_json) VALUES (${tenantId},${data.userId},${data.hostId},${JSON.stringify(data.commands)}) ON DUPLICATE KEY UPDATE commands_json=VALUES(commands_json)`)
      await this.audit(tx,tenantId,actorId,'GRANT_SAVED',data.hostId,{userId:data.userId,previousPolicyHash:createHash('sha256').update(JSON.stringify(before)).digest('hex'),commandCount:data.commands.length,policyHash:createHash('sha256').update(JSON.stringify(data.commands)).digest('hex')})
    })
  }
  async remove(tenantId:number,actorId:number,kind:'devices'|'credentials'|'grants',id:number,userId?:number): Promise<void> {
    if (kind === 'grants' && !userId) throw new ValidationError('Informe o usuário da permissão a remover')
    await this.db.$transaction(async tx => {
      if(kind==='devices') await tx.$executeRaw(Prisma.sql`DELETE FROM network_tacacs_devices WHERE tenant_id=${tenantId} AND id=${id}`)
      if(kind==='credentials') await tx.$executeRaw(Prisma.sql`DELETE FROM network_tacacs_credentials WHERE tenant_id=${tenantId} AND user_id=${id}`)
      if(kind==='grants') await tx.$executeRaw(Prisma.sql`DELETE FROM network_tacacs_grants WHERE tenant_id=${tenantId} AND host_id=${id} AND user_id=${userId ?? 0}`)
      await this.audit(tx,tenantId,actorId,'REMOVED',id,{kind,userId})
    })
  }
  async device(ip: string, certificateFingerprintSha256: string): Promise<TacacsDevice | null> {
    const fingerprint = CertificateFingerprintSchema.safeParse(certificateFingerprintSha256)
    if (!fingerprint.success) return null
    const rows = await this.db.$queryRaw<TacacsDevice[]>(Prisma.sql`SELECT d.id,d.tenant_id AS tenantId,d.host_id AS hostId FROM network_tacacs_devices d JOIN network_settings s ON s.tenant_id=d.tenant_id JOIN tenants t ON t.id=d.tenant_id JOIN hosts h ON h.id=d.host_id AND h.tenant_id=d.tenant_id WHERE d.source_ip=${ip} AND d.certificate_fingerprint_sha256=${fingerprint.data} AND d.enabled=TRUE AND s.tacacs_enabled=TRUE AND t.active=TRUE AND h.deleted_at IS NULL`)
    return rows[0] ?? null
  }
  private async identity(device:TacacsDevice,username:string): Promise<Identity | null> {
    const rows = await this.db.$queryRaw<Array<{userId:number;role:'ADMIN'|'USER';hash:string}>>(Prisma.sql`SELECT u.id AS userId,u.role,c.password_hash AS hash FROM network_tacacs_credentials c JOIN users u ON u.id=c.user_id AND u.tenant_id=c.tenant_id WHERE c.tenant_id=${device.tenantId} AND c.username=${username} AND c.enabled=TRUE AND u.active=TRUE AND u.deleted_at IS NULL AND (u.locked_until IS NULL OR u.locked_until < CURRENT_TIMESTAMP(3))`)
    const identity=rows[0]
    if(!identity || !await this.ssh.hasEffectiveHostPermission(device.hostId,device.tenantId,identity.userId,'connect',identity.role)) return null
    return identity
  }
  async authenticate(device:TacacsDevice,username:string,password:string): Promise<boolean> {
    const identity=await this.identity(device,username)
    const allowed=Boolean(identity && await bcrypt.compare(password,identity.hash))
    await this.event(device,username,'authentication',allowed?'permit':'deny',[])
    return allowed
  }
  async authorize(device:TacacsDevice,username:string,args:string[]): Promise<boolean> {
    const identity=await this.identity(device,username)
    let allowed=false
    if(identity) {
      const rows=await this.db.$queryRaw<Array<{commands:string}>>(Prisma.sql`SELECT commands_json AS commands FROM network_tacacs_grants WHERE tenant_id=${device.tenantId} AND user_id=${identity.userId} AND host_id=${device.hostId}`)
      allowed=commandAllowed(rows[0]?parseCommands(rows[0].commands):[],args)
    }
    await this.event(device,username,'authorization',allowed?'permit':'deny',args)
    return allowed
  }
  async event(device:TacacsDevice,username:string,kind:string,outcome:string,args:string[]): Promise<void> {
    const safeArgs = args.some(arg => /(?:password|secret|community|private-key|token)/i.test(arg)) ? ['[comando com credencial omitido]'] : args
    await this.db.$executeRaw(Prisma.sql`INSERT INTO network_tacacs_events (tenant_id,device_id,username,kind,outcome,command_json) VALUES (${device.tenantId},${device.id},${username.slice(0,64)},${kind},${outcome},${JSON.stringify({hostId:device.hostId,arguments:safeArgs})})`)
  }
}
