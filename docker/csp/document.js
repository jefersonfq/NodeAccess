import fs from 'fs';

// Run only for the application document, never for remote web-proxy documents.
// No predictable fallback: failure to obtain randomness prevents serving the app.
function document(r) {
    try {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const nonce = Buffer.from(bytes).toString('base64');
        const template = fs.readFileSync('/usr/share/nginx/html/index.html', 'utf8');
        if (!template.includes('__NODEACCESS_CSP_NONCE__')) {
            throw new Error('CSP template missing');
        }
        r.variables.nodeaccess_nonce = nonce;
        r.headersOut['Content-Type'] = 'text/html; charset=utf-8';
        r.headersOut['Cache-Control'] = 'no-store';
        r.return(200, template.split('__NODEACCESS_CSP_NONCE__').join(nonce));
    } catch (_) {
        r.error('Application document CSP initialization failed');
        r.headersOut['Content-Type'] = 'text/plain; charset=utf-8';
        r.headersOut['Cache-Control'] = 'no-store';
        r.return(503, 'Interface temporariamente indisponível. Tente novamente.');
    }
}

export default { document };
