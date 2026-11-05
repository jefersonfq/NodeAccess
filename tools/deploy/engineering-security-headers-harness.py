"""Real Nginx profiles, private disposable containers; never contacts production."""
from pathlib import Path
import subprocess, tempfile, json, ssl, time, urllib.request, urllib.error, os, re
root=Path.cwd(); results=[]
def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout
with tempfile.TemporaryDirectory(prefix='nodeaccess-header-lab-',dir='/tmp') as temp:
    lab=Path(temp); lab.chmod(0o755); (lab/'html/assets').mkdir(parents=True) # Disposable public fixtures; TLS key remains 0600.
    (lab/'html/index.html').write_text('<!doctype html><meta property="csp-nonce" nonce="__NODEACCESS_CSP_NONCE__"><title>Disposable test</title>')
    (lab/'html/assets/test.js').write_text('console.log("lab")')
    run(['openssl','req','-x509','-nodes','-newkey','rsa:2048','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-days','1','-keyout',str(lab/'privkey.pem'),'-out',str(lab/'fullchain.pem')])
    key=lab/'privkey.pem'
    assert key.is_file() and not key.is_symlink(), 'TLS fixture key must be a regular owned file'
    assert key.stat().st_uid == os.geteuid() and key.stat().st_mode & 0o777 == 0o600, 'TLS fixture key must remain owner-only'
    (lab/'document.js').write_text((root/'docker/csp/document.js').read_text().replace('/usr/share/nginx/html', '/lab/html'))
    tls_context=ssl.create_default_context(cafile=str(lab/'fullchain.pem'))
    for index, profile in enumerate(['http','https','prod','k8s']):
        filename='docker/nginx.k8s.conf.template' if profile=='k8s' else f'docker/nginx.{profile}.conf'
        config=(root/filename).read_text().replace('/usr/share/nginx/html','/lab/html').replace('/etc/nginx/certs','/lab')
        config=config.replace('api:3000','127.0.0.1:9').replace('ssh-gateway:3001','127.0.0.1:9').replace('${API_UPSTREAM}','127.0.0.1:9').replace('${GATEWAY_UPSTREAM}','127.0.0.1:9')
        if profile in ['prod','k8s']: config='load_module /usr/lib/nginx/modules/ngx_http_js_module.so;\nevents {}\nhttp {\n'+config+'\n}'
        config=config.replace('/etc/nginx/csp/document.js','/lab/document.js')
        (lab/'nginx.conf').write_text(config)
        name=f'nodeaccess-headers-{profile}'; port=18445+index
        internal='8080' if profile=='k8s' else '80' if profile=='http' else '443'
        run(['docker','run','-d','--name',name,'-p',f'127.0.0.1:{port}:{internal}','-v',f'{temp}:/lab:ro','--entrypoint','nginx','nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951','-c','/lab/nginx.conf','-g','daemon off;'])
        try:
            scheme='https' if profile in ['https','prod'] else 'http'
            def request(path):
                try: return urllib.request.urlopen(f'{scheme}://127.0.0.1:{port}{path}',context=tls_context,timeout=3)
                except urllib.error.HTTPError as error: return error
            for attempt in range(30):
                try: response=request('/'); break
                except (urllib.error.URLError, ConnectionError): time.sleep(.2)
            else: raise RuntimeError(run(['docker','logs',name]))
            for path in ['/','/index.html','/assets/test.js','/assets/missing.js','/api/v1/fixture','/health/ready']:
                response=request(path); headers=response.headers; response.close()
                for required in ['X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Content-Security-Policy']:
                    assert required in headers, (profile,path,required)
                assert "'unsafe-eval'" not in headers['Content-Security-Policy'], (profile,path,'eval allowed')
                assert "script-src 'self';" in headers['Content-Security-Policy']
                assert "style-src 'self' 'unsafe-inline'" not in headers['Content-Security-Policy']
                if path in ['/', '/index.html']:
                    assert response.status == 200
                    assert re.search(r"'nonce-[A-Za-z0-9+/]{43}='", headers['Content-Security-Policy'])
                    assert 'no-store' in headers['Cache-Control']
                else: assert 'nonce-' not in headers['Content-Security-Policy']
                if scheme=='https': assert 'Strict-Transport-Security' in headers, (profile,path,'HSTS')
                results.append({'profile':profile,'path':path,'status':response.status,'securityHeaders':True})
            # Exercise the real njs error branch, not only its unit contract.
            template=(lab/'html/index.html').read_text()
            (lab/'html/index.html').write_text('<html>broken build without nonce placeholder</html>')
            response=request('/index.html')
            assert response.status == 503, (profile,'invalid document did not fail closed')
            assert b'<html' not in response.read()
            assert 'nonce-' not in response.headers['Content-Security-Policy']
            response.close()
            (lab/'html/index.html').write_text(template)
            results.append({'profile':profile,'path':'/index.html','status':503,'failClosed':True})
            response=request('/api/v1/web-access/proxy?token=disposable')
            assert 'Content-Security-Policy' not in response.headers, (profile,'remote proxy inherited app policy')
            assert response.headers['X-Content-Type-Options']=='nosniff'
            response.close()
            response=request('/api/v1/web-access/proxy-unrelated')
            assert 'Content-Security-Policy' in response.headers, (profile,'proxy exemption too broad')
            response.close()
            marker='nodeaccess-secret-log-fixture'
            response=request('/ws/security-test?token='+marker); response.close()
            logs=run(['docker','logs',name])
            # docker captures stdout and stderr independently. Neither may contain a token.
            combined=subprocess.run(['docker','logs',name],capture_output=True,text=True,check=True)
            assert marker not in combined.stdout+combined.stderr, (profile,'token in proxy logs')
        finally: run(['docker','rm','-f',name])
# Keep the persistent report in a private, owned per-worktree directory, shared with JS harnesses.
artifact_root=Path(tempfile.gettempdir()) / ('nodeaccess-harness-'+str(os.getuid())+'-'+__import__('hashlib').sha256(str(root).encode()).hexdigest()[:12])
try: artifact_root.mkdir(mode=0o700)
except FileExistsError: pass
metadata=artifact_root.lstat()
if artifact_root.is_symlink() or not artifact_root.is_dir() or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
    raise RuntimeError('Artifact root must be owned and private')
output=Path(os.environ.get('NGINX_EVIDENCE_PATH', str(artifact_root/'nodeaccess-nginx-headers.json')))
if output.is_symlink(): raise RuntimeError('Artifact report must not be a symlink')
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps({'success':True,'cases':results},indent=2)); print(f'{len(results)} real Nginx response checks passed')
