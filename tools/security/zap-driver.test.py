import contextlib
import importlib.util
import io
import json
import os
import dis
import hashlib
import types
import trace
import xml.etree.ElementTree as ET
import pathlib
import unittest
import runpy
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('zap_driver', pathlib.Path(__file__).with_name('zap-driver.py'))
module = importlib.util.module_from_spec(spec)
coverage_enabled = os.environ.get('NODEACCESS_ZAP_PYTHON_COVERAGE') == 'true'
tracer = trace.Trace(count=True, trace=False) if coverage_enabled else None
if tracer:
    tracer.runfunc(spec.loader.exec_module, module)
else:
    spec.loader.exec_module(module)
FIXTURE = {'email': 'test@example.invalid', 'password': 'private-password', 'slug': 'lab', 'mfaSecret': 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'}

class DriverTest(unittest.TestCase):
    def setUp(self):
        module.REQUESTS.clear()

    def test_proxy_trusts_ephemeral_zap_ca_and_disables_redirects(self):
        context = object()
        with patch.object(module.urllib.request, 'urlopen', return_value=io.BytesIO(b'fixture-ca')), patch.object(module.ssl, 'create_default_context', return_value=context) as ssl_context, patch.object(module.urllib.request, 'build_opener', return_value='owned-proxy'):
            module.configure_proxy()
        ssl_context.assert_called_once_with(cadata='fixture-ca')
        self.assertEqual(module.PROXY, 'owned-proxy')
        self.assertIsNone(module.NoRedirect().redirect_request(None, None, 302, None, None, 'https://outside'))

    def test_proxy_records_expected_http_errors_without_following_them(self):
        from unittest.mock import Mock
        response = module.urllib.error.HTTPError('https://web/api/v1/hosts', 401, 'Denied', {}, io.BytesIO(b'{}'))
        proxy = Mock()
        proxy.open.side_effect = response
        with patch.object(module, 'PROXY', proxy):
            self.assertEqual(module.proxy_request('GET', '/api/v1/hosts', None, {}), (401, '{}'))
        self.assertEqual(proxy.open.call_args[0][0].full_url, 'https://web/api/v1/hosts')

    def test_totp_rfc_vectors(self):
        # RFC 6238 Appendix B SHA1 vectors truncated to the backend's six digits.
        vectors = [(59, '287082'), (1111111109, '081804'), (1111111111, '050471'),
                   (1234567890, '005924'), (2000000000, '279037'), (20000000000, '353130')]
        for timestamp, expected in vectors:
            with self.subTest(timestamp=timestamp), patch.object(module.time, 'time', return_value=timestamp):
                self.assertEqual(module.totp(FIXTURE['mfaSecret']), expected)

    def test_http_api_encodes_request_and_has_timeout(self):
        def urlopen(req, timeout):
            self.assertEqual(timeout, 30)
            self.assertEqual(req.full_url, 'http://127.0.0.1:8080/JSON/core/view/version/')
            self.assertEqual(req.data, b'field=a%26b')
            return io.BytesIO(b'{"version":"2.17.0"}')
        with patch.object(module.urllib.request, 'urlopen', side_effect=urlopen):
            self.assertEqual(module.api('core/view', 'version', {'field': 'a&b'}), {'version': '2.17.0'})

    def test_request_builds_authenticated_http_and_does_not_export_credentials(self):
        def transport(method, path, payload, headers):
            self.assertEqual((method, path), ('POST', '/api/v1/auth/login'))
            self.assertEqual(headers['Authorization'], 'Bearer private-token')
            self.assertEqual(headers['Content-Type'], 'application/json')
            self.assertEqual(json.loads(payload), {'value': 'private-password'})
            return 200, '{}'
        with patch.object(module, 'proxy_request', side_effect=transport):
            self.assertEqual(module.request('login', '/api/v1/auth/login', 200, 'POST', {'value': 'private-password'}, 'private-token'), '{}')
        self.assertNotIn('private-', json.dumps(module.REQUESTS))

    def test_request_rejects_unsafe_targets(self):
        for path in ['//outside', 'https://outside', '/login?token=secret', '/login\r\nHost:outside']:
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                module.request('login', path, 200)

    def test_unexpected_status_fails(self):
        with patch.object(module, 'proxy_request', return_value=(500, 'private')), self.assertRaises(RuntimeError):
            module.request('ready', '/health/ready', 200)
        self.assertFalse(module.REQUESTS[0]['passed'])

    def fake_api(self, section, method, params=None):
        if method == 'version':
            return {'version': '2.17.0'}
        if method == 'setScanOnlyInScope':
            return {}
        if method == 'scanners':
            return {'scanners': [{'enabled': 'true'}, {'enabled': False}]}
        if method == 'setMode':
            self.assertEqual(params, {'mode': 'safe'})
            return {}
        if method == 'recordsToScan':
            return {'recordsToScan': '0'}
        if method == 'alerts':
            return {'alerts': [{'url': 'https://web/login', 'alertRef': '10020-1', 'pluginId': '10020', 'risk': 'Low', 'evidence': 'private-data'}]}
        if method == 'numberOfMessages':
            return {'numberOfMessages': '12'}
        raw = params['request']
        path = raw.split(' ')[1][len('https://web'):]
        payload = raw.partition('\r\n\r\n')[2]
        data = json.loads(payload) if payload else {}
        status, body = 200, '{}'
        if path == '/login':
            body = '<script src="/assets/main.js"></script><link href="/assets/main.css">'
        elif path == '/api/v1/hosts':
            status = 200 if 'Authorization: Bearer ' in raw else 401
        elif path == '/api/v1/auth/login':
            if data['email'] == 'invalid':
                status = 400
            else:
                body = json.dumps({'requiresMfaSetup': False, 'tempToken': 'private-setup'})
        elif path == '/api/v1/auth/verify-totp':
            body = json.dumps({'accessToken': 'private-access', 'refreshToken': 'private-revoked'})
        elif path == '/api/v1/auth/refresh':
            if any(r['name'] == 'logout' for r in module.REQUESTS):
                status = 401
            else:
                body = json.dumps({'accessToken': 'private-refreshed-access'})
        elif path == '/api/v1/auth/logout':
            status = 204
        return {'sendRequest': [{'responseHeader': 'HTTP/1.1 ' + str(status) + ' Result', 'responseBody': body}]}

    def run_main(self, api):
        output = io.StringIO()
        def transport(method, path, payload, headers):
            raw = method + ' https://web' + path + ' HTTP/1.1\r\n' + '\r\n'.join(key + ': ' + value for key, value in headers.items()) + '\r\n\r\n' + (payload.decode() if payload else '')
            message = api('core/action', 'sendRequest', {'request': raw})['sendRequest'][0]
            return int(message['responseHeader'].split(' ')[1]), message['responseBody']
        with patch.object(module, 'api', side_effect=api), patch.object(module, 'configure_proxy'), patch.object(module, 'proxy_request', side_effect=transport), patch.object(module.sys, 'stdin', io.StringIO(json.dumps(FIXTURE))), contextlib.redirect_stdout(output):
            module.main()
        return json.loads(output.getvalue())

    def test_main_authentication_sequence_and_sanitization(self):
        result = self.run_main(self.fake_api)
        self.assertEqual(len(result['requests']), 12)
        self.assertEqual(result['alerts'], [{'rule': '10020-1', 'risk': 1, 'paths': ['/login']}])
        self.assertEqual(result['queueRemaining'], 0)
        self.assertNotIn('private-', json.dumps(result))

    def test_asset_missing_fails(self):
        def api(section, method, params=None):
            result = self.fake_api(section, method, params)
            if method == 'sendRequest' and 'https://web/login ' in params['request']:
                result['sendRequest'][0]['responseBody'] = '<html></html>'
            return result
        with self.assertRaisesRegex(RuntimeError, 'asset missing'):
            self.run_main(api)

    def test_unexpected_mfa_state_fails(self):
        def api(section, method, params=None):
            result = self.fake_api(section, method, params)
            if method == 'sendRequest' and 'https://web/api/v1/auth/login ' in params['request'] and json.loads(params['request'].partition('\r\n\r\n')[2])['email'] != 'invalid':
                result['sendRequest'][0]['responseBody'] = '{}'
            return result
        with self.assertRaisesRegex(RuntimeError, 'MFA challenge'):
            self.run_main(api)

    def test_foreign_report_url_is_not_exported(self):
        def api(section, method, params=None):
            if method == 'alerts':
                return {'alerts': [{'url': 'https://external.invalid/?secret=value'}]}
            return self.fake_api(section, method, params)
        with self.assertRaisesRegex(RuntimeError, 'origin'):
            self.run_main(api)

    def test_startup_deadline(self):
        with patch.object(module.time, 'monotonic', side_effect=[0, 121]), self.assertRaisesRegex(RuntimeError, 'readiness deadline'):
            self.run_main(lambda *_: (_ for _ in ()).throw(OSError('unavailable')))

    def test_disabled_passive_rules_fail(self):
        def api(section, method, params=None):
            return {'scanners': [{'enabled': False}]} if method == 'scanners' else self.fake_api(section, method, params)
        with self.assertRaisesRegex(RuntimeError, 'No passive rules'):
            self.run_main(api)

    def test_startup_and_passive_queue_recover_within_budget(self):
        attempts = {'version': 0, 'recordsToScan': 0}
        def api(section, method, params=None):
            if method in attempts:
                attempts[method] += 1
                if attempts[method] == 1:
                    if method == 'version':
                        raise OSError('starting')
                    return {'recordsToScan': '1'}
            return self.fake_api(section, method, params)
        with patch.object(module.time, 'sleep') as sleep:
            result = self.run_main(api)
        self.assertEqual(result['messages'], 12)
        self.assertEqual(sleep.call_count, 2)

    def test_cli_failure_only_exports_category_and_fixed_phase(self):
        output = io.StringIO()
        with patch.object(module.sys, 'stdin', io.StringIO('private-invalid-fixture')), contextlib.redirect_stderr(output), self.assertRaises(SystemExit) as error:
            runpy.run_path(module.__file__, run_name='__main__')
        self.assertEqual(error.exception.code, 1)
        self.assertEqual(json.loads(output.getvalue()), {'failed': True, 'category': 'JSONDecodeError', 'phase': 'startup'})

    def test_queue_deadline(self):
        def api(section, method, params=None):
            return {'recordsToScan': '1'} if method == 'recordsToScan' else self.fake_api(section, method, params)
        with patch.object(module.time, 'monotonic', side_effect=[0, 1, 182]), self.assertRaisesRegex(RuntimeError, 'Passive scan deadline'):
            self.run_main(api)

def write_coverage(result):
    source = pathlib.Path(module.__file__).resolve()
    data = source.read_bytes()
    lines = set()
    def visit(code):
        lines.update(line for _, line in dis.findlinestarts(code) if line > 0)
        for value in code.co_consts:
            if isinstance(value, types.CodeType):
                visit(value)
    visit(compile(data, str(source), 'exec'))
    counts = tracer.results().counts
    hits = {line: counts.get((str(source), line), 0) for line in sorted(lines)}
    root = ET.Element('coverage', {'version': 'nodeaccess-trace', 'lines-valid': str(len(lines)), 'lines-covered': str(sum(value > 0 for value in hits.values()))})
    sources = ET.SubElement(root, 'sources')
    ET.SubElement(sources, 'source').text = str(source.parents[2])
    packages = ET.SubElement(root, 'packages')
    classes = ET.SubElement(ET.SubElement(packages, 'package', {'name': 'zap'}), 'classes')
    klass = ET.SubElement(classes, 'class', {'name': 'zap-driver', 'filename': 'tools/security/zap-driver.py'})
    entries = ET.SubElement(klass, 'lines')
    for line, count in hits.items():
        ET.SubElement(entries, 'line', {'number': str(line), 'hits': str(count)})
    output = source.parents[2] / 'coverage'
    output.mkdir(exist_ok=True)
    report = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    (output / 'zap-python.xml').write_bytes(report)
    proof = {'runId': os.environ.get('NODEACCESS_ZAP_PYTHON_RUN_ID'), 'driverSha256': hashlib.sha256(data).hexdigest(), 'reportSha256': hashlib.sha256(report).hexdigest(), 'passed': result.wasSuccessful(), 'testsRun': result.testsRun, 'executedLines': sum(value > 0 for value in hits.values()), 'totalLines': len(lines), 'helperSha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
    (output / 'zap-python-proof.json').write_text(json.dumps(proof, indent=2) + '\n')

if __name__ == '__main__':
    if tracer:
        program = tracer.runfunc(unittest.main, exit=False)
        write_coverage(program.result)
        raise SystemExit(0 if program.result.wasSuccessful() else 1)
    unittest.main()
