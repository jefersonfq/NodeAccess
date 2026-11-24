/**
 * NA-0198 — WebAuthn through a maintained implementation (@simplewebauthn/server, pinned). The library checks the
 * challenge, exact origin, RP ID hash, signature, user presence/verification and the signature counter; every failure
 * becomes null (the caller audits and refuses). Attestation is not requested ("none"): the vault trusts the user's own
 * authenticator after a fresh identity confirmation, not a vendor certificate chain.
 */
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, AuthenticatorTransport, RegistrationResponseJSON } from '@simplewebauthn/server'
import type { WebauthnVerifier } from './vault-ports.js'

const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])
const transports = (list: readonly string[]): AuthenticatorTransport[] => list.filter(t => TRANSPORTS.has(t)) as AuthenticatorTransport[]
const bytes = (base64url: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(base64url, 'base64url'))

export class SimpleWebauthnVerifier implements WebauthnVerifier {
  async authenticationOptions(input: { rpID: string; challenge: string; allow: Array<{ id: string; transports: string[] }> }): Promise<object> {
    return generateAuthenticationOptions({ rpID: input.rpID, challenge: bytes(input.challenge), userVerification: 'required', timeout: 120_000,
      allowCredentials: input.allow.map(c => ({ id: c.id, transports: transports(c.transports) })) })
  }
  async verifyAuthentication(input: Parameters<WebauthnVerifier['verifyAuthentication']>[0]): Promise<{ counter: number } | null> {
    try {
      const result = await verifyAuthenticationResponse({ response: input.response as AuthenticationResponseJSON, expectedChallenge: input.challenge,
        expectedOrigin: input.origin, expectedRPID: input.rpID, requireUserVerification: true,
        credential: { id: input.credential.id, publicKey: new Uint8Array(input.credential.publicKey), counter: input.credential.counter, transports: transports(input.credential.transports) } })
      return result.verified && result.authenticationInfo.userVerified ? { counter: result.authenticationInfo.newCounter } : null
    } catch { return null }
  }
  async registrationOptions(input: Parameters<WebauthnVerifier['registrationOptions']>[0]): Promise<object> {
    return generateRegistrationOptions({ rpID: input.rpID, rpName: input.rpName, userID: new Uint8Array(input.userHandle), userName: input.userName,
      challenge: bytes(input.challenge), attestationType: 'none', timeout: 120_000,
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      excludeCredentials: input.exclude.map(c => ({ id: c.id, transports: transports(c.transports) })) })
  }
  async verifyRegistration(input: Parameters<WebauthnVerifier['verifyRegistration']>[0]): Promise<{ id: string; publicKey: Uint8Array; counter: number; transports: string[] } | null> {
    try {
      const result = await verifyRegistrationResponse({ response: input.response as RegistrationResponseJSON, expectedChallenge: input.challenge,
        expectedOrigin: input.origin, expectedRPID: input.rpID, requireUserVerification: true })
      if (!result.verified || !result.registrationInfo) return null
      const { credential } = result.registrationInfo
      return { id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: transports(credential.transports ?? []) }
    } catch { return null }
  }
}
