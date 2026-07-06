import { Duplex } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/env.js', () => ({
  env: {
    PEM_ENCRYPTION_KEY: '0'.repeat(64),
  },
}))

import { GuacdGraphicalSessionAdapter } from './graphical-session.adapter.js'
import type { HostCredentials } from '../ssh/ssh.repository.js'
import { encrypt } from '../../shared/crypto.js'

class FakeGuacdSocket extends Duplex {
  readonly writes: string[] = []

  constructor() {
    super()
    process.nextTick(() => this.emit('connect'))
  }

  _read(): void {
    // no-op
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const instruction = chunk.toString()
    this.writes.push(instruction)

    if (instruction.startsWith('6.select')) {
      this.push('4.args,8.hostname,4.port,8.username,8.password,5.width,6.height,3.dpi,11.ignore-cert,8.security,12.disable-auth,11.color-depth,14.force-lossless,13.resize-method,21.enable-font-smoothing,11.disable-gfx,22.disable-bitmap-caching,25.disable-offscreen-caching;')
    }

    if (instruction.startsWith('7.connect')) {
      this.push('5.ready,6.test-1;4.size,1.0,3.800,3.600;')
    }

    callback()
  }
}

class FakeVncGuacdSocket extends Duplex {
  readonly writes: string[] = []

  constructor() {
    super()
    process.nextTick(() => this.emit('connect'))
  }

  _read(): void {
    // no-op
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const instruction = chunk.toString()
    this.writes.push(instruction)

    if (instruction.startsWith('6.select')) {
      this.push('4.args,8.hostname,4.port,8.password,5.width,6.height,3.dpi,11.color-depth,9.read-only,13.swap-red-blue,6.cursor;')
    }

    if (instruction.startsWith('7.connect')) {
      this.push('5.ready,6.vnc-01;4.size,1.0,4.1024,3.768;')
    }

    callback()
  }
}

function host(overrides: Partial<HostCredentials> = {}): HostCredentials {
  return {
    id: 20,
    name: 'srv-rdp',
    ip: '10.0.0.20',
    port: 3389,
    accessProtocol: 'RDP',
    sshUser: 'root',
    authType: 'PASSWORD',
    connectionMode: 'DIRECT',
    passwordEncrypted: null,
    onePasswordRef: null,
    trustedHostKeyFingerprint: null,
    scope: 'GLOBAL',
    ownerId: null,
    groupId: null,
    tenantId: 1,
    pemKey: null,
    bastion: null,
    ...overrides,
  }
}

function encryptedPassword(value = 'secret'): string {
  return JSON.stringify(encrypt(value))
}

