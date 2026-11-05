function harnessEndpoint(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('Harness frontend must be an absolute HTTPS URL or HTTP loopback URL') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Harness frontend must use HTTPS outside loopback and contain no credentials, path or query')
  }
  return url.origin
}
module.exports = { harnessEndpoint }
