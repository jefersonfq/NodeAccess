import bcrypt from 'bcrypt'
import type { UserRepository } from '../users/user.repository.js'
import type {
  IdentityProvider,
  IdentityProviderAuthenticateInput,
  IdentityProviderAuthenticateResult,
} from './identity-provider.js'

export class LocalIdentityProvider implements IdentityProvider {
  readonly type = 'local'
  readonly providerKey = 'local'

  constructor(private readonly userRepo: UserRepository) {}

  async authenticate(input: IdentityProviderAuthenticateInput): Promise<IdentityProviderAuthenticateResult> {
    const user = await this.userRepo.findByEmail(input.email, input.tenantId)
    if (!user) return { user: null, passwordValid: false }

    const passwordValid = user.passwordHash
      ? await bcrypt.compare(input.password, user.passwordHash)
      : false

    return { user, passwordValid }
  }
}
