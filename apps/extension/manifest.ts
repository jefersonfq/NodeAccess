/** NA-0183 — MV3 manifest: identity, storage and the configured NodeAccess origin only. */
/** `key` (public key, base64 DER) pins the extension ID across installs so the server allowlist stays valid. */
/** `buildId` (NA-0190, local builds): shown as `version_name` so the running build is visible in chrome://extensions. */
export function manifest(origin: string, extensionVersion: string, key?: string, buildId?: string): Record<string, unknown> {
  return {
    ...(key ? { key } : {}),
    ...(buildId ? { version_name: `${extensionVersion} (${buildId})` } : {}),
    manifest_version: 3,
    name: 'VaultNAccess',
    description: 'Busca de itens do cofre NodeAccess (somente metadados).',
    version: extensionVersion,
    minimum_chrome_version: '116',
    action: { default_title: 'VaultNAccess', default_popup: 'popup.html' },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['identity', 'storage'],
    host_permissions: [`${origin}/*`],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" },
  }
}
