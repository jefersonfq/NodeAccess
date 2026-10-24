import { createHash, randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcrypt'
import { Prisma, type PrismaClient, type TrialRegistration, type TrialParticipant } from '@prisma/client'
import { AppError, ConflictError, UnauthorizedError, ValidationError } from '../../shared/errors.js'
import { encrypt } from '../../shared/crypto.js'
import { trialProfileSchema, registrationSchema, preferencesSchema, activationSchema, invitationSchema, type TrialProfile } from './trial-contract.js'
import { TrialCustomHosts, revokeTrialPemKeys } from './trial-custom-hosts.js'
import { TrialMachines } from './trial-machines.js'
import type { TrialProvisioner } from './trial-provisioner.js'

export interface TrialMailer { send(to: string, link: string): Promise<void> }
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex')
const newToken = (): string => randomBytes(32).toString('hex')
const GENERIC_REGISTRATION = { message: 'Se o cadastro puder prosseguir, enviaremos um link para seu e-mail. Confira também o spam.' }
const usableStates = ['ACTIVE']
export class TrialService {
  readonly machines: TrialMachines
  readonly customHosts: TrialCustomHosts
  constructor(private readonly db: PrismaClient, private readonly options: {
    registrationsEnabled: boolean; publicUrl?: string; mailer?: TrialMailer; provisioner?: TrialProvisioner; protectedAddresses?: readonly string[]
  }) {
    this.machines = new TrialMachines(db, options.provisioner)
    this.customHosts = new TrialCustomHosts(db, { protectedAddresses: options.protectedAddresses ?? [] })
  }

  async profile(): Promise<TrialProfile | null> {
    const row = await this.db.trialProfile.findUnique({ where: { id: 1 } })
    return row ? trialProfileSchema.parse(row.configJson) : null
  }
  async publicConfig(): Promise<{
    enabled: boolean; privacyUrl: string; termsUrl: string; privacyVersion: string;
    profile: Required<Pick<TrialProfile, 'name' | 'durationDays' | 'maxUsers' | 'maxHosts' | 'retentionDays' | 'machineCount' | 'maxMachines' | 'allowCustomHosts' | 'maxCustomHosts' | 'maxSessions' | 'resources'>> | null
  }> {
    const profile = await this.profile()
    return {
      enabled: !!(this.options.registrationsEnabled && profile && this.options.publicUrl && this.options.mailer && this.options.provisioner),
      privacyUrl: profile?.privacyUrl ?? '', termsUrl: profile?.termsUrl ?? '', privacyVersion: profile?.privacyVersion ?? '',
      profile: profile ? { name: profile.name, durationDays: profile.durationDays, maxUsers: profile.maxUsers, maxHosts: profile.maxHosts,
        retentionDays: profile.retentionDays, machineCount: profile.machineCount, maxMachines: profile.maxMachines ?? profile.machineCount,
        allowCustomHosts: profile.allowCustomHosts ?? false, maxCustomHosts: profile.maxCustomHosts ?? 0,
        maxSessions: profile.maxSessions, resources: profile.resources } : null,
    }
  }
  async updateProfile(input: unknown, actorId: number): Promise<TrialProfile> {
    const profile = trialProfileSchema.parse(input)
    await this.db.trialProfile.upsert({ where: { id: 1 }, create: { id: 1, configJson: profile, updatedBy: actorId }, update: { configJson: profile, updatedBy: actorId } })
    return profile
  }
  async list(): Promise<{ trials: Array<Pick<TrialRegistration, 'id' | 'name' | 'email' | 'status' | 'createdAt' | 'expiresAt' | 'lastError' | 'tenantId' | 'verifiedAt'>>; profile: TrialProfile | null; provisionerReady: boolean }> {
    const trials = await this.db.trialRegistration.findMany({ take: 100, orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, status: true, createdAt: true, expiresAt: true, lastError: true, tenantId: true, verifiedAt: true } })
    return { trials, profile: await this.profile(), provisionerReady: !!this.options.provisioner }
  }
  async register(input: unknown): Promise<typeof GENERIC_REGISTRATION> {
    const data = registrationSchema.parse(input)
    const config = await this.publicConfig()
    if (!config.enabled) throw new AppError('Novos testes estão temporariamente indisponíveis. Tente novamente mais tarde.', 503, 'TRIAL_UNAVAILABLE')
    const profile = (await this.profile())!
    if (data.privacyVersion !== profile.privacyVersion) throw new ConflictError('O aviso de privacidade mudou. Recarregue a página antes de continuar.')
    const token = newToken()
    const now = new Date()
    // Lock the single profile row to bound pending registrations as well as active labs.
    const deliver = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_profiles WHERE id = 1 FOR UPDATE`
      const existing = await tx.trialRegistration.findUnique({ where: { email: data.email } })
      if (existing) {
        if (now.getTime() - existing.updatedAt.getTime() < 60_000) return false
        await tx.trialRegistration.update({ where: { id: existing.id }, data: {
          verificationHash: tokenHash(token), verificationExpiresAt: new Date(now.getTime() + 30 * 60_000),
        } })
        return true
      }
      // Do not duplicate an existing identity or reveal whether it exists.
      if (await tx.user.findFirst({ where: { email: data.email, deletedAt: null }, select: { id: true } })) return false
      const pending = await tx.trialRegistration.count({ where: { status: 'PENDING_EMAIL' } })
      if (pending >= profile.maxActiveTrials * 20) return false
      const trial = await tx.trialRegistration.create({ data: {
        id: randomUUID(), email: data.email, name: data.name, profileJson: profile,
        verificationHash: tokenHash(token), verificationExpiresAt: new Date(now.getTime() + 30 * 60_000),
        marketingConsent: data.marketingConsent, researchConsent: data.researchConsent, privacyVersion: data.privacyVersion,
      } })
      await tx.trialConsentEvent.create({ data: { id: randomUUID(), trialId: trial.id, kind: 'REGISTRATION',
        marketing: data.marketingConsent, research: data.researchConsent, privacyVersion: data.privacyVersion } })
      return true
    })
    if (deliver) {
      const url = new URL('/trial', this.options.publicUrl)
      url.hash = `token=${token}`
      // SMTP errors are not reflected as account-existence differences. Retry is rate limited.
      await this.options.mailer!.send(data.email, url.toString()).catch(async () => {
        await this.db.trialRegistration.updateMany({ where: { email: data.email }, data: { lastError: 'EMAIL_DELIVERY_FAILED' } })
      })
    }
    return GENERIC_REGISTRATION
  }
  async verify(token: string): Promise<{ accessToken: string }> {
    const management = newToken()
    return this.db.$transaction(async tx => {
      const row = await tx.trialRegistration.findUnique({ where: { verificationHash: tokenHash(token) } })
      if (row && row.verificationExpiresAt && row.verificationExpiresAt > new Date()) {
        const result = await tx.trialRegistration.updateMany({ where: { id: row.id, verificationHash: tokenHash(token) },
          data: { ...(row.status === 'PENDING_EMAIL' ? { status: 'QUEUED', verifiedAt: new Date() } : {}),
            verificationHash: null, verificationExpiresAt: null, managementHash: tokenHash(management) } })
        if (result.count === 1) return { accessToken: management }
      }
      const participant = await tx.trialParticipant.updateMany({ where: {
        verificationHash: tokenHash(token), verificationExpiresAt: { gt: new Date() }, cancelledAt: null,
      }, data: { verifiedAt: new Date(), verificationHash: null, managementHash: tokenHash(management) } })
      if (participant.count === 1) return { accessToken: management }
      throw new ValidationError('Link inválido, já utilizado ou expirado. Solicite outro acesso.')
    })
  }
  private async managed(token: string): Promise<TrialRegistration & { participant?: TrialParticipant }> {
    const trial = await this.db.trialRegistration.findUnique({ where: { managementHash: tokenHash(token) } })
    if (trial) return trial
    const participant = await this.db.trialParticipant.findUnique({ where: { managementHash: tokenHash(token) }, include: { trial: true } })
    if (!participant) throw new UnauthorizedError('Acesso ao teste inválido. Use o link de confirmação recebido.')
    return { ...participant.trial, participant }
  }
  async status(token: string): Promise<{
    status: string; expiresAt: Date | null; tenantSlug: string | null; activated: boolean;
    owner: boolean; consentRequired: boolean; privacyVersion: string; privacyUrl: string; termsUrl: string;
    maxUsers: number; users: number; marketingConsent: boolean; researchConsent: boolean; message: string | null
  }> {
    const trial = await this.managed(token)
    const tenant = trial.tenantId ? await this.db.tenant.findUnique({ where: { id: trial.tenantId }, select: { slug: true } }) : null
    const expired = trial.expiresAt && trial.expiresAt <= new Date()
    const profile = trial.profileJson as unknown as TrialProfile
    const identity = trial.participant ?? trial
    return { status: trial.participant?.cancelledAt ? 'CANCELLED' : expired && trial.status === 'ACTIVE' ? 'EXPIRED' : trial.status,
      expiresAt: trial.expiresAt, tenantSlug: tenant?.slug ?? null, activated: !!identity.activatedAt,
      owner: !trial.participant, consentRequired: !!trial.participant && !identity.activatedAt,
      privacyVersion: trial.privacyVersion, privacyUrl: profile.privacyUrl, termsUrl: profile.termsUrl,
      maxUsers: profile.maxUsers, users: 1 + await this.db.trialParticipant.count({ where: { trialId: trial.id, cancelledAt: null, OR: [{ verifiedAt: { not: null } }, { verificationExpiresAt: { gt: new Date() } }] } }),
      marketingConsent: identity.marketingConsent, researchConsent: identity.researchConsent,
      message: trial.lastError ? 'A preparação está demorando. Você pode aguardar uma nova tentativa ou cancelar o teste.' : null }
  }
  async invite(token: string, input: unknown): Promise<typeof GENERIC_REGISTRATION> {
    const data = invitationSchema.parse(input)
    const trial = await this.managed(token)
    if (trial.participant || trial.status !== 'ACTIVE' || !trial.expiresAt || trial.expiresAt <= new Date() || !trial.activatedAt) throw new ConflictError('Convites indisponíveis neste momento.')
    const verification = newToken()
    const deliver = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_registrations WHERE id = ${trial.id} FOR UPDATE`
      const current = await tx.trialRegistration.findUniqueOrThrow({ where: { id: trial.id } })
      if (current.status !== 'ACTIVE' || !current.expiresAt || current.expiresAt <= new Date()) throw new ConflictError('Degustação encerrada.')
      if (await tx.user.findFirst({ where: { email: data.email, deletedAt: null }, select: { id: true } })) return false
      const existing = await tx.trialParticipant.findUnique({ where: { trialId_email: { trialId: trial.id, email: data.email } } })
      if (existing?.activatedAt || existing?.cancelledAt) return false
      const used = await tx.trialParticipant.count({ where: { trialId: trial.id, cancelledAt: null, OR: [{ verifiedAt: { not: null } }, { verificationExpiresAt: { gt: new Date() } }] } })
      const alreadyReserved = existing && !existing.cancelledAt && (existing.verifiedAt || existing.verificationExpiresAt > new Date())
      if (!alreadyReserved && used + 1 >= (trial.profileJson as unknown as TrialProfile).maxUsers) throw new ConflictError('Limite de participantes atingido.')
      const values = { name: data.name, verificationHash: tokenHash(verification), verificationExpiresAt: new Date(Math.min(Date.now() + 86400_000, current.expiresAt.getTime())) }
      await tx.trialParticipant.upsert({ where: { trialId_email: { trialId: trial.id, email: data.email } },
        create: { id: randomUUID(), trialId: trial.id, email: data.email, ...values }, update: values })
      return true
    })
    if (deliver && this.options.mailer) {
      const url = new URL('/trial', this.options.publicUrl); url.hash = `token=${verification}`
      await this.options.mailer.send(data.email, url.toString()).catch(() => undefined)
    }
    return GENERIC_REGISTRATION
  }
  async preferences(token: string, input: unknown): Promise<{ ok: boolean }> {
    const data = preferencesSchema.parse(input)
    const trial = await this.managed(token)
    await this.db.$transaction(async tx => {
      if (trial.participant) await tx.trialParticipant.update({ where: { id: trial.participant.id }, data })
      else await tx.trialRegistration.update({ where: { id: trial.id }, data })
      await tx.trialConsentEvent.create({ data: { id: randomUUID(), trialId: trial.id, kind: 'PREFERENCES', participantId: trial.participant?.id ?? null,
        marketing: data.marketingConsent, research: data.researchConsent, privacyVersion: trial.privacyVersion } })
    })
    return { ok: true }
  }
  async activate(token: string, input: unknown): Promise<{ tenantSlug: string }> {
    const activation = activationSchema.parse(input)
    const { password } = activation
    const trial = await this.managed(token)
    if (trial.status !== 'ACTIVE' || !trial.expiresAt || trial.expiresAt <= new Date() || (trial.participant ? trial.participant.cancelledAt || trial.participant.activatedAt : trial.activatedAt)) throw new ConflictError('Conta já ativada ou teste indisponível.')
    const passwordHash = await bcrypt.hash(password, 12)
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_registrations WHERE id = ${trial.id} FOR UPDATE`
      const current = await tx.trialRegistration.findUniqueOrThrow({ where: { id: trial.id } })
      if (!usableStates.includes(current.status) || !current.expiresAt || current.expiresAt <= new Date() || !current.tenantId) throw new ConflictError('O teste ainda não está disponível ou já expirou.')
      if (trial.participant) {
        const participant = await tx.trialParticipant.findUniqueOrThrow({ where: { id: trial.participant.id } })
        if (participant.cancelledAt || participant.activatedAt || !participant.verifiedAt) throw new ConflictError('Convite indisponível ou já ativado.')
        if (!activation.termsAccepted || activation.privacyVersion !== trial.privacyVersion) throw new ValidationError('Leia e aceite os termos vigentes antes de ativar sua conta.')
        const count = await tx.user.count({ where: { tenantId: current.tenantId, active: true, deletedAt: null } })
        if (count >= (trial.profileJson as unknown as TrialProfile).maxUsers) throw new ConflictError('Limite de participantes atingido.')
        if (await tx.user.findFirst({ where: { email: participant.email, deletedAt: null }, select: { id: true } })) throw new ConflictError('Não foi possível ativar este convite. Entre em contato com o responsável.')
        const user = await tx.user.create({ data: { tenantId: current.tenantId, email: participant.email, name: participant.name,
          role: 'USER', passwordHash, forcePasswordChange: false, canManageHosts: false } })
        await tx.trialParticipant.update({ where: { id: participant.id }, data: { activatedAt: new Date(), userId: user.id,
          marketingConsent: activation.marketingConsent ?? false, researchConsent: activation.researchConsent ?? false } })
        await tx.trialConsentEvent.create({ data: { id: randomUUID(), trialId: trial.id, participantId: participant.id,
          kind: 'INVITATION_ACCEPTED', marketing: activation.marketingConsent ?? false, research: activation.researchConsent ?? false, privacyVersion: trial.privacyVersion } })
        return { tenantSlug: (await tx.tenant.findUniqueOrThrow({ where: { id: current.tenantId } })).slug }
      }
      if (current.activatedAt) throw new ConflictError('Conta já ativada. Entre com a senha definida.')
      const updated = await tx.user.updateMany({ where: { tenantId: current.tenantId, email: current.email!, active: false }, data: { passwordHash, active: true, forcePasswordChange: false } })
      if (updated.count !== 1) throw new ConflictError('Não foi possível ativar a conta.')
      await tx.trialRegistration.update({ where: { id: trial.id }, data: { activatedAt: new Date() } })
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: current.tenantId } })
      return { tenantSlug: tenant.slug }
    })
  }
  async cancel(token: string): Promise<{ ok: boolean }> {
    const trial = await this.managed(token)
    if (!trial.participant) return this.cancelById(trial.id)
    const participantId = trial.participant.id
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_registrations WHERE id = ${trial.id} FOR UPDATE`
      const participant = await tx.trialParticipant.findUniqueOrThrow({ where: { id: participantId } })
      await tx.trialParticipant.update({ where: { id: participant.id }, data: { cancelledAt: new Date(), verificationHash: null, marketingConsent: false, researchConsent: false } })
      if (participant.userId && trial.tenantId) await tx.user.updateMany({ where: { id: participant.userId, tenantId: trial.tenantId }, data: { active: false, sessionVersion: { increment: 1 } } })
    })
    return { ok: true }
  }
  async cancelById(id: string): Promise<{ ok: boolean }> {
    await this.db.trialRegistration.updateMany({ where: { id, status: { notIn: ['REMOVED', 'REMOVING', 'CANCELLED', 'EXPIRED'] } },
      data: { status: 'CANCELLED', expiresAt: new Date(), verificationHash: null } })
    return { ok: true }
  }

  /** Idempotent reconciliation; never uses operator/user-supplied infrastructure IDs. */
  async tick(): Promise<void> {
    await this.db.trialRegistration.updateMany({ where: { status: 'ACTIVE', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } })
    await this.db.trialRegistration.updateMany({ where: { status: 'PENDING_EMAIL', verificationExpiresAt: { lt: new Date(Date.now() - 86400_000) } }, data: { status: 'CANCELLED', verificationHash: null } })
    const cleanup = await this.db.trialRegistration.findMany({ where: { status: { in: ['CANCELLED', 'EXPIRED', 'REMOVING'] } }, orderBy: { updatedAt: 'asc' }, take: 20 })
    const preparing = await this.db.trialRegistration.findMany({ where: { status: 'PROVISIONING' }, orderBy: { updatedAt: 'asc' }, take: 10 })
    const queued = await this.db.trialRegistration.findMany({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' }, take: 10 })
    const trials = [...cleanup, ...preparing, ...queued]
    for (const trial of trials) {
      try {
        if (['CANCELLED', 'EXPIRED', 'REMOVING'].includes(trial.status)) await this.remove(trial)
        else await this.provision(trial)
      } catch {
        if (['QUEUED', 'PROVISIONING'].includes(trial.status)) await this.db.trialRegistration.updateMany({ where: { id: trial.id, status: 'REMOVED' }, data: { status: 'REMOVING' } })
        // Error detail may contain SMTP/provider secrets. Persist only a fixed diagnostic code.
        await this.db.trialRegistration.update({ where: { id: trial.id }, data: { lastError: 'RECONCILIATION_RETRY' } })
      }
    }
  }
  private async provision(trial: TrialRegistration): Promise<void> {
    if (!this.options.provisioner) return
    const profile = trialProfileSchema.parse(trial.profileJson)
    if (trial.status === 'QUEUED') {
      const reserved = await this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM trial_profiles WHERE id = 1 FOR UPDATE`
        const storedProfile = await tx.trialProfile.findUnique({ where: { id: 1 } })
        const currentProfile = storedProfile ? trialProfileSchema.parse(storedProfile.configJson) : null
        const occupied = await tx.trialRegistration.count({ where: { status: { in: ['PROVISIONING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'REMOVING'] }, verifiedAt: { not: null } } })
        if (occupied >= (currentProfile?.maxActiveTrials ?? profile.maxActiveTrials)) return false
        return (await tx.trialRegistration.updateMany({ where: { id: trial.id, status: 'QUEUED' }, data: { status: 'PROVISIONING' } })).count === 1
      })
      if (!reserved) return
    }
    const lab = await this.options.provisioner.ensure(trial.id, profile)
    const afterProvision = await this.db.trialRegistration.findUniqueOrThrow({ where: { id: trial.id } })
    if (!['PROVISIONING', 'ACTIVE'].includes(afterProvision.status)) {
      await this.db.trialRegistration.updateMany({ where: { id: trial.id, status: 'REMOVED' }, data: { status: 'REMOVING' } })
      await this.remove(afterProvision)
      return
    }
    if (lab.state !== 'ready') { await this.db.trialRegistration.updateMany({ where: { id: trial.id, status: 'PROVISIONING' }, data: { updatedAt: new Date() } }); return }
    const activated = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_profiles WHERE id = 1 FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM trial_registrations WHERE id = ${trial.id} FOR UPDATE`
      const current = await tx.trialRegistration.findUniqueOrThrow({ where: { id: trial.id } })
      if (current.status !== 'PROVISIONING' || current.tenantId) return false
      if (await tx.host.findFirst({ where: { ip: { in: lab.hosts.map(h => h.ip) }, deletedAt: null }, select: { id: true } })) throw new Error('LAB_ADDRESS_ALREADY_ASSIGNED')
      const expiresAt = new Date(Date.now() + profile.durationDays * 86400_000)
      const tenant = await tx.tenant.create({ data: { name: `Degustação ${trial.name}`, slug: `trial-${trial.id}`, active: true } })
      await tx.$executeRaw(Prisma.sql`INSERT INTO inventory_nodes (tenant_id, root_tenant_id, type, name, path, depth, updated_at) VALUES (${tenant.id}, ${tenant.id}, 'ROOT', '__root__', '/', 0, CURRENT_TIMESTAMP(3))`)
      await tx.license.create({ data: { tenantId: tenant.id, maxUsers: profile.maxUsers, maxHosts: profile.maxHosts,
        maxActiveSessionsTenant: profile.maxSessions, maxActiveSessionsPerUser: profile.maxSessions,
        expiresAt, featureEntitlementsJson: { snippets: true, sharedSessions: profile.resources.includes('sharing') }, sessionAuditEnabled: profile.resources.includes('audit'), integrationEntitlementsJson: {}, active: true } })
      const user = await tx.user.create({ data: { name: trial.name, email: trial.email!, tenantId: tenant.id,
        role: 'USER', active: false, canManageHosts: false, forcePasswordChange: false } })
      await tx.$executeRaw(Prisma.sql`INSERT INTO resource_acl_entries
        (tenant_id, inventory_node_id, principal_type, principal_id, can_view, can_connect, can_edit, can_admin, inherit_to_children, created_by_id, updated_at)
        SELECT ${tenant.id}, id, 'ROLE', 1, true, false, false, false, false, ${user.id}, CURRENT_TIMESTAMP(3)
        FROM inventory_nodes WHERE root_tenant_id = ${tenant.id}`)
      for (const host of lab.hosts) {
        const createdHost = await tx.host.create({ data: { name: host.name, ip: host.ip, port: host.port, sshUser: host.sshUser,
          authType: 'PASSWORD', passwordEncrypted: JSON.stringify(encrypt(host.password)),
          scope: 'GLOBAL', ownerId: user.id, tenantId: tenant.id,
          trustedHostKeyFingerprint: `${host.fingerprint.replace(/=+$/, '')}=`, operatingSystem: 'LINUX' } })
        await tx.$executeRaw(Prisma.sql`INSERT INTO inventory_nodes
          (tenant_id, parent_id, type, host_id, name, path, depth, updated_at)
          SELECT ${tenant.id}, id, 'HOST', ${createdHost.id}, ${host.name}, '', 1, CURRENT_TIMESTAMP(3)
          FROM inventory_nodes WHERE root_tenant_id = ${tenant.id}`)
        await tx.$executeRaw(Prisma.sql`UPDATE inventory_nodes node
          INNER JOIN inventory_nodes parent ON parent.id = node.parent_id
          SET node.path = CONCAT(parent.path, node.id, '/') WHERE node.host_id = ${createdHost.id}`)
        await tx.$executeRaw(Prisma.sql`INSERT INTO resource_acl_entries
          (tenant_id, inventory_node_id, principal_type, principal_id, can_view, can_connect, can_edit, can_admin, inherit_to_children, created_by_id, updated_at)
          SELECT ${tenant.id}, id, 'ROLE', 1, true, true, false, false, false, ${user.id}, CURRENT_TIMESTAMP(3)
          FROM inventory_nodes WHERE host_id = ${createdHost.id}`)
      }
      await tx.trialRegistration.update({ where: { id: trial.id }, data: { tenantId: tenant.id, status: 'ACTIVE', expiresAt,
        profileJson: { ...profile, hostAddresses: lab.hosts.map(h => h.ip) }, lastError: null } })
      return true
    })
    if (!activated) {
      const current = await this.db.trialRegistration.findUniqueOrThrow({ where: { id: trial.id } })
      if (current.status !== 'ACTIVE') {
        await this.db.trialRegistration.updateMany({ where: { id: trial.id, status: 'REMOVED' }, data: { status: 'REMOVING' } })
        await this.remove(current)
      }
    }
  }
  private async remove(trial: TrialRegistration): Promise<void> {
    // Revoke application access before asking infrastructure to remove anything.
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_registrations WHERE id = ${trial.id} FOR UPDATE`
      const current = await tx.trialRegistration.findUniqueOrThrow({ where: { id: trial.id } })
      if (!['CANCELLED', 'EXPIRED', 'REMOVING'].includes(current.status)) return
      await tx.trialRegistration.update({ where: { id: trial.id }, data: { status: 'REMOVING' } })
      if (current.tenantId) {
        await revokeTrialPemKeys(tx, current.tenantId)
        await tx.tenant.update({ where: { id: current.tenantId }, data: { active: false } })
        await tx.user.updateMany({ where: { tenantId: current.tenantId }, data: { active: false, sessionVersion: { increment: 1 }, passwordHash: null, mfaSecret: null } })
        await tx.host.updateMany({ where: { tenantId: current.tenantId }, data: { passwordEncrypted: null, deletedAt: new Date() } })
      }
    })
    // Even a failed/partial ensure can have created a resource under this ID.
    if (trial.verifiedAt) {
      if (!this.options.provisioner) return
      await this.options.provisioner.remove(trial.id)
    }
    await this.db.trialRegistration.updateMany({ where: { id: trial.id, status: 'REMOVING' }, data: { status: 'REMOVED', closedAt: new Date(), lastError: null } })
  }
}
