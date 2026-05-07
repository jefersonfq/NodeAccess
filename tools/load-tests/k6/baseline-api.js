import http from 'k6/http'
import { check, group, sleep } from 'k6'
import { Trend } from 'k6/metrics'

const profile = JSON.parse(open(__ENV.PROFILE_FILE || '../data/profile.example.json'))
const users = Array.isArray(profile.users) ? profile.users : []
const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '')
const includeAdmin = __ENV.API_INCLUDE_ADMIN === '1'

const loginLatency = new Trend('nodeaccess_login_ms')
const hostsLatency = new Trend('nodeaccess_hosts_ms')
const dashboardLatency = new Trend('nodeaccess_dashboard_ms')
const auditLatency = new Trend('nodeaccess_audit_ms')

export const options = {
  scenarios: {
    api_baseline: {
      executor: 'constant-vus',
      vus: Number(__ENV.API_VUS || 5),
      duration: __ENV.API_DURATION || '2m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
    nodeaccess_hosts_ms: ['p(95)<800'],
    nodeaccess_dashboard_ms: ['p(95)<1000'],
  },
}

function pickUser() {
  if (users.length === 0) {
    throw new Error('No users configured in load-test profile')
  }
  return users[(__VU - 1) % users.length]
}

function jsonHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }
}

function authenticate(user) {
  if (user.accessToken && !String(user.accessToken).startsWith('paste-')) {
    return user.accessToken
  }

  if (!user.email || !user.password) {
    throw new Error(`User ${user.name || __VU} must define accessToken or email/password`)
  }

  const loginStarted = Date.now()
  const loginRes = http.post(
    `${baseUrl}/auth/login`,
    JSON.stringify({ email: user.email, password: user.password }),
    jsonHeaders(),
  )
  loginLatency.add(Date.now() - loginStarted)

  check(loginRes, {
    'login accepted': (res) => res.status === 200,
    'login returned temp token': (res) => Boolean(res.json('tempToken')),
  })

  const tempToken = loginRes.json('tempToken')
  if (!tempToken) return null

  if (!user.totpCode) {
    throw new Error(`User ${user.email} requires MFA verification; define accessToken or totpCode`)
  }

  const verifyRes = http.post(
    `${baseUrl}/auth/verify-totp`,
    JSON.stringify({ token: String(user.totpCode), setupToken: tempToken }),
    jsonHeaders(),
  )

  check(verifyRes, {
    'totp accepted': (res) => res.status === 200,
    'totp returned access token': (res) => Boolean(res.json('accessToken')),
  })

  return verifyRes.json('accessToken')
}

function timedGet(url, params, metric, checks) {
  const started = Date.now()
  const res = http.get(url, params)
  metric.add(Date.now() - started)
  check(res, checks)
  return res
}

export default function () {
  const user = pickUser()
  const token = authenticate(user)
  if (!token) return

  const params = jsonHeaders(token)

  group('hosts', () => {
    timedGet(`${baseUrl}/hosts?page=1&limit=20`, params, hostsLatency, {
      'hosts ok': (res) => res.status === 200,
    })
  })

  group('user dashboard', () => {
    timedGet(`${baseUrl}/user-dashboard/summary`, params, dashboardLatency, {
      'user dashboard ok': (res) => res.status === 200,
    })
  })

  if (includeAdmin) {
    group('admin dashboard', () => {
      timedGet(`${baseUrl}/dashboard/stats?periodDays=30`, params, dashboardLatency, {
        'admin dashboard ok or forbidden': (res) => res.status === 200 || res.status === 403,
      })
    })

    group('session audit', () => {
      timedGet(`${baseUrl}/session-audit?page=1&limit=20`, params, auditLatency, {
        'session audit ok or forbidden': (res) => res.status === 200 || res.status === 403,
      })
    })
  }

  sleep(Math.random() * 2 + 1)
}
