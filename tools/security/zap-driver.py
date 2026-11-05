"""Drive passive ZAP inspection inside its isolated container; export only allowlisted evidence."""
import base64
import hashlib
import hmac
import json
import re
import struct
import ssl
import urllib.error
import sys
import time
import urllib.parse
import urllib.request

API = 'http://127.0.0.1:8080/JSON/'
TARGET = 'https://web'
REQUESTS = []
PHASE = "startup"
PROXY = None

def api(section, method, params=None):
    data = urllib.parse.urlencode(params or {}).encode()
    req = urllib.request.Request(API + section + '/' + method + '/', data=data)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def configure_proxy():
    global PROXY
    with urllib.request.urlopen('http://127.0.0.1:8080/OTHER/core/other/rootcert/', timeout=10) as response:
        ca = response.read().decode('ascii')
    context = ssl.create_default_context(cadata=ca)
    PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({'https': 'http://127.0.0.1:8080'}),
                                        urllib.request.HTTPSHandler(context=context), NoRedirect())

def proxy_request(method, path, payload, headers):
    req = urllib.request.Request(TARGET + path, data=payload, headers=headers, method=method)
    try:
        response = PROXY.open(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.getcode(), response.read().decode('utf-8', errors='replace')

def request(name, path, expected, method='GET', body=None, token=None):
    global PHASE
    PHASE = name
    if not path.startswith('/') or path.startswith('//') or '?' in path or '\r' in path or '\n' in path:
        raise RuntimeError('Unsafe path')
    payload = None if body is None else json.dumps(body).encode()
    headers = {'Connection': 'close'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if body is not None:
        headers['Content-Type'] = 'application/json'
    status, text = proxy_request(method, path, payload, headers)
    REQUESTS.append({'name': name, 'path': path, 'method': method, 'status': status, 'passed': status == expected})
    if status != expected:
        raise RuntimeError('Unexpected HTTP status in scenario ' + name + ': ' + str(status))
    return text

def totp(secret):
    # RFC 6238 interoperability with the real backend's default TOTP algorithm.
    # This HMAC authenticates an ephemeral lab account; it is not password hashing
    # or a digital signature. Keep the scanner finding subject to explicit review.
    key = base64.b32decode(secret + '=' * ((8 - len(secret) % 8) % 8))
    digest = hmac.new(key, struct.pack('>Q', int(time.time()) // 30), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return str((struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000).zfill(6)

def main():
    fixture = json.load(sys.stdin)
    deadline = time.monotonic() + 120
    while True:
        try:
            version = api('core/view', 'version')['version']
            break
        except (OSError, KeyError):
            if time.monotonic() >= deadline:
                raise RuntimeError('ZAP readiness deadline') from None
            time.sleep(1)
    api('core/action', 'setMode', {'mode': 'safe'})
    api('pscan/action', 'setScanOnlyInScope', {'onlyInScope': 'false'})
    enabled_rules = sum(rule.get('enabled') in [True, 'true'] for rule in api('pscan/view', 'scanners')['scanners'])
    if not enabled_rules:
        raise RuntimeError('No passive rules enabled')
    configure_proxy()
    page = request('login-page', '/login', 200)
    for label, pattern in [('javascript', r'src="(/assets/[^"/]+\.js)"'), ('stylesheet', r'href="(/assets/[^"/]+\.css)"')]:
        match = re.search(pattern, page)
        if not match:
            raise RuntimeError('Frontend asset missing: ' + label)
        request(label, match.group(1), 200)
    request('ready', '/health/ready', 200)
    request('anonymous-hosts', '/api/v1/hosts', 401)
    request('invalid-login', '/api/v1/auth/login', 400, 'POST', {'email': 'invalid', 'password': fixture['password'], 'tenantSlug': fixture['slug']})
    login = json.loads(request('login', '/api/v1/auth/login', 200, 'POST', {'email': fixture['email'], 'password': fixture['password'], 'tenantSlug': fixture['slug']}))
    if login.get('requiresMfaSetup') is not False or not login.get('tempToken'):
        raise RuntimeError('Expected real MFA challenge')
    tokens = json.loads(request('mfa', '/api/v1/auth/verify-totp', 200, 'POST', {'setupToken': login['tempToken'], 'token': totp(fixture['mfaSecret'])}))
    request('authenticated-hosts', '/api/v1/hosts', 200, token=tokens['accessToken'])
    refreshed = json.loads(request('refresh', '/api/v1/auth/refresh', 200, 'POST', {'refreshToken': tokens['refreshToken']}))
    if not refreshed.get('accessToken'):
        raise RuntimeError('Refresh did not issue an access token')
    request('logout', '/api/v1/auth/logout', 204, 'POST', {'refreshToken': tokens['refreshToken']})
    request('revoked-refresh', '/api/v1/auth/refresh', 401, 'POST', {'refreshToken': tokens['refreshToken']})
    deadline = time.monotonic() + 180
    while int(api('pscan/view', 'recordsToScan')['recordsToScan']):
        if time.monotonic() >= deadline:
            raise RuntimeError('Passive scan deadline')
        time.sleep(1)
    raw = api('core/view', 'alerts', {'baseurl': TARGET, 'start': 0, 'count': 10000})['alerts']
    grouped = {}
    for alert in raw:
        url = urllib.parse.urlsplit(alert['url'])
        if url.scheme != 'https' or url.netloc != 'web' or url.query or url.fragment:
            raise RuntimeError('Unexpected inspected origin')
        key = (alert.get('alertRef', alert['pluginId']), {'Informational': 0, 'Low': 1, 'Medium': 2, 'High': 3}[alert['risk']])
        grouped.setdefault(key, set()).add(url.path or '/')
    messages = int(api('core/view', 'numberOfMessages', {'baseurl': TARGET})['numberOfMessages'])
    print(json.dumps({'schemaVersion': 1, 'mode': 'passive', 'target': TARGET, 'version': version,
                     'messages': messages, 'enabledRules': enabled_rules, 'queueRemaining': 0, 'requests': REQUESTS,
                     'alerts': [{'rule': rule, 'risk': risk, 'paths': sorted(paths)} for (rule, risk), paths in sorted(grouped.items())]}))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # HTTP/library exception text can contain requests or credentials; never print it.
        print(json.dumps({'failed': True, 'category': type(error).__name__, 'phase': PHASE}), file=sys.stderr)
        sys.exit(1)
