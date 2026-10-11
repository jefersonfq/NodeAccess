export function retryAt(error, attempts, now) {
  const transient = ['ACME_NETWORK','ACME_TIMEOUT','TLS_VERIFY_FAILED'].includes(error.code)
  const delay = transient ? Math.min(6 * 3600000, 300000 * 2 ** Math.min(attempts - 1, 8)) : 12 * 3600000
  const floor = error.code === 'ACME_RATE_LIMIT' ? 3600000 : delay
  return new Date(Math.max(now + floor, Date.parse(error.retryAfter || '') || 0)).toISOString()
}
export function certificateAlerts(state, certificate, now = Date.now()) {
  const alerts = []
  if (state.storageError || state.recoveryRequired) alerts.push({code: state.storageError?.code || 'RECOVERY_REQUIRED', severity:'error', message:state.storageError?.message || 'Recuperação do serviço de certificados necessária.'})
  if (certificate?.validTo) {
    const days = Math.floor((Date.parse(certificate.validTo) - now) / 86400000)
    if (days <= 30) alerts.push({code:'CERTIFICATE_EXPIRING', severity:days <= 7 ? 'error' : 'warning', message:days < 0 ? 'O certificado está vencido.' : `O certificado vence em ${days} dia(s).`, daysRemaining:days})
  }
  if (state.renewalFailure) alerts.push({code:state.renewalFailure.code, severity:'error', message:state.renewalFailure.message, retryAt:state.nextCheck})
  if (state.monitorError) alerts.push({code:'HTTPS_MONITOR_FAILED', severity:'error', message:state.monitorError.message})
  if(Date.parse(state.acmeBlockedUntil||'')>now&&!alerts.some(alert=>alert.code==='ACME_RATE_LIMIT'))alerts.push({code:'ACME_RATE_LIMIT',severity:'warning',message:'A autoridade certificadora solicitou uma pausa nas tentativas ACME.',retryAt:state.acmeBlockedUntil})
  return alerts
}
