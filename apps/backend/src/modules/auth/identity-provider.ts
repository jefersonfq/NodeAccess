import type { User } from '@prisma/client'

export interface IdentityProviderAuthenticateInput {
  tenantId: number
  email: string
  password: string
}

export interface IdentityProviderAuthenticateResult {
  user: User | null
  passwordValid: boolean
}

export interface IdentityProvider {
  type: 'local' | 'ldap' | 'oidc' | 'saml' | 'google'
  providerKey: string
  authenticate(input: IdentityProviderAuthenticateInput): Promise<IdentityProviderAuthenticateResult>
}
