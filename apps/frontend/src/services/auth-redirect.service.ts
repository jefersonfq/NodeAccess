import type { LocationQuery, RouteLocationNormalizedLoaded, RouteQueryAndHash } from 'vue-router'

export const AUTH_REDIRECT_QUERY_KEY = 'redirect'

function normalizeRedirectTarget(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('/auth')) return null
  if (value.startsWith('//')) return null
  return value
}

export function getSafeRedirectTarget(query: LocationQuery | RouteQueryAndHash, fallback = '/hosts'): string {
  const redirect = (query as Record<string, unknown>)[AUTH_REDIRECT_QUERY_KEY]
  return normalizeRedirectTarget(redirect) ?? fallback
}

export function buildAuthRedirectQuery(route: Pick<RouteLocationNormalizedLoaded, 'fullPath'>): { redirect: string } {
  const target = normalizeRedirectTarget(route.fullPath)
  return {
    redirect: target ?? '/hosts',
  }
}
