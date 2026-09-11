/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_WS_URL:  string
  readonly VITE_APP_VERSION?: string
  readonly VITE_CACHE_TTL_LIVE?: string
  readonly VITE_CACHE_TTL_HOT?: string
  readonly VITE_CACHE_TTL_WARM?: string
  readonly VITE_CACHE_TTL_COLD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
