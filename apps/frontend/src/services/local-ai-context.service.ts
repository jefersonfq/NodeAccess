const LAST_SCREEN_KEY = 'nodeaccess_local_ai_last_screen'

export type LocalAiLastScreen = {
  routeName: string
  fullPath: string
}

export function setLocalAiLastScreen(routeName?: string | null, fullPath?: string | null): void {
  if (!routeName || !fullPath) return
  window.sessionStorage.setItem(LAST_SCREEN_KEY, JSON.stringify({
    routeName,
    fullPath,
  } satisfies LocalAiLastScreen))
}

export function getLocalAiLastScreen(): LocalAiLastScreen | null {
  const raw = window.sessionStorage.getItem(LAST_SCREEN_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as LocalAiLastScreen
  } catch {
    return null
  }
}
