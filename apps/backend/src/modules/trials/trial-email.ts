import { trialEmailBrandPng } from './trial-email-brand.js'

export interface TrialEmailPolicy { retentionDays: number; privacyUrl: string; termsUrl: string }
type TrialEmailInput = { kind: 'verification'; link: string }
  | ({ kind: 'ready' | 'expiring'; link: string; expiresAt: Date } & TrialEmailPolicy)
export interface TrialEmail {
  subject: string
  text: string
  html: string
  attachments: { filename: string; content: Buffer; contentType: string; cid: string; contentDisposition: 'inline' }[]
}
const brandCid = 'nodeaccess-brand@trial.local'
function escape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
function safeLink(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('INVALID_TRIAL_EMAIL_LINK')
  return url.toString()
}
/** Pure renderer: no tracking, network access, transport or delivery side effects. */
export function renderTrialEmail(input: TrialEmailInput): TrialEmail {
  const link = safeLink(input.link)
  const verification = input.kind === 'verification'
  const ready = input.kind === 'ready'
  const subject = verification ? 'Confirme seu teste do NodeAccess' : ready ? 'Seu ambiente NodeAccess está pronto' : 'Seu teste NodeAccess está perto de terminar'
  const title = verification ? 'Confirme seu e-mail' : ready ? 'Seu ambiente está pronto' : 'Seu teste termina em breve'
  const intro = verification ? 'Falta confirmar seu e-mail para acompanhar seu teste do NodeAccess.'
    : ready ? 'Seu ambiente de teste já está disponível. Acesse a página do teste para começar ou continuar sua avaliação.'
      : 'Aproveite o tempo restante para concluir sua avaliação e guardar o que precisar.'
  const action = verification ? 'Confirmar meu e-mail' : 'Acompanhar meu teste'
  let policyText = ''
  let policyHtml = ''
  if (!verification) {
    if (!Number.isFinite(input.expiresAt.getTime()) || !Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 365) throw new Error('INVALID_TRIAL_EMAIL_POLICY')
    const expires = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(input.expiresAt)
    const validity = `Disponível até ${expires} (horário de Brasília, America/Sao_Paulo).`
    const lifecycle = `Ao terminar, o acesso é encerrado e as máquinas de demonstração são removidas. Os dados do ambiente no NodeAccess seguem a rotina de exclusão após ${input.retentionDays} dias contados da conclusão do encerramento. Máquinas externas cadastradas por você não são apagadas. Cópias de segurança seguem ciclos próprios de retenção.`
    const privacy = safeLink(input.privacyUrl)
    const terms = safeLink(input.termsUrl)
    policyText = `${validity}\n${lifecycle}\nAviso de privacidade: ${privacy}\nTermos do teste: ${terms}\n`
    policyHtml = `<div style="margin:24px 0;padding:18px;background:#eff6ff;border-left:4px solid #4f46e5;border-radius:8px"><strong style="color:#1e3a8a">${escape(validity)}</strong><p style="margin:12px 0 0;line-height:1.7">${escape(lifecycle)}</p></div><p style="font-size:14px"><a href="${escape(privacy)}" style="color:#4338ca">Aviso de privacidade</a> · <a href="${escape(terms)}" style="color:#4338ca">Termos do teste</a></p>`
  }
  const security = verification ? 'O link é temporário e de uso único. Se você não solicitou este teste, ignore esta mensagem. Não compartilhe o link.'
    : 'Para recuperar o acesso, solicite um novo link com seu e-mail na página do teste.'
  const footer = 'Esta é uma comunicação operacional do teste solicitado, independente da preferência de marketing.'
  const text = `${title}\n\n${intro}\n\n${policyText}\n${action}: ${link}\n\n${security}\n\n${footer}\nNodeAccess`
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;padding:0;background:#f4f6fc;color:#243047;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dfe5f0;border-radius:16px"><tr><td style="padding:28px 24px 16px;border-top:4px solid #6366f1"><img src="cid:${brandCid}" width="52" height="52" alt="" style="display:inline-block;vertical-align:middle;border:0"><span style="font-size:24px;font-weight:bold;color:#172554;vertical-align:middle;padding-left:12px">NodeAccess</span></td></tr><tr><td style="padding:8px 24px 28px"><p style="margin:0 0 8px;color:#4338ca;font-size:13px;font-weight:bold">${verification ? 'CONFIRMAÇÃO DE E-MAIL' : ready ? 'AMBIENTE DISPONÍVEL' : 'LEMBRETE DE VALIDADE'}</p><h1 style="margin:0 0 16px;font-size:28px;line-height:1.25;color:#172554">${escape(title)}</h1><p style="font-size:16px;line-height:1.7">${escape(intro)}</p>${policyHtml}<p style="margin:28px 0"><a href="${escape(link)}" style="display:inline-block;padding:14px 20px;border-radius:8px;background:#4f46e5;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none">${escape(action)}</a></p><p style="font-size:14px;line-height:1.7">${escape(security)}</p><p style="font-size:12px;line-height:1.6;color:#475569;overflow-wrap:anywhere;word-break:break-all">Se o botão não abrir, use este endereço:<br><a href="${escape(link)}" style="color:#4338ca">${escape(link)}</a></p></td></tr><tr><td style="padding:20px 24px;border-top:1px solid #dfe5f0;font-size:12px;line-height:1.7;color:#475569">${escape(footer)}<br>NodeAccess · Acesso seguro ao seu ambiente</td></tr></table></td></tr></table></body></html>`
  return { subject, text, html, attachments: [{ filename: 'nodeaccess.png', content: trialEmailBrandPng, contentType: 'image/png', cid: brandCid, contentDisposition: 'inline' }] }
}
