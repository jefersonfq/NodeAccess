"""Independent interoperability probe: pip install tacacs_plus==2.6 in an isolated environment."""
import json, os, sys
from tacacs_plus.client import TACACSClient
request = json.loads(sys.stdin.read())
client = TACACSClient('127.0.0.1', request['port'], request['secret'], timeout=3)
action = request['action']
try:
    if action in ('ascii', 'pap'):
        result = client.authenticate(request.get('username', 'alice'), request.get('password', 'disposable-aaa-password'), authen_type=1 if action == 'ascii' else 2)
    elif action == 'authorize':
        result = client.authorize(request.get('username', 'alice'), arguments=[s.encode() for s in request['args']])
    else:
        result = client.account(request.get('username', 'alice'), request.get('flags', 2), arguments=[s.encode() for s in request.get('args', [])])
    print(json.dumps({'valid': bool(result.valid), 'status': result.status}))
except Exception as error:
    print(json.dumps({'valid': False, 'unavailable': True, 'errorType': type(error).__name__}))
