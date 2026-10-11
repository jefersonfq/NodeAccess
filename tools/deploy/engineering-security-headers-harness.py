"""Real Nginx profiles, private disposable containers; never contacts production."""
from pathlib import Path
import subprocess, tempfile, json, ssl, time, urllib.request, urllib.error, os
root=Path.cwd(); results=[]
def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout
with tempfile.TemporaryDirectory(prefix='nodeaccess-header-lab-',dir='/tmp') as temp:
    lab=Path(temp); (lab/'html/assets').mkdir(parents=True)
    (lab/'html/index.html').write_text('<!doctype html><title>Disposable test</title>')
    (lab/'html/assets/test.js').write_text('console.log("lab")')
    run(['openssl','req','-x509','-nodes','-newkey','rsa:2048','-subj','/CN=localhost','-days','1','-keyout',str(lab/'privkey.pem'),'-out',str(lab/'fullchain.pem')])
    for index, profile in enumerate(['http','https','prod','k8s']):
        filename='docker/nginx.k8s.conf.template' if profile=='k8s' else f'docker/nginx.{profile}.conf'
        config=(root/filename).read_text().replace('/usr/share/nginx/html','/lab/html').replace('/etc/nginx/certs','/lab')
        config=config.replace('api:3000','127.0.0.1:9').replace('ssh-gateway:3001','127.0.0.1:9').replace('${API_UPSTREAM}','127.0.0.1:9').replace('${GATEWAY_UPSTREAM}','127.0.0.1:9')
        if profile in ['prod','k8s']: config='events {}\nhttp {\n'+config+'\n}'
        (lab/'nginx.conf').write_text(config)
        name=f'nodeaccess-headers-{profile}'; port=18445+index
        internal='8080' if profile=='k8s' else '80' if profile=='http' else '443'
        run(['docker','run','-d','--name',name,'-p',f'127.0.0.1:{port}:{internal}','-v',f'{temp}:/lab:ro','--entrypoint','nginx','nginx:1.27-alpine','-c','/lab/nginx.conf','-g','daemon off;'])
        try:
            scheme='https' if profile in ['https','prod'] else 'http'
            def request(path):
                try: return urllib.request.urlopen(f'{scheme}://127.0.0.1:{port}{path}',context=ssl._create_unverified_context(),timeout=3)
                except urllib.error.HTTPError as error: return error
            for attempt in range(30):
                try: response=request('/'); break
                except (urllib.error.URLError, ConnectionError): time.sleep(.2)
            else: raise RuntimeError(run(['docker','logs',name]))
            for path in ['/','/index.html','/assets/test.js','/assets/missing.js','/api/v1/fixture','/health/ready']:
                response=request(path); headers=response.headers; response.close()
                for required in ['X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Content-Security-Policy-Report-Only']:
                    assert required in headers, (profile,path,required)
                if scheme=='https': assert 'Strict-Transport-Security' in headers, (profile,path,'HSTS')
                results.append({'profile':profile,'path':path,'status':response.status,'securityHeaders':True})
            marker='nodeaccess-secret-log-fixture'
            response=request('/ws/security-test?token='+marker); response.close()
            logs=run(['docker','logs',name])
            # docker captures stdout and stderr independently. Neither may contain a token.
            combined=subprocess.run(['docker','logs',name],capture_output=True,text=True,check=True)
            assert marker not in combined.stdout+combined.stderr, (profile,'token in proxy logs')
        finally: run(['docker','rm','-f',name])
output=Path(os.environ.get('NGINX_EVIDENCE_PATH', '/tmp/nodeaccess-nginx-headers.json'))
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps({'success':True,'cases':results},indent=2)); print(f'{len(results)} real Nginx response checks passed')
