<script setup lang="ts">
// Layout limpo para telas de login / MFA
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <div class="auth-bg min-h-screen flex items-center justify-center">

    <!-- Subtle grid overlay -->
    <div class="auth-grid" />

    <!-- Glow blobs -->
    <div class="auth-blob auth-blob-blue" />
    <div class="auth-blob auth-blob-purple" />

    <!-- Card container -->
    <div class="relative w-full max-w-md px-4 z-10">

      <!-- Branding -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center mb-4">
          <div
            class="flex items-center justify-center rounded-2xl"
            style="width:52px; height:52px; background: linear-gradient(135deg,#3b82f6,#6366f1); box-shadow: 0 0 32px rgba(99,102,241,0.35);"
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2"/>
              <rect x="2" y="14" width="20" height="8" rx="2"/>
              <line x1="6" y1="6" x2="6.01" y2="6"/>
              <line x1="6" y1="18" x2="6.01" y2="18"/>
            </svg>
          </div>
        </div>
        <h1 class="text-2xl font-bold text-white tracking-tight">NodeAccess</h1>
        <p class="text-gray-500 text-sm mt-1">{{ $t('auth.login.subtitle') }}</p>
      </div>

      <RouterView v-slot="{ Component, route: currentRoute }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="currentRoute.fullPath" />
        </Transition>
      </RouterView>
    </div>
  </div>
</template>

<style scoped>
.auth-bg {
  background: #0c0c10;
  position: relative;
  overflow: hidden;
}

/* Subtle dot grid */
.auth-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, #ffffff0a 1px, transparent 1px);
  background-size: 28px 28px;
  pointer-events: none;
}

/* Ambient color blobs */
.auth-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  opacity: 0.18;
}

.auth-blob-blue {
  width: 480px;
  height: 480px;
  background: #3b82f6;
  top: -120px;
  right: -80px;
}

.auth-blob-purple {
  width: 400px;
  height: 400px;
  background: #6366f1;
  bottom: -100px;
  left: -80px;
}
</style>
