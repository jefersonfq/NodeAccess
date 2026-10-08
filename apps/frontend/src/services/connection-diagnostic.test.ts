import { expect, it } from 'vitest'
import { connectionDiagnostic, diagnosticReference } from './connection-diagnostic'
it.each(['DNS_FAILED','HOST_PORT_REFUSED','HOST_UNREACHABLE','AUTH_FAILED','SSH_HANDSHAKE_TIMEOUT','BASTION_DNS_FAILED','BASTION_PORT_REFUSED','BASTION_UNREACHABLE','BASTION_AUTH_FAILED','BASTION_CONNECT_FAILED','AGENT_REQUIRED','AGENT_REQUIRED_USER','PRIVATE_ACCESS_CONNECTOR_REQUIRED','AGENT_ACCESS_DENIED','AGENT_CONNECT_FAILED','CREDENTIAL_ERROR','CREDENTIALS_TIMEOUT','SSH_INPUT_BLOCKED'])('explains %s with a stage and action', code => {
 const result=connectionDiagnostic(code);expect(result.stage).not.toBe('Etapa não informada');expect(result.cause.length).toBeGreaterThan(15);expect(result.action.length).toBeGreaterThan(25)
})
it('does not invent the remote cause on a socket interruption or unknown code',()=>{
 expect(connectionDiagnostic(null,'socket').stage).toBe('Comunicação com NodeAccess')
 expect(connectionDiagnostic('UNKNOWN', 'socket').stage).toBe('Etapa não informada')
 expect(connectionDiagnostic('toString').stage).toBe('Etapa não informada')
 expect(connectionDiagnostic('AUTH_FAILED','socket').stage).toBe('Autenticação no destino')
})
it('support reference excludes raw server messages and rejects arbitrary code payloads',()=>{
 expect(diagnosticReference(1,null,'password=secret','2026-09-28')).toBe('NodeAccess | Host ID: 1 | Sessão: não informada | Código: SEM_CODIGO | Observado em: 2026-09-28')
 expect(diagnosticReference(1,22,'DNS_FAILED','2026-09-28')).toContain('Sessão: 22 | Código: DNS_FAILED')
})
