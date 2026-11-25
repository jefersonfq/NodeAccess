<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { VaultExtensionWriteSchema, type VaultExtensionWriteAccess, type VaultExtensionWrite, type VaultItemSummary } from '@nodeaccess/shared'
import { ExtensionError, type ExtensionClient } from '../core/client'
import { generatePassword } from '../core/password'
import { message } from './messages'

const props = defineProps<{ client: ExtensionClient; language: string; mode: 'create-secret' | 'update-secret' | 'rotate-secret' | 'import-pem'; item?: VaultItemSummary | undefined; writeAccess?: VaultExtensionWriteAccess | undefined }>()
const emit = defineEmits<{ close: []; saved: []; expired: [error: ExtensionError] }>()
const pt = computed(() => props.language.toLowerCase().startsWith('pt'))
const words = computed(() => pt.value ? {
  title: { 'create-secret': 'Novo Secret', 'update-secret': 'Editar dados do Secret', 'rotate-secret': 'Substituir senha', 'import-pem': 'Importar PEM pessoal' },
  name: 'Nome / alias', description: 'Descrição', value: 'Nova senha / valor', key: 'Conteúdo da chave privada PEM', passphrase: 'Senha da chave (se houver)',
  generate: 'Gerar senha', save: 'Salvar', saving: 'Salvando…', cancel: 'Cancelar', generated: 'Senha gerada. Salve para aplicar.',
  note: 'Confira o escopo antes de salvar. Fechar esta janela descarta os campos. A senha atual não é carregada.', file: 'Selecionar arquivo PEM',
} : {
  title: { 'create-secret': 'New Secret', 'update-secret': 'Edit Secret details', 'rotate-secret': 'Replace password', 'import-pem': 'Import personal PEM' },
  name: 'Name / alias', description: 'Description', value: 'New password / value', key: 'PEM private key content', passphrase: 'Key passphrase (if any)',
  generate: 'Generate password', save: 'Save', saving: 'Saving…', cancel: 'Cancel', generated: 'Password generated. Save to apply.',
  note: 'Check the scope before saving. Closing this window discards the fields. The current password is never loaded.', file: 'Select PEM file',
})
const name = ref(props.item?.label ?? ''), description = ref(props.item?.description ?? ''), value = ref(''), key = ref(''), passphrase = ref('')
const scope = ref<'PERSONAL' | 'GROUP' | 'TENANT'>(props.item?.writeScope ?? 'PERSONAL')
const groupId = ref<number | undefined>(props.item?.groupId ?? undefined)
const groups = computed(() => props.writeAccess?.groups ?? [])
const busy = ref(false), reading = ref(false), error = ref(''), generated = ref(false), firstInput = ref<HTMLInputElement | null>(null)
const form = ref<HTMLFormElement | null>(null)
let alive = true, selection = 0
const pem = computed(() => props.mode === 'import-pem'), rotate = computed(() => props.mode === 'rotate-secret')
const needsValue = computed(() => props.mode === 'create-secret' || rotate.value)
function clear(): void { selection++; reading.value = false; value.value = ''; key.value = ''; passphrase.value = ''; generated.value = false }
onMounted(() => { void nextTick(() => firstInput.value?.focus()) })
onBeforeUnmount(() => { alive = false; clear() })
function close(): void { if (!busy.value) { clear(); emit('close') } }
function generate(): void { value.value = generatePassword(); generated.value = true }
async function fileChanged(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  const current = ++selection
  key.value = ''; reading.value = !!file
  error.value = ''
  if (!file) return
  try {
    if (file.size > 65535) throw new ExtensionError('writeInvalid')
    const text = await file.text()
    if (alive && current === selection) key.value = text
  } catch { if (alive && current === selection) error.value = message(props.language).errors.writeInvalid }
  finally { if (current === selection) reading.value = false; input.value = '' }
}
async function save(): Promise<void> {
  if (busy.value || reading.value) return
  if (form.value && !form.value.reportValidity()) return
  busy.value = true; error.value = ''
  try {
    let body: VaultExtensionWrite
    switch (props.mode) {
      case 'create-secret': body = { operation: props.mode, alias: name.value, description: description.value, value: value.value }; break
      case 'update-secret': body = { operation: props.mode, id: props.item!.sourceId, alias: name.value, description: description.value || null }; break
      case 'rotate-secret': body = { operation: props.mode, id: props.item!.sourceId, value: value.value }; break
      case 'import-pem': body = { operation: props.mode, name: name.value, key: key.value, ...(passphrase.value ? { passphrase: passphrase.value } : {}) }
    }
    if (body.operation !== 'import-pem') body = { ...body, scope: scope.value, ...(scope.value === 'GROUP' ? { groupId: groupId.value } : {}) }
    if (scope.value === 'GROUP' && !groupId.value && body.operation !== 'import-pem') throw new ExtensionError('writeInvalid')
    const parsed = VaultExtensionWriteSchema.safeParse(body)
    if (!parsed.success) {
      error.value = message(props.language).errors.writeInvalid
      busy.value = false
      const field = parsed.error.issues[0]?.path[0]
      const id = field === 'alias' || field === 'name' ? 'item-name' : field === 'description' ? 'item-description' : field === 'key' ? 'item-key' : field === 'passphrase' ? 'item-passphrase' : 'item-value'
      await nextTick()
      form.value?.querySelector<HTMLElement>(`#${id}`)?.focus()
      return
    }
    await props.client.write(parsed.data)
    clear()
    if (alive) emit('saved')
  } catch (failure) {
    clear()
    if (!alive) return
    const e = failure instanceof ExtensionError ? failure : new ExtensionError('unavailable')
    error.value = message(props.language).errors[e.reason]
    if (e.reason === 'expired' || e.reason === 'denied') emit('expired', e)
  } finally { busy.value = false }
}
defineExpose({ save, close, generate, fileChanged })
</script>

