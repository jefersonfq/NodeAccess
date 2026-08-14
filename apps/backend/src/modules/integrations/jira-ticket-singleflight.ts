export class JiraTicketSingleFlight {
  private readonly pending = new Map<string, Promise<unknown>>()

  run<T>(tenantId: number, ticketKey: string, loader: () => Promise<T>): Promise<T> {
    const key = `${tenantId}:${ticketKey}`
    const existing = this.pending.get(key) as Promise<T> | undefined
    if (existing) return existing

    const request = loader().finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key)
    })
    this.pending.set(key, request)
    return request
  }
}
