import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
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
    proxy: {
      '/api/v1/hosts/test-connection': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/v1/tunnels': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/v1/web-access': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target:     'ws://localhost:3001',
        ws:         true,
        changeOrigin: true,
      },
    },
  },
})
