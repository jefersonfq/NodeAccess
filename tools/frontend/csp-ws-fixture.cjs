// Disposable CI fixture only; no host port is published by the workflow.
if (process.env.RUN_CSP_WS_FIXTURE !== 'true') throw new Error('Opt in with RUN_CSP_WS_FIXTURE=true')
const { WebSocketServer } = require('ws')
const server = new WebSocketServer({ port: 3001, path: '/ws/csp-probe', maxPayload: 1024 })
server.on('connection', socket => socket.on('message', (data, binary) => socket.send(data, { binary })))
process.on('SIGTERM', () => { for (const socket of server.clients) socket.terminate(); server.close(() => process.exit(0)) })
