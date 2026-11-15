import type { PemKeyPublic, SecretPublic } from '@nodeaccess/shared'
export interface SecretActionHandle {
  openCreate: () => void
  openEdit: (secret: SecretPublic) => void
  openRotate: (secret: SecretPublic) => void
  openConsumers: (secret: SecretPublic) => Promise<void>
  revoke: (secret: SecretPublic) => void
  remove: (secret: SecretPublic) => void
}
export interface PemActionHandle {
  openCreate: () => void
  openPassphrase: (key: PemKeyPublic) => void
  remove: (key: PemKeyPublic) => void
}
