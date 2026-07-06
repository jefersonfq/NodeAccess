import { describe, expect, it } from 'vitest'
import { parseLoginCandidates, parseTarget } from './native-ssh-gateway.login-parser.js'

describe('Native SSH Gateway login parser', () => {
  it('keeps email login with direct target before ambiguous target user candidates', () => {
    expect(parseLoginCandidates('admin@nodeaccess.local@168.227.132.19')).toEqual([
      { nodeAccessLogin: 'admin@nodeaccess.local@168.227.132.19' },
      { nodeAccessLogin: 'admin@nodeaccess.local', target: '168.227.132.19' },
      { nodeAccessLogin: 'admin', targetUser: 'nodeaccess.local', target: '168.227.132.19' },
      { nodeAccessLogin: 'admin', target: 'nodeaccess.local@168.227.132.19' },
    ])
  })

  it('keeps email login with target user override before direct target fallback', () => {
    expect(parseLoginCandidates('admin@nodeaccess.local@root@168.227.132.19')).toEqual([
      { nodeAccessLogin: 'admin@nodeaccess.local@root@168.227.132.19' },
      { nodeAccessLogin: 'admin@nodeaccess.local@root', target: '168.227.132.19' },
      { nodeAccessLogin: 'admin@nodeaccess.local', targetUser: 'root', target: '168.227.132.19' },
      { nodeAccessLogin: 'admin@nodeaccess.local', target: 'root@168.227.132.19' },
      { nodeAccessLogin: 'admin', targetUser: 'nodeaccess.local', target: 'root@168.227.132.19' },
      { nodeAccessLogin: 'admin', target: 'nodeaccess.local@root@168.227.132.19' },
    ])
  })

  it('supports simple login, target user and target host', () => {
    expect(parseLoginCandidates('pulsesuporte@jumpserver@172.16.1.2')).toEqual([
      { nodeAccessLogin: 'pulsesuporte@jumpserver@172.16.1.2' },
      { nodeAccessLogin: 'pulsesuporte@jumpserver', target: '172.16.1.2' },
      { nodeAccessLogin: 'pulsesuporte', targetUser: 'jumpserver', target: '172.16.1.2' },
      { nodeAccessLogin: 'pulsesuporte', target: 'jumpserver@172.16.1.2' },
    ])
  })

  it('supports quoted OpenSSH user@gateway format with target user override', () => {
    expect(parseLoginCandidates('usuario_nodeaccess@usuario_host@10.0.0.5')).toEqual([
      { nodeAccessLogin: 'usuario_nodeaccess@usuario_host@10.0.0.5' },
      { nodeAccessLogin: 'usuario_nodeaccess@usuario_host', target: '10.0.0.5' },
      { nodeAccessLogin: 'usuario_nodeaccess', targetUser: 'usuario_host', target: '10.0.0.5' },
      { nodeAccessLogin: 'usuario_nodeaccess', target: 'usuario_host@10.0.0.5' },
    ])
  })

  it('parses connect command target overrides', () => {
    expect(parseTarget('root@172.16.1.2')).toEqual({ targetUser: 'root', target: '172.16.1.2' })
    expect(parseTarget('172.16.1.2')).toEqual({ target: '172.16.1.2' })
  })
})
