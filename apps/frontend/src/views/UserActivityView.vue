<script setup lang="ts">
import { defineAsyncComponent } from 'vue'

// Modo self-service: exibe o dashboard do proprio usuario logado.
// DashboardUserView detecta automaticamente a ausencia de userId no route.params
// e carrega os dados do usuario autenticado.
const DashboardUserViewInternal = defineAsyncComponent(
  () => import('@/views/admin/DashboardUserView.vue'),
)
</script>

<template>
  <Suspense>
    <DashboardUserViewInternal />
  </Suspense>
</template>
