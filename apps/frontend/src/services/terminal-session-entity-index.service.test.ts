import { describe, expect, it } from 'vitest'
import { TerminalSessionEntityIndex } from './terminal-session-entity-index.service'

describe('terminal session entity index', () => {
  it('learns systemd units from audited output without executing hidden commands', () => {
    const index = new TerminalSessionEntityIndex()
    index.observe('systemctl --failed', 'ssh.service loaded failed\nnodeaccess-agent.service loaded active')
    expect(index.suggest('systemctl restart node')).toMatchObject([{ value: 'systemctl restart nodeaccess-agent.service', contextLabel: 'systemd · sessão', persistable: false }])
  })
  it('learns Docker, Kubernetes and Git entities and rejects unsafe tokens', () => {
    const index = new TerminalSessionEntityIndex()
    index.observe('docker ps', 'CONTAINER ID IMAGE STATUS NAMES\na1 image Up api-01\na2 image Up bad;rm')
    index.observe('kubectl get pods -A', 'NAMESPACE NAME READY\ninfra gateway-0 1/1')
    index.observe('git branch', '* main\n  feature/autocomplete')
    expect(index.suggest('docker logs ap')[0]?.value).toBe('docker logs api-01')
    expect(index.suggest('kubectl logs gate')[0]?.value).toBe('kubectl logs gateway-0')
    expect(index.suggest('git switch fea')[0]?.value).toBe('git switch feature/autocomplete')
    expect(index.suggest('docker logs bad')).toEqual([])
  })
  it('is bounded and session-local', () => {
    const index = new TerminalSessionEntityIndex()
    index.observe('systemctl status', Array.from({ length: 200 }, (_, i) => `unit-${i}.service`).join('\n'))
    expect(index.suggest('systemctl status ', 200)).toHaveLength(128)
    index.clear(); expect(index.suggest('systemctl status ')).toEqual([])
  })
})
