'use strict'
const net = require('node:net')
const dns = require('node:dns').promises
const fs = require('node:fs')
function compilePolicy(document) {
  if (!document || document.version !== 1 || !Array.isArray(document.rules) || document.rules.length > 256) throw Error('Invalid local policy')
  const localPorts = document.localPorts ?? []
  const validPort = p => Number.isInteger(p) && p >= 1 && p <= 65535
  if (!Array.isArray(localPorts) || localPorts.length > 256 || !localPorts.every(p => validPort(p) && p >= 1024)) throw Error('Invalid local ports')
  const rules = document.rules.map(rule => {
    if (!rule || typeof rule.cidr !== 'string' || !Array.isArray(rule.ports) || !rule.ports.length || rule.ports.length > 256 || !rule.ports.every(validPort)) throw Error('Every rule requires CIDR and explicit ports')
    const parts = rule.cidr.split('/'), family = net.isIP(parts[0]), prefix = Number(parts[1])
    if (parts.length !== 2 || !family || !/^\d+$/.test(parts[1]) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) throw Error('Invalid policy CIDR')
    if (rule.hostname !== undefined && (typeof rule.hostname !== 'string' || !rule.hostname || /[\s/*]/.test(rule.hostname))) throw Error('Invalid policy hostname')
    const block = new net.BlockList(); block.addSubnet(parts[0], prefix, family === 4 ? 'ipv4' : 'ipv6')
    return { block, family, ports: rule.ports, hostname: rule.hostname?.toLowerCase() }
  })
  return {
    mode: 'local_restriction',
    allowLocalPort: port => localPorts.includes(port),
    async resolve(host, port, lookup = dns.lookup) {
      if (typeof host !== 'string' || !host || host.length > 253 || !validPort(port) || /[\s/%]/.test(host)) throw Error('Invalid target')
      const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true, verbatim: true })
      if (!addresses.length || addresses.length > 64 || addresses.some(a => !rules.some(r => r.ports.includes(port) && (!r.hostname || r.hostname === host.toLowerCase()) && r.family === a.family && r.block.check(a.address, a.family === 4 ? 'ipv4' : 'ipv6')))) throw Error('Target denied by local access policy')
      // Connect to this validated address, without a second DNS lookup.
      return addresses[0]
    },
  }
}
function loadPolicy(path) {
  if (!path) return {
    mode: 'managed_acl',
    allowLocalPort: port => Number.isInteger(port) && port >= 1024 && port <= 65535,
    async resolve(host, port, lookup = dns.lookup) {
      if (typeof host !== 'string' || !host || host.length > 253 || /[\s/%]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid target')
      const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true, verbatim: true })
      if (!addresses.length || addresses.length > 64 || addresses.some(a => !net.isIP(a.address) || net.isIP(a.address) !== a.family)) throw Error('Invalid DNS response')
      return addresses[0]
    },
  }
  const stat = fs.lstatSync(path)
  if (!stat.isFile() || stat.size > 65536 || (process.platform !== 'win32' && (stat.mode & 0o022))) throw Error('Local policy must be a protected regular file (not writable by group/others)')
  return compilePolicy(JSON.parse(fs.readFileSync(path, 'utf8')))
}
module.exports = { compilePolicy, loadPolicy }
