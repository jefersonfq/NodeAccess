type CacheEntry<T> = {
  value: Promise<T>
  expiresAt: number
}

export function createTimedPromiseCache<T>(ttlMs: number) {
  let entry: CacheEntry<T> | null = null

  function get(factory: () => Promise<T>): Promise<T> {
    const now = Date.now()
    if (entry && entry.expiresAt > now) {
      return entry.value
    }

    const value = factory().catch((error) => {
      if (entry?.value === value) {
        entry = null
      }
      throw error
    })

    entry = {
      value,
      expiresAt: now + ttlMs,
    }

    return value
  }

  function clear() {
    entry = null
  }

  return {
    get,
    clear,
  }
}

