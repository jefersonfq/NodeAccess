import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const { manualPlugin } = createRequire(import.meta.url)('../../tools/manual/build.cjs')
const { securityCenterPlugin } = createRequire(import.meta.url)('../../tools/security-center/build.cjs')

// Opt-in local HTTPS (NA-0183 homologation: the vault and the extension refuse plain HTTP). Only when both
// paths are set; the API sees the browser's scheme/host through forwarded headers (backend TRUST_PROXY=true).
const devCert = process.env.NODEACCESS_DEV_HTTPS_CERT, devKey = process.env.NODEACCESS_DEV_HTTPS_KEY
const devHttps = devCert && devKey ? { cert: readFileSync(devCert), key: readFileSync(devKey) } : undefined
const forwarded = devHttps
  ? { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': process.env.NODEACCESS_DEV_HTTPS_HOST ?? '127.0.0.1:5173' } }
  : {}

export default defineConfig({
  plugins: [vue(), manualPlugin(), securityCenterPlugin()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    chunkSizeWarningLimit: 950,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          if (
            id.includes('/vue/')
            || id.includes('/@vue/')
            || id.includes('/vue-router/')
            || id.includes('/pinia/')
            || id.includes('/vue-i18n/')
            || id.includes('/@vueuse/')
            || id.includes('/naive-ui/')
            || id.includes('/vueuc/')
            || id.includes('/@css-render/')
            || id.includes('/css-render/')
            || id.includes('/treemate/')
            || id.includes('/vdirs/')
            || id.includes('/vooks/')
            || id.includes('/seemly/')
            || id.includes('/date-fns/')
            || id.includes('/async-validator/')
          ) {
            return 'vendor-ui'
          }

          if (id.includes('/xterm/') || id.includes('/@xterm/')) return 'vendor-terminal'
          if (id.includes('/monaco-editor/') || id.includes('/@monaco-editor/')) return 'vendor-monaco'
          if (id.includes('/axios/')) return 'vendor-http'
          if (id.includes('/zod/')) return 'vendor-validation'

          return 'vendor'
        },
      },
    },
  },
  server: {
    port: 5173,
    ...(devHttps ? { https: devHttps } : {}),

    
    allowedHosts: [
      'duty-hardened-pushpin.ngrok-free.dev',
    ],

    proxy: {
      '/api/v1/hosts/test-connection': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ...forwarded,
      },
      '/api/v1/tunnels': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ...forwarded,
      },
      '/api/v1/web-access': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ...forwarded,
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ...forwarded,
      },
      '/ws': {
        target:     'ws://localhost:3001',
        ws:         true,
        changeOrigin: true,
      },
    },
  },
})
