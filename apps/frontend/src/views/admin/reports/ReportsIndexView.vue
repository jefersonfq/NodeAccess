<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { NCard, NText, NTag } from 'naive-ui'

const router = useRouter()

const reports = computed(() => [
  {
    key: 'logs',
    title: 'Logs',
    description: 'Consulte eventos de autenticação, ações administrativas e trilhas operacionais.',
    route: { name: 'admin-logs' },
    status: 'Disponível',
    statusType: 'success' as const,
  },
  {
    key: 'session-audit',
    title: 'Auditoria de sessões',
    description: 'Revise comandos, tráfego, duração e evidências das sessões de acesso.',
    route: { name: 'admin-session-audit' },
    status: 'Disponível',
    statusType: 'success' as const,
  },
  {
    key: 'snippets',
    title: 'Uso de snippets',
    description: 'Acompanhe execuções, falhas, usuários e snippets mais usados.',
    route: { name: 'admin-reports-snippets' },
    status: 'Disponível',
    statusType: 'success' as const,
  },
  {
    key: 'sessions',
    title: 'Sessões SSH',
    description: 'Análise histórica de conexões, falhas, usuários e hosts acessados por período.',
    route: { name: 'admin-reports-sessions' },
    status: 'Disponível',
    statusType: 'success' as const,
  },
  {
    key: 'ssh-tunnels',
    title: 'Acessos locais',
    description: 'Uso de túneis e acessos web por usuário, host e período.',
    route: { name: 'admin-reports-ssh-tunnels' },
    status: 'Disponível',
    statusType: 'success' as const,
  },
  {
    key: 'adoption',
    title: 'Adoção por usuário',
    description: 'Compare uso de recursos para entender engajamento da plataforma.',
    route: { name: 'admin-reports-adoption' },
    status: 'Disponível',
    statusType: 'success' as const,
  },
  {
    key: 'client-ux',
    title: 'UX do cliente',
    description: 'Eventos de sessão expirada, reload e falhas percebidas pelo usuário.',
    route: { name: 'admin-reports-client-ux' },
    status: 'Disponível',
    statusType: 'success' as const,
  },
  {
    key: 'host-keys',
    title: 'Host keys',
    description: 'Audite primeiras confianças, alterações e hosts sem host key confiada.',
    route: { name: 'admin-reports-host-keys' },
    status: 'Disponível',
    statusType: 'success' as const,
  },
])
</script>

<template>
  <div class="p-6">
    <div class="mb-6">
      <h1 class="text-xl font-semibold text-white">Relatórios</h1>
      <NText depth="3" class="text-sm">
        Métricas operacionais e de adoção separadas dos logs cronológicos.
      </NText>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <button
        v-for="report in reports"
        :key="report.key"
        type="button"
        :disabled="!report.route"
        :class="[
          'w-full text-left transition-colors',
          report.route ? 'cursor-pointer' : 'cursor-not-allowed opacity-75',
        ]"
        @click="report.route && router.push(report.route)"
      >
        <NCard
          :bordered="false"
          class="na-card h-full border transition-colors hover:border-blue-500/40"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-white">{{ report.title }}</div>
              <div class="mt-2 text-sm text-gray-400">{{ report.description }}</div>
            </div>
            <NTag size="small" :type="report.statusType">{{ report.status }}</NTag>
          </div>
          <div v-if="report.route" class="mt-4 text-xs font-medium text-blue-300">
            Abrir relatório
          </div>
        </NCard>
      </button>
    </div>
  </div>
</template>