describe('GuacdGraphicalSessionAdapter', () => {
  it('performs the initial Guacamole handshake with host parameters', async () => {
    const socket = new FakeGuacdSocket()
    const adapter = new GuacdGraphicalSessionAdapter({
      host: '127.0.0.1',
      port: 4822,
      connectTimeoutMs: 100,
      createSocket: () => socket,
    })

    const result = await adapter.open({
      sessionId: 123,
      tenantId: 1,
      userId: 10,
      host: host({ passwordEncrypted: encryptedPassword() }),
      protocol: 'rdp',
      connectionMethod: 'rdp_gateway_pending',
      initialWidth: 1440,
      initialHeight: 900,
      initialDpi: 144,
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'connected',
      code: 'GRAPHICAL_GATEWAY_CONNECTED',
    }))
    expect(socket.writes).toContain('6.select,3.rdp;')
    expect(socket.writes).toContain('4.size,4.1440,3.900,3.144;')
    expect(socket.writes).toContain('5.audio;')
    expect(socket.writes).toContain('5.video;')
    expect(socket.writes).toContain('5.image,9.image/png,10.image/jpeg;')
    const connectInstruction = socket.writes.find((write) => write.startsWith('7.connect'))
    expect(connectInstruction).toContain('4.1440,3.900,3.144,4.true,3.any,5.false,2.24,4.true,14.display-update,4.true,4.true,4.true,4.true;')

    if (result.status !== 'connected') throw new Error('Expected connected result')
    const initialData = await new Promise<Buffer>((resolve) => {
      result.transport.onData(resolve)
    })
    expect(initialData.toString()).toBe('4.size,1.0,3.800,3.600;')
  })

  it('applies configurable guacd capabilities and RDP defaults', async () => {
    const socket = new FakeGuacdSocket()
    const adapter = new GuacdGraphicalSessionAdapter({
      host: '127.0.0.1',
      port: 4822,
      connectTimeoutMs: 100,
      imageMimeTypes: ['image/png'],
      enableAudioStreams: true,
      enableVideoStreams: true,
      rdpDefaults: {
        security: 'nla',
        ignoreCert: false,
        resizeMethod: 'reconnect',
        colorDepth: 16,
        forceLossless: false,
        enableFontSmoothing: false,
        disableGfx: true,
        disableBitmapCaching: true,
        disableOffscreenCaching: true,
      },
      createSocket: () => socket,
    })

    await adapter.open({
      sessionId: 123,
      tenantId: 1,
      userId: 10,
      host: host({ passwordEncrypted: encryptedPassword() }),
      protocol: 'rdp',
      connectionMethod: 'rdp_gateway_pending',
    })

    expect(socket.writes).toContain('5.audio;')
    expect(socket.writes).toContain('5.video;')
    expect(socket.writes).toContain('5.image,9.image/png;')
    const connectInstruction = socket.writes.find((write) => write.startsWith('7.connect'))
    expect(connectInstruction).toContain('5.false,3.nla,5.false,2.16,5.false,9.reconnect,5.false,4.true,4.true,4.true;')
  })

  it('keeps RDP authentication enabled for remote graphical login when credentials are missing', async () => {
    const socket = new FakeGuacdSocket()
    const adapter = new GuacdGraphicalSessionAdapter({
      host: '127.0.0.1',
      port: 4822,
      connectTimeoutMs: 100,
      createSocket: () => socket,
    })

    await adapter.open({
      sessionId: 123,
      tenantId: 1,
      userId: 10,
      host: host({ sshUser: '', passwordEncrypted: null }),
      protocol: 'rdp',
      connectionMethod: 'rdp_gateway_pending',
    })

    const connectInstruction = socket.writes.find((write) => write.startsWith('7.connect'))
    expect(connectInstruction).toContain('4.true,3.any,5.false,2.24')
  })

  it('builds VNC guacd connect arguments from host endpoint and password', async () => {
    const socket = new FakeVncGuacdSocket()
    const adapter = new GuacdGraphicalSessionAdapter({
      host: '127.0.0.1',
      port: 4822,
      connectTimeoutMs: 100,
      vncDefaults: {
        colorDepth: 24,
        readOnly: false,
        swapRedBlue: false,
        cursor: 'remote',
      },
      createSocket: () => socket,
    })

    await adapter.open({
      sessionId: 123,
      tenantId: 1,
      userId: 10,
      host: host({
        name: 'srv-vnc',
        port: 5901,
        accessProtocol: 'VNC',
        sshUser: '',
        passwordEncrypted: encryptedPassword('vnc-secret'),
      }),
      protocol: 'vnc',
      connectionMethod: 'vnc_gateway_pending',
      initialWidth: 1280,
      initialHeight: 720,
      initialDpi: 96,
    })

    expect(socket.writes).toContain('6.select,3.vnc;')
    expect(socket.writes).toContain('4.size,4.1280,3.720,2.96;')
    const connectInstruction = socket.writes.find((write) => write.startsWith('7.connect'))
    expect(connectInstruction).toContain('9.10.0.0.20,4.5901,10.vnc-secret,4.1280,3.720,2.96,2.24,5.false,5.false,6.remote;')
    expect(connectInstruction).not.toContain('security')
    expect(connectInstruction).not.toContain('ignore-cert')
    expect(connectInstruction).not.toContain('resize-method')
  })
})
