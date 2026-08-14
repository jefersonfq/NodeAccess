import { describe, expect, it, vi } from 'vitest'
import { JiraTicketSingleFlight } from './jira-ticket-singleflight.js'

describe('JiraTicketSingleFlight', () => {
  it('compartilha somente consultas simultaneas do mesmo tenant e ticket', async () => {
    const singleFlight = new JiraTicketSingleFlight()
    let resolve!: (value: string) => void
    const loader = vi.fn(() => new Promise<string>((done) => { resolve = done }))

    const first = singleFlight.run(7, 'OPS-123', loader)
    const second = singleFlight.run(7, 'OPS-123', loader)
    expect(loader).toHaveBeenCalledTimes(1)

    resolve('ticket')
    await expect(Promise.all([first, second])).resolves.toEqual(['ticket', 'ticket'])
  })

  it('isola consultas por tenant e chave do ticket', async () => {
    const singleFlight = new JiraTicketSingleFlight()
    const loader = vi.fn(() => Promise.resolve('ticket'))

    await Promise.all([
      singleFlight.run(1, 'OPS-1', loader),
      singleFlight.run(2, 'OPS-1', loader),
      singleFlight.run(1, 'OPS-2', loader),
    ])

    expect(loader).toHaveBeenCalledTimes(3)
  })

  it('nao mantem resposta nem erro depois da conclusao', async () => {
    const singleFlight = new JiraTicketSingleFlight()
    const success = vi.fn(() => Promise.resolve('ok'))
    await singleFlight.run(1, 'OPS-1', success)
    await singleFlight.run(1, 'OPS-1', success)
    expect(success).toHaveBeenCalledTimes(2)

    const failure = vi.fn(() => Promise.reject(new Error('Jira indisponivel')))
    await expect(singleFlight.run(1, 'OPS-2', failure)).rejects.toThrow('Jira indisponivel')
    await expect(singleFlight.run(1, 'OPS-2', failure)).rejects.toThrow('Jira indisponivel')
    expect(failure).toHaveBeenCalledTimes(2)
  })
})
