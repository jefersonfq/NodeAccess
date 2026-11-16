export const secretFixture = {
  id: 1, tenantId: 7, alias: 'database', description: 'Production', scope: 'PERSONAL',
  ownerUserId: 41, groupId: null, createdByUserId: 41, createdByUsername: 'Operator', source: 'MANUAL',
  createdAt: '2026-11-15T12:00:00Z', updatedAt: '2026-11-15T12:00:00Z', rotatedAt: null, revokedAt: null,
}
export const pemFixture = { id: 1, name: 'gateway', createdById: 41, createdAt: secretFixture.createdAt, hasPassphrase: true }
