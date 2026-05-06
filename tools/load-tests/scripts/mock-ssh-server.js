#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { Server } = require('ssh2')

const args = process.argv.slice(2)

function argValue(name, fallback) {
  const index = args.indexOf(name)
  if (index >= 0 && args[index + 1]) return args[index + 1]
  return fallback
}

const host = argValue('--host', process.env.MOCK_SSH_HOST || '127.0.0.1')
const port = Number(argValue('--port', process.env.MOCK_SSH_PORT || '2222'))
const username = process.env.MOCK_SSH_USER || 'loadtest'
const password = process.env.MOCK_SSH_PASSWORD || 'loadtest'
const keyPath = path.resolve(process.cwd(), argValue('--key', 'tools/load-tests/data/mock-ssh-host-key'))

function ensureHostKey() {
  if (fs.existsSync(keyPath)) return
  fs.mkdirSync(path.dirname(keyPath), { recursive: true })
  const result = spawnSync('ssh-keygen', ['-t', 'rsa', '-b', '2048', '-N', '', '-f', keyPath], {
    stdio: 'ignore',
  })
  if (result.status !== 0) {
    throw new Error('Failed to generate mock SSH host key with ssh-keygen')
  }
}

function commandOutput(command) {
  const trimmed = command.trim()
  if (!trimmed) return ''
  const burstMatch = trimmed.match(/^burst(?:\s+(\d+))?(?:\s+(\d+))?$/)
  if (burstMatch) {
    const lines = Math.min(Math.max(Number(burstMatch[1] || 400), 1), 5000)
    const width = Math.min(Math.max(Number(burstMatch[2] || 80), 16), 512)
    const payload = 'x'.repeat(width)
    let output = ''
    for (let index = 1; index <= lines; index += 1) {
      output += `${String(index).padStart(5, '0')} ${payload}\r\n`
    }
    return output
  }
  if (trimmed === 'whoami') return `${username}\r\n`
  if (trimmed === 'pwd') return '/home/loadtest\r\n'
  if (trimmed === 'uptime') return ' 10:00:00 up 1 day,  1 user,  load average: 0.10, 0.08, 0.05\r\n'
  if (trimmed === 'hostname') return 'nodeaccess-mock-ssh\r\n'
  if (trimmed === 'df -h /') return 'Filesystem      Size  Used Avail Use% Mounted on\r\nmockfs           20G  2.0G   18G  10% /\r\n'
  if (trimmed === 'exit' || trimmed === 'logout') return null
  return `mock: ${trimmed}\r\n`
}

ensureHostKey()

const server = new Server({ hostKeys: [fs.readFileSync(keyPath)] }, (client) => {
  client.on('authentication', (ctx) => {
    if (ctx.method === 'password' && ctx.username === username && ctx.password === password) {
      ctx.accept()
      return
    }
    ctx.reject()
  })

  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept()
      session.on('pty', (acceptPty) => acceptPty && acceptPty())
      session.on('shell', (acceptShell) => {
        const stream = acceptShell()
        let buffer = ''
        stream.write('Welcome to NodeAccess mock SSH\r\n$ ')

        stream.on('data', (chunk) => {
          const text = chunk.toString('utf8')
          for (const char of text) {
            if (char === '\u0003') {
              buffer = ''
              stream.write('^C\r\n$ ')
              continue
            }
            if (char === '\r' || char === '\n') {
              const command = buffer
              buffer = ''
              stream.write('\r\n')
              const output = commandOutput(command)
              if (output === null) {
                stream.end('logout\r\n')
                return
              }
              stream.write(output)
              stream.write('$ ')
              continue
            }
            if (char === '\u007f') {
              buffer = buffer.slice(0, -1)
              continue
            }
            buffer += char
          }
        })
      })
    })
  })
})

server.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

server.listen(port, host, () => {
  console.log(`Mock SSH listening on ${host}:${port}`)
  console.log(`Credentials: ${username}/${password}`)
  console.log(`Host key: ${keyPath}`)
})
