/** NA-0183 — MV3 manifest: identity, storage and the configured NodeAccess origin only. */
/** `key` (public key, base64 DER) pins the extension ID across installs so the server allowlist stays valid. */
/** `buildId` (NA-0190, local builds): shown as `version_name` so the running build is visible in chrome://extensions. */
/** `updateUrl` (NA-0194, packaged releases): the portal's update manifest for policy-installed copies. */
export function manifest(origin: string, extensionVersion: string, key?: string, buildId?: string, updateUrl?: string): Record<string, unknown> {
  const icons = { 16: 'icons/vaultnaccess-16.png', 32: 'icons/vaultnaccess-32.png', 48: 'icons/vaultnaccess-48.png', 128: 'icons/vaultnaccess-128.png' }
  return {
    ...(key ? { key } : {}),
    ...(updateUrl ? { update_url: updateUrl } : {}),
    icons,
    ...(buildId ? { version_name: `${extensionVersion} (${buildId})` } : {}),
    manifest_version: 3,
    name: 'VaultNAccess',
    // NA-0207: must describe every capability (search, reveal/copy, fill); Chrome caps it at 132 characters.
    description: 'Cofre NodeAccess: busca itens, revela e copia segredos e preenche logins na aba atual, sempre com sua autorização.',
    version: extensionVersion,
    minimum_chrome_version: '116',
    action: { default_title: 'VaultNAccess', default_popup: 'popup.html', default_icon: icons },
    // NA-0192: keyboard shortcut to open the popup (no permission; Ctrl+Shift+V is Chrome's paste as plain text).
    commands: { _execute_action: { suggested_key: { default: 'Alt+Shift+V' }, description: 'Abrir o VaultNAccess' } },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['identity', 'storage', 'activeTab', 'scripting'],
    host_permissions: [`${origin}/*`],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" },
  }
}
