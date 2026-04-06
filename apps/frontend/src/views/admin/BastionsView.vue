<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NDataTable, NButton, NSpace, NAlert, NModal, NForm,
  NFormItem, NInput, NInputNumber, NSelect, NTag, NCollapse, NCollapseItem,
  NText, useMessage, useDialog,
} from 'naive-ui'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import type { BastionPublic, CreateBastionDto } from '@nodeaccess/shared'
import { bastionService } from '@/services/bastion.service'

const { t } = useI18n()

const msg    = useMessage()
const dialog = useDialog()

const bastions = ref<BastionPublic[]>([])
const loading  = ref(false)
const error    = ref<string | null>(null)

const showModal    = ref(false)
const modalLoading = ref(false)
const editingId    = ref<number | null>(null)

const form = ref<CreateBastionDto & { pemKey?: string; password?: string; pemKeyName?: string }>({
  name:       '',
  ip:         '',
  port:       22,
  sshUser:    '',
  authType:   'pem',
  pemKeyName: '',
  pemKey:     '',
  password:   '',
})

const authTypeOptions = computed<SelectOption[]>(() => [
  { label: t('hosts.form.authPem'),      value: 'pem' },
  { label: t('hosts.form.authPassword'), value: 'password' },
])

const isEditing = computed(() => editingId.value !== null)

const columns = computed<DataTableColumns<BastionPublic>>(() => [
  { title: t('admin.bastions.columns.name'),    key: 'name' },
  { title: t('admin.bastions.columns.ip'),      key: 'ip' },
  { title: t('admin.bastions.columns.port'),    key: 'port', width: 80 },
  { title: t('admin.bastions.columns.user'),    key: 'sshUser' },
  {
    title: t('admin.bastions.columns.auth'),
    key: 'authType',
    width: 120,
    render: (row) => h(NTag, { type: row.authType === 'pem' ? 'info' : 'warning', size: 'small' }, () => row.authType.toUpperCase()),
  },
  {
    title: t('admin.bastions.columns.actions'),
    key: 'actions',
    render: (row) => h(NSpace, {}, () => [
      h(NButton, { size: 'small', onClick: () => openEdit(row) }, () => t('admin.bastions.actions.edit')),
      h(NButton, { size: 'small', type: 'error', onClick: () => remove(row) }, () => t('admin.bastions.actions.delete')),
    ]),
  },
])

async function load() {
  loading.value = true
  error.value   = null
  try {
    const { data } = await bastionService.list()
    bastions.value = data
  } catch {
    error.value = 'Erro ao carregar bastion hosts'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCreate() {
  editingId.value = null
  form.value = { name: '', ip: '', port: 22, sshUser: '', authType: 'pem', pemKeyName: '', pemKey: '', password: '' }
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
    pemKeyName: '',
    pemKey:     '',
    password:   '',
  }
  showModal.value = true
}

async function save() {
  modalLoading.value = true
  try {
    const payload: Record<string, unknown> = {
      name:    form.value.name,
      ip:      form.value.ip,
      port:    form.value.port,
      sshUser: form.value.sshUser,
      authType: form.value.authType,
    }

    if (form.value.authType === 'pem' && form.value.pemKey) {
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
      <NButton type="primary" @click="openCreate">{{ $t('admin.bastions.newBastion') }}</NButton>
    </div>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

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
            <li>Cadastra o bastion aqui e vincula ao grupo ou ao host desejado.</li>
            <li>O NodeAccess conecta no bastion e de lá salta para qualquer servidor interno.</li>
          </ul>

          <p><strong>Como configurar:</strong></p>
          <ol class="list-decimal ml-4 space-y-1">
            <li>Cadastre o bastion aqui com o IP público, usuário SSH e a chave PEM (ou senha) de acesso a ele.</li>
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

    <NDataTable :columns="columns" :data="bastions" :loading="loading" :row-key="(r) => r.id" />

    <NModal v-model:show="showModal" preset="card" :title="isEditing ? $t('admin.bastions.modal.editTitle') : $t('admin.bastions.modal.createTitle')" style="width: 480px">
      <NForm @submit.prevent="save">
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

        <NFormItem v-if="form.authType === 'password'" :label="isEditing ? $t('admin.bastions.modal.passwordUpdateLabel') : $t('admin.bastions.modal.passwordCreateLabel')">
          <NInput v-model:value="form.password" type="password" show-password-on="click" />
        </NFormItem>

        <NButton type="primary" :loading="modalLoading" @click="save">
          {{ isEditing ? $t('admin.bastions.modal.save') : $t('admin.bastions.modal.create') }}
        </NButton>
      </NForm>
    </NModal>
  </div>
</template>
