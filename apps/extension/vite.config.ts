import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { manifest } from './manifest'

/**
 * NA-0183 — reproducible MV3 build. The NodeAccess origin is fixed at build time (host permission and API base);
 * the manifest grants only identity/storage and that origin: no content scripts, externally_connectable or
 * web_accessible_resources.
 */
const portal = process.env.VAULTNACCESS_PORTAL_ORIGIN ?? 'https://nodeaccess.localhost'
const parsed = new URL(portal)
if (parsed.protocol !== 'https:' || parsed.origin !== portal) throw new Error('VAULTNACCESS_PORTAL_ORIGIN must be an https origin without path')
const version = process.env.VAULTNACCESS_VERSION ?? '0.1.0'
if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw new Error('VAULTNACCESS_VERSION must be x.y.z')

function manifestPlugin(): Plugin {
  return { name: 'vaultnaccess-manifest', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'manifest.json', source: `${JSON.stringify(manifest(portal, version), null, 2)}\n` })
  } }
}
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [vue(), manifestPlugin()],
  define: { __PORTAL_ORIGIN__: JSON.stringify(portal) },
  resolve: { alias: [{ find: /^@nodeaccess\/shared$/, replacement: resolve(__dirname, '../../packages/shared/src/index.ts') }] },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      input: { popup: resolve(__dirname, 'popup.html'), background: resolve(__dirname, 'src/background.ts') },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name].js', assetFileNames: 'assets/[name][extname]' },
    },
  },
})
