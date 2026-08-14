<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  NDataTable, NButton, NSpace, NAlert, NModal, NForm,
  NFormItem, NInput, NInputNumber, NSelect, NTag, NCollapse, NCollapseItem,
  NText, NTooltip, useMessage, useDialog,
} from 'naive-ui'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import type { BastionPublic, CreateBastionDto, HostPublic, PemKeyPublic } from '@nodeaccess/shared'
import { bastionService } from '@/services/bastion.service'
import { pemKeyService } from '@/services/pem-key.service'
import { hostService } from '@/services/host.service'

const { t } = useI18n()
const router = useRouter()

const msg    = useMessage()
const dialog = useDialog()

const bastions = ref<BastionPublic[]>([])
const pemKeys  = ref<PemKeyPublic[]>([])
const hosts = ref<HostPublic[]>([])
const loading  = ref(false)
const error    = ref<string | null>(null)

const showModal    = ref(false)
const modalLoading = ref(false)
const editingId    = ref<number | null>(null)

type BastionForm = CreateBastionDto & {
  sourceHostId?: number
  pemKey?: string
  password?: string
  pemKeyName?: string
  pemKeySource: 'registered' | 'legacy'
}

const form = ref<BastionForm>({
  sourceHostId: undefined,
  name:       '',
  ip:         '',
  port:       22,
  sshUser:    '',
  authType:   'pem',
  systemPemKeyId: undefined,
  pemKeySource: 'registered',
  pemKeyName: '',
  pemKey:     '',
  password:   '',
})

const authTypeOptions = computed<SelectOption[]>(() => [
  { label: t('hosts.form.authPem'),      value: 'pem' },
  { label: t('hosts.form.authPassword'), value: 'password' },
])

const pemKeySourceOptions = computed<SelectOption[]>(() => [
  { label: t('admin.bastions.modal.pemSourceRegistered'), value: 'registered' },
  { label: t('admin.bastions.modal.pemSourceLegacy'), value: 'legacy' },
])

const pemKeyOptions = computed<SelectOption[]>(() =>
  pemKeys.value.map((key) => ({ label: key.name, value: key.id })),
)

const isEditing = computed(() => editingId.value !== null)
const eligibleHostOptions = computed<SelectOption[]>(() => {
  const alreadyEnabled = new Set(bastions.value.map((item) => item.sourceHostId).filter((id): id is number => id !== null))
  return hosts.value
    .filter((host) => host.accessProtocol === 'ssh'
      && host.connectionMode === 'direct'
      && host.effectiveBastionId === null
      && !host.onePasswordRef
      && !alreadyEnabled.has(host.id)
      && (host.authType === 'password'
        ? host.hasPasswordCredential === true
        : host.authType === 'pem_password'
          ? host.pemKeyId != null && host.hasPasswordCredential === true
          : host.pemKeyId != null))
    .map((host) => ({ label: `${host.name} · ${host.ip}:${host.port} · ${host.sshUser}`, value: host.id }))
})

function usageDetails(row: BastionPublic) {
  const usage = row.usage
  if (!usage) return t('admin.bastions.usage.none')
  const parts = [
    usage.directHostNames.length
      ? t('admin.bastions.usage.directNames', { names: usage.directHostNames.join(', ') })
      : '',
    usage.groupNames.length
      ? t('admin.bastions.usage.groupNames', { names: usage.groupNames.join(', ') })
      : '',
    usage.inheritedHostNames.length
      ? t('admin.bastions.usage.inheritedNames', { names: usage.inheritedHostNames.join(', ') })
      : '',
  ].filter(Boolean)
  return parts.length ? parts.join('\n') : t('admin.bastions.usage.none')
}