<template>
  <form
    ref="form"
    class="editor"
    autocomplete="off"
    :aria-busy="busy"
    data-testid="vaultnaccess-editor"
    @submit.prevent="save"
    @keydown.esc.stop.prevent="close"
  >
    <h2>{{ words.title[mode] }}</h2>
    <p>{{ words.note }}</p>
    <fieldset :disabled="busy">
      <template v-if="!pem">
        <label for="item-scope">{{ pt ? 'Escopo' : 'Scope' }}</label>
        <select
          id="item-scope"
          v-model="scope"
          :disabled="rotate"
        >
          <option value="PERSONAL">
            {{ pt ? 'Pessoal' : 'Personal' }}
          </option>
          <option
            v-if="groups.length || item?.writeScope === 'GROUP'"
            value="GROUP"
          >
            {{ pt ? 'Grupo' : 'Group' }}
          </option>
          <option
            v-if="writeAccess?.tenant || item?.writeScope === 'TENANT'"
            value="TENANT"
          >
            Tenant
          </option>
        </select>
        <template v-if="scope === 'GROUP'">
          <label for="item-group">{{ pt ? 'Grupo permitido' : 'Allowed group' }}</label>
          <select
            id="item-group"
            v-model="groupId"
            required
            :disabled="rotate"
          >
            <option
              v-for="group in groups"
              :key="group.id"
              :value="group.id"
            >
              {{ group.name }}
            </option>
            <option
              v-if="item?.groupId && !groups.some(g => g.id === item?.groupId)"
              :value="item.groupId"
            >
              {{ pt ? 'Grupo atual' : 'Current group' }} (#{{ item.groupId }})
            </option>
          </select>
        </template>
      </template>
      <template v-if="!rotate">
        <label for="item-name">{{ words.name }}</label>
        <input
          id="item-name"
          ref="firstInput"
          v-model="name"
          required
          :minlength="pem ? 1 : 2"
          :maxlength="pem ? 100 : 120"
          :pattern="pem ? undefined : '[a-zA-Z0-9_.:-]+'"
        >
      </template>
      <template v-if="!pem && !rotate">
        <label for="item-description">{{ words.description }}</label>
        <textarea
          id="item-description"
          v-model="description"
          maxlength="500"
        />
      </template>
      <template v-if="needsValue">
        <label for="item-value">{{ words.value }}</label>
        <input
          id="item-value"
          v-model="value"
          type="password"
          autocomplete="new-password"
          required
          maxlength="65535"
        >
        <button
          type="button"
          @click="generate"
        >
          {{ words.generate }}
        </button>
        <p
          v-if="generated"
          role="status"
        >
          {{ words.generated }}
        </p>
      </template>
      <template v-if="pem">
        <label for="item-file">{{ words.file }}</label>
        <input
          id="item-file"
          type="file"
          accept=".pem,.key"
          @change="fileChanged"
        >
        <label for="item-key">{{ words.key }}</label>
        <textarea
          id="item-key"
          v-model="key"
          required
          maxlength="65535"
          spellcheck="false"
        />
        <label for="item-passphrase">{{ words.passphrase }}</label>
        <input
          id="item-passphrase"
          v-model="passphrase"
          type="password"
          autocomplete="new-password"
          maxlength="1024"
        >
      </template>
      <div class="buttons">
        <button
          type="submit"
          :disabled="reading"
        >
          {{ busy ? words.saving : words.save }}
        </button>
        <button
          type="button"
          @click="close"
        >
          {{ words.cancel }}
        </button>
      </div>
    </fieldset>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
  </form>
</template>

<style scoped>
.editor { display: grid; gap: 10px; padding: 12px; }
h2, p { margin: 0; }
p { font-size: 12px; line-height: 1.5; }
fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 8px; min-width: 0; }
label { font-size: 12px; font-weight: 600; }
input, textarea, select { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px; color: inherit; background: transparent; border: 1px solid #64748b; border-radius: 6px; }
textarea { min-height: 64px; resize: vertical; }
button { cursor: pointer; padding: 8px; color: inherit; background: transparent; border: 1px solid #64748b; border-radius: 6px; }
.buttons { display: flex; gap: 8px; }
:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
[role=alert] { color: #ef4444; }
</style>
