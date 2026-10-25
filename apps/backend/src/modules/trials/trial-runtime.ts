import { TrialWriteLimiter } from './trial-write-limiter.js'
import { deliverTrialNotices } from './trial-notifications.js'
import { purgeExpiredTrialData } from './trial-retention.js'
import nodemailer from 'nodemailer'
import { env } from '../../config/env.js'
import { prisma } from '../../config/database.js'
import { redis } from '../../config/redis.js'
import { AuthRateLimitService } from '../auth/auth-rate-limit.service.js'
import { HttpTrialProvisioner } from './trial-provisioner.js'
import { TrialService } from './trial.service.js'
import { configureTrialPolicy, configureTrialUserReader, configureTrialHostReader, configureTrialProtectedAddresses } from './trial-policy.js'
import { logger } from '../../config/logger.js'

export function installTrialPolicy(): void {
  configureTrialProtectedAddresses(env.TRIAL_PROTECTED_ADDRESSES.split(',').map(value => value.trim()).filter(Boolean))
  configureTrialHostReader(async (tenantId, host) => !!await prisma.host.findFirst({ where: { id: host.id, tenantId, deletedAt: null, ip: host.ip, port: host.port }, select: { id: true } }))
  configureTrialPolicy(tenantId => prisma.trialRegistration.findUnique({ where: { tenantId } }))
  configureTrialUserReader(async (tenantId, userId, sessionVersion) => {
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId, active: true, deletedAt: null }, select: { sessionVersion: true } })
    return !!user && (sessionVersion === undefined || user.sessionVersion === sessionVersion)
  })
}
export function createTrialRuntime(): { service: TrialService; limiter: AuthRateLimitService; writeLimiter: TrialWriteLimiter; stop: () => void } {
  const smtp = env.TRIAL_SMTP_HOST && env.TRIAL_SMTP_USER && env.TRIAL_SMTP_PASSWORD && env.TRIAL_SMTP_FROM
    ? nodemailer.createTransport({ host: env.TRIAL_SMTP_HOST, port: env.TRIAL_SMTP_PORT, secure: env.TRIAL_SMTP_PORT === 465,
      requireTLS: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      auth: { user: env.TRIAL_SMTP_USER, pass: env.TRIAL_SMTP_PASSWORD } }) : null
  const service = new TrialService(prisma, {
    registrationsEnabled: env.TRIAL_REGISTRATION_ENABLED,
    protectedAddresses: env.TRIAL_PROTECTED_ADDRESSES.split(',').map(value => value.trim()).filter(Boolean),
    ...(env.TRIAL_PUBLIC_URL ? { publicUrl: env.TRIAL_PUBLIC_URL } : {}),
    ...(smtp ? { mailer: { async send(to: string, link: string): Promise<void> {
      await smtp.sendMail({ from: env.TRIAL_SMTP_FROM, to, subject: 'Confirme seu teste do NodeAccess',
        text: `Confirme seu e-mail para acompanhar o teste: ${link}\n\nO link é temporário e de uso único. Se você não solicitou, ignore esta mensagem. Não compartilhe o link.` })
    } } } : {}),
    ...(env.TRIAL_PROVISIONER_URL && env.TRIAL_PROVISIONER_TOKEN ? { provisioner: new HttpTrialProvisioner(env.TRIAL_PROVISIONER_URL, env.TRIAL_PROVISIONER_TOKEN) } : {}),
  })
  const limiter = new AuthRateLimitService(redis, { windowSeconds: 60, ip: 120, tenant: 5000, identity: 3, keySecret: env.JWT_SECRET })
  let running = false
  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      await service.tick()
      await service.machines.tick()
      await purgeExpiredTrialData(prisma, env.SESSION_AUDIT_STORAGE_DIR)
      if (smtp) await deliverTrialNotices(prisma, async (to, kind, expiresAt) => {
        await smtp.sendMail({ from: env.TRIAL_SMTP_FROM, to,
          subject: kind === 'ready' ? 'Seu ambiente NodeAccess está pronto' : 'Seu teste NodeAccess está perto de terminar',
          text: `Seu teste ${kind === 'ready' ? 'está pronto' : 'termina em breve'}. Validade: ${expiresAt.toISOString()} (UTC).\nAcompanhe em ${new URL('/trial', env.TRIAL_PUBLIC_URL).toString()}. Para recuperar acesso, solicite um novo link com seu e-mail.\nEsta é uma comunicação operacional do teste solicitado, independente da preferência de marketing.` })
      })
    } catch { logger.warn('Trial reconciliation unavailable; access deadlines remain enforced') }
    finally { running = false }
  }
  const timer = setInterval(() => { void tick() }, 30_000)
  timer.unref()
  void tick()
  return { service, limiter, writeLimiter: new TrialWriteLimiter(redis, env.JWT_SECRET), stop(): void { clearInterval(timer); smtp?.close() } }
}
