'use strict'
function connectionOptions(server, token, options = {}) {
 const url = new URL(server.replace(/^http/, 'ws'))
 if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error('Invalid agent server URL')
 if ((url.protocol !== 'wss:' || options.insecure) && !options.development) throw Error('WSS with certificate validation is required; insecure transport is restricted to explicit development mode')
 if (typeof token !== 'string' || !token || token.length > 4096 || /[\r\n]/.test(token)) throw Error('Invalid credential')
 return { server: url.origin.replace(/^http/, 'ws'), ws: { headers: { Authorization: `Bearer ${token}` }, rejectUnauthorized: !options.insecure, handshakeTimeout: 10000, maxPayload: 262144, ...(options.ca ? { ca: options.ca } : {}) } }
}
module.exports = { connectionOptions }