const columns = computed<DataTableColumns<BastionPublic>>(() => [
  {
    title: t('admin.bastions.columns.name'), key: 'name',
    render: (row) => h(NSpace, { size: 4, vertical: true }, () => [
      row.name,
      h(NTag, { size: 'tiny', type: row.sourceType === 'host' ? 'success' : 'warning' }, () =>
        row.sourceType === 'host' ? t('admin.bastions.source.host') : t('admin.bastions.source.legacy')),
    ]),
  },
  { title: t('admin.bastions.columns.ip'),      key: 'ip' },
  { title: t('admin.bastions.columns.port'),    key: 'port', width: 80 },
  { title: t('admin.bastions.columns.user'),    key: 'sshUser' },
  {
    title: t('admin.bastions.columns.auth'),
    key: 'authType',
    width: 120,
    render: (row) => h(NSpace, { size: 4, vertical: true }, () => [
      h(NTag, { type: row.authType === 'pem' ? 'info' : 'warning', size: 'small' }, () => row.authType.toUpperCase()),
      row.authType === 'pem'
        ? h(NTag, { type: row.pemKeySource === 'registered' ? 'success' : 'default', size: 'tiny' }, () =>
          row.pemKeySource === 'registered'
            ? t('admin.bastions.modal.pemSourceRegistered')
            : t('admin.bastions.modal.pemSourceLegacy'),
        )
        : null,
    ]),
  },
  {
    title: t('admin.bastions.columns.usage'),
    key: 'usage',
    minWidth: 220,
    render: (row) => {
      const usage = row.usage ?? {
        directHostCount:    0,
        inheritedHostCount: 0,
        groupCount:         0,
      }
      const total = usage.directHostCount + usage.inheritedHostCount + usage.groupCount
      return h(NTooltip, {}, {
        trigger: () => h(NSpace, { size: 6 }, () => [
          h(NTag, { size: 'small', type: usage.directHostCount > 0 ? 'info' : 'default' }, () =>
            t('admin.bastions.usage.directHosts', { count: usage.directHostCount }),
          ),
          h(NTag, { size: 'small', type: usage.groupCount > 0 ? 'success' : 'default' }, () =>
            t('admin.bastions.usage.groups', { count: usage.groupCount }),
          ),
          h(NTag, { size: 'small', type: usage.inheritedHostCount > 0 ? 'warning' : 'default' }, () =>
            t('admin.bastions.usage.inheritedHosts', { count: usage.inheritedHostCount }),
          ),
        ]),
        default: () => total > 0 ? usageDetails(row) : t('admin.bastions.usage.none'),
      })
    },
  },
  {
    title: t('admin.bastions.columns.actions'),
    key: 'actions',
    render: (row) => h(NSpace, {}, () => [
      h(NButton, {
        size: 'small',
        onClick: () => row.sourceHostId
          ? router.push({ name: 'host-dashboard', params: { hostId: row.sourceHostId } })
          : openEdit(row),
      }, () => row.sourceHostId ? t('admin.bastions.actions.openHost') : t('admin.bastions.actions.editLegacy')),
      h(NButton, { size: 'small', type: 'error', onClick: () => remove(row) }, () => t('admin.bastions.actions.delete')),
    ]),
  },
])

