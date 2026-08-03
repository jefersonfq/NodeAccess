export function avatarVersionFor(updatedAt: Date | null | undefined): string | null {
  return updatedAt ? String(updatedAt.getTime()) : null
}

export function avatarUrlFor(userId: number, updatedAt: Date | null | undefined): string | null {
  const version = avatarVersionFor(updatedAt)
  return version ? `/api/v1/users/${userId}/avatar?v=${version}` : null
}