async function load() {
  loading.value = true
  error.value   = null
  try {
    const [bastionRes, pemKeyRes, hostRes] = await Promise.allSettled([
      bastionService.list(),
      pemKeyService.list(),
      hostService.list({ limit: 1000, accessProtocol: 'ssh' }),
    ])
    if (bastionRes.status === 'fulfilled') bastions.value = bastionRes.value.data
    if (pemKeyRes.status === 'fulfilled') pemKeys.value = pemKeyRes.value.data
    if (hostRes.status === 'fulfilled') hosts.value = hostRes.value.data.data
    if (bastionRes.status === 'rejected') throw bastionRes.reason
  } catch {
    error.value = 'Erro ao carregar bastion hosts'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCreate() {
  editingId.value = null
  form.value = {
    sourceHostId: undefined,
    name: '',
    ip: '',
    port: 22,
    sshUser: '',
    authType: 'pem',
    systemPemKeyId: undefined,
    pemKeySource: 'registered',
    pemKeyName: '',
    pemKey: '',
    password: '',
  }
  showModal.value = true
}

function openEdit(bastion: BastionPublic) {
  editingId.value = bastion.id
  form.value = {
    name:       bastion.name,
    ip:         bastion.ip,
    port:       bastion.port,
    sshUser:    bastion.sshUser,
    authType:   bastion.authType,
    systemPemKeyId: bastion.systemPemKeyId ?? undefined,
    pemKeySource: bastion.pemKeySource === 'registered' ? 'registered' : 'legacy',
    pemKeyName: '',
    pemKey:     '',
    password:   '',
  }
  showModal.value = true
}

async function save() {
  modalLoading.value = true
  try {
    if (!isEditing.value) {
      if (!form.value.sourceHostId) {
        msg.warning(t('admin.bastions.messages.selectHost'))
        return
      }
      await bastionService.create({ sourceHostId: form.value.sourceHostId })
      msg.success(t('admin.bastions.messages.created'))
      showModal.value = false
      await load()
      return
    }
    const payload: Record<string, unknown> = {
      name:    form.value.name,
      ip:      form.value.ip,
      port:    form.value.port,
      sshUser: form.value.sshUser,
      authType: form.value.authType,
    }

    if (form.value.authType === 'pem' && form.value.pemKeySource === 'registered' && form.value.systemPemKeyId) {
      payload.systemPemKeyId = form.value.systemPemKeyId
    }
    if (form.value.authType === 'pem' && form.value.pemKeySource === 'legacy' && form.value.pemKey) {
      payload.pemKey     = form.value.pemKey
      payload.pemKeyName = form.value.pemKeyName || form.value.name
    }
    if (form.value.authType === 'password' && form.value.password) {
      payload.password = form.value.password
    }

    if (isEditing.value) {
      await bastionService.update(editingId.value!, payload)
      msg.success(t('admin.bastions.messages.updated'))
    } else {
      await bastionService.create(payload as CreateBastionDto)
      msg.success(t('admin.bastions.messages.created'))
    }
    showModal.value = false
    load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.bastions.messages.saveError'))
  } finally {
    modalLoading.value = false
  }
}

async function remove(bastion: BastionPublic) {
  dialog.warning({
    title:        t('admin.bastions.deleteDialog.title', { name: bastion.name }),
    content:      t('admin.bastions.deleteDialog.content'),
    positiveText: t('admin.bastions.deleteDialog.confirm'),
    negativeText: t('admin.bastions.deleteDialog.cancel'),
    onPositiveClick: async () => {
      try {
        await bastionService.delete(bastion.id)
        msg.success(t('admin.bastions.messages.deleted'))
        load()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('admin.bastions.messages.deleteError'))
      }
    },
  })
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-semibold text-white">{{ $t('admin.bastions.title') }}</h1>
      <NButton type="primary" data-testid="enable-host-bastion" @click="openCreate">{{ $t('admin.bastions.newBastion') }}</NButton>
    </div>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />
    <NAlert type="info" class="mb-4" :title="$t('admin.bastions.usage.activeOnlyHint')" />

    <!-- Ajuda -->
    <NCollapse class="mb-6">
      <NCollapseItem :title="$t('admin.bastions.whatIsTitle')" name="help">
        <div class="text-sm space-y-3" style="color: #ccc;">
          <p>
            Um <strong>bastion host</strong> (também chamado de <em>jump server</em>) é um servidor intermediário
            que fica em uma rede pública e serve de "ponte" para acessar servidores em redes privadas —
            sem precisar expô-los diretamente à internet.
          </p>

          <div class="rounded p-3 font-mono text-xs" style="background: #1a1a1a; color: #a3e635;">
            <div>Sem bastion:</div>
            <div class="mt-1 ml-2">Browser → NodeAccess → ✗ Host privado (inacessível)</div>
            <div class="mt-2">Com bastion:</div>
            <div class="mt-1 ml-2">Browser → NodeAccess → Bastion → Host privado</div>
          </div>

          <p><strong>Exemplo prático (AWS):</strong></p>
          <ul class="list-disc ml-4 space-y-1">
            <li>Você tem 10 servidores de banco de dados em uma VPC privada, sem IP público.</li>
            <li>Cria uma instância EC2 pequena (t3.micro) com IP público na mesma VPC — esse é o bastion.</li>
            <li>Cadastre essa instância em Hosts e habilite-a aqui para atuar como bastion.</li>
            <li>O NodeAccess conecta no bastion e de lá salta para qualquer servidor interno.</li>
          </ul>

          <p><strong>Como configurar:</strong></p>
          <ol class="list-decimal ml-4 space-y-1">
            <li>Cadastre o servidor uma única vez em Hosts, com IP, usuário e credencial.</li>
            <li>Use <strong>Habilitar host como bastion</strong> e selecione esse Host.</li>
            <li>
              Associe o bastion a um <strong>grupo</strong> (em Grupos → Editar) para que todos os hosts
              do grupo usem esse bastion automaticamente.
            </li>
            <li>
              Ou associe diretamente a um <strong>host individual</strong> (em Hosts → Editar → campo Bastion)
              para sobrescrever o bastion do grupo.
            </li>
          </ol>

          <div class="rounded p-3 text-xs" style="background: #1a1a1a;">
            <NText style="color: #facc15;">Exemplo de cadastro:</NText>
            <div class="mt-1" style="color: #ccc;">
              Nome: <span style="color: #86efac;">bastion-prod</span> &nbsp;|&nbsp;
              IP: <span style="color: #86efac;">54.12.34.56</span> &nbsp;|&nbsp;
              Porta: <span style="color: #86efac;">22</span> &nbsp;|&nbsp;
              Usuário: <span style="color: #86efac;">ec2-user</span> &nbsp;|&nbsp;
              Auth: <span style="color: #86efac;">PEM</span>
            </div>
          </div>
        </div>
      </NCollapseItem>
    </NCollapse>

    <NDataTable data-testid="bastions-table" :columns="columns" :data="bastions" :loading="loading" :row-key="(r) => r.id" />

    <NModal v-model:show="showModal" preset="card" :title="isEditing ? $t('admin.bastions.modal.editTitle') : $t('admin.bastions.modal.createTitle')" style="width: min(480px, calc(100vw - 32px))">
      <NForm @submit.prevent="save">
        <template v-if="!isEditing">
          <NAlert type="info" class="mb-4">
            {{ $t('admin.bastions.modal.hostSourceHint') }}
          </NAlert>
          <NFormItem :label="$t('admin.bastions.modal.sourceHostLabel')">
            <NSelect
              v-model:value="form.sourceHostId"
              data-testid="bastion-source-host"
              :options="eligibleHostOptions"
              filterable
              :placeholder="$t('admin.bastions.modal.sourceHostPlaceholder')"
            />
          </NFormItem>
          <NAlert v-if="eligibleHostOptions.length === 0" type="warning" class="mb-3">
            {{ $t('admin.bastions.modal.noEligibleHosts') }}
          </NAlert>
        </template>
        <template v-else>
          <NAlert type="warning" class="mb-4">
            {{ $t('admin.bastions.modal.legacyEditHint') }}
          </NAlert>
        <NFormItem :label="$t('admin.bastions.modal.nameLabel')">
          <NInput v-model:value="form.name" :placeholder="$t('admin.bastions.modal.namePlaceholder')" />
        </NFormItem>
        <NFormItem :label="$t('admin.bastions.modal.ipLabel')">
          <NInput v-model:value="form.ip" :placeholder="$t('admin.bastions.modal.ipPlaceholder')" />
        </NFormItem>
        <NFormItem :label="$t('admin.bastions.modal.portLabel')">
          <NInputNumber v-model:value="form.port" :min="1" :max="65535" style="width: 100%" />
        </NFormItem>
        <NFormItem :label="$t('admin.bastions.modal.sshUserLabel')">
          <NInput v-model:value="form.sshUser" :placeholder="$t('admin.bastions.modal.sshUserPlaceholder')" />
        </NFormItem>
        <NFormItem :label="$t('admin.bastions.modal.authLabel')">
          <NSelect v-model:value="form.authType" :options="authTypeOptions" />
        </NFormItem>

        <template v-if="form.authType === 'pem'">
          <NAlert type="info" class="mb-3" :show-icon="false">
            {{ $t('admin.bastions.modal.pemRegisteredHint') }}
          </NAlert>
          <NFormItem :label="$t('admin.bastions.modal.pemSourceLabel')">
            <NSelect v-model:value="form.pemKeySource" :options="pemKeySourceOptions" />
          </NFormItem>

          <template v-if="form.pemKeySource === 'registered'">
            <NFormItem :label="$t('admin.bastions.modal.registeredPemLabel')">
              <NSelect
                v-model:value="form.systemPemKeyId"
                :options="pemKeyOptions"
                clearable
                filterable
                :placeholder="$t('admin.bastions.modal.registeredPemPlaceholder')"
              />
            </NFormItem>
            <NText depth="3" class="block text-xs mb-3">
              {{ $t('admin.bastions.modal.registeredPemImpact') }}
            </NText>
          </template>

          <template v-else>
            <NAlert type="warning" class="mb-3" :show-icon="false">
              {{ $t('admin.bastions.modal.legacyPemWarning') }}
            </NAlert>
            <NFormItem :label="$t('admin.bastions.modal.keyNameLabel')">
              <NInput v-model:value="form.pemKeyName" :placeholder="$t('admin.bastions.modal.keyNamePlaceholder')" />
            </NFormItem>
            <NFormItem :label="isEditing ? $t('admin.bastions.modal.pemUpdateLabel') : $t('admin.bastions.modal.pemCreateLabel')">
              <NInput
                v-model:value="form.pemKey"
                type="textarea"
                :rows="6"
                :placeholder="$t('admin.bastions.modal.pemPlaceholder')"
              />
            </NFormItem>
          </template>
        </template>

        <NFormItem v-if="form.authType === 'password'" :label="isEditing ? $t('admin.bastions.modal.passwordUpdateLabel') : $t('admin.bastions.modal.passwordCreateLabel')">
          <NInput v-model:value="form.password" type="password" show-password-on="click" />
        </NFormItem>
        </template>

        <NButton data-testid="save-bastion" type="primary" :loading="modalLoading" :disabled="!isEditing && !form.sourceHostId" @click="save">
          {{ isEditing ? $t('admin.bastions.modal.save') : $t('admin.bastions.modal.create') }}
        </NButton>
      </NForm>
    </NModal>
  </div>
</template>
