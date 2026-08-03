<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NEmpty,
  NInput,
  NSpin,
  NTree,
  useDialog,
  useMessage,
} from 'naive-ui'
import type { TreeOption } from 'naive-ui'
import type { InventoryNodePublic } from '@nodeaccess/shared'
import { inventoryService } from '@/services/inventory.service'
import InventoryAclInlinePanel from '@/components/InventoryAclInlinePanel.vue'

const props = withDefaults(defineProps<{
  active?: boolean
  initialNodeId?: number | null
}>(), {
  active: true,
  initialNodeId: null,
})
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const loading = ref(false)
const error = ref('')
const nodes = ref<InventoryNodePublic[]>([])
const selectedKeys = ref<Array<string | number>>([])
const creating = ref(false)
const renaming = ref(false)
const deleting = ref(false)
const createName = ref('')
const createError = ref('')
const renameName = ref('')
const renameError = ref('')

const selectedNode = computed(() => {
  const id = Number(selectedKeys.value[0])
  return nodes.value.find(node => node.id === id) ?? null
})
const canRenameSelectedFolder = computed(() => selectedNode.value?.type === 'FOLDER')
const canDeleteSelectedFolder = computed(() => selectedNode.value?.type === 'FOLDER')
const canSubmitRename = computed(() => {
  const folder = selectedNode.value
  const nextName = renameName.value.trim()
  return folder?.type === 'FOLDER' && nextName.length > 0 && nextName !== folder.name
})

const treeData = computed<TreeOption[]>(() => {
  const allowed = nodes.value.filter(node => node.type === 'ROOT' || node.type === 'FOLDER')
  const byParent = new Map<number | null, InventoryNodePublic[]>()
  for (const node of allowed) {
    const siblings = byParent.get(node.parentId) ?? []
    siblings.push(node)
    byParent.set(node.parentId, siblings)
  }

  const build = (parentId: number | null): TreeOption[] =>
    (byParent.get(parentId) ?? []).map(node => ({
      key: node.id,
      label: node.type === 'ROOT' ? t('hosts.inventoryFolders.root') : node.name,
      children: build(node.id),
    }))

  return build(null)
})

async function load() {
  if (!props.active) return
  loading.value = true
  error.value = ''
  try {
    nodes.value = (await inventoryService.list()).data
    const initialNode = findInitialNode()
    const currentId = Number(selectedKeys.value[0])
    const selectedStillExists = nodes.value.some(node => node.id === currentId)
    if (initialNode) {
      selectedKeys.value = [initialNode.id]
    } else if (!selectedStillExists) {
      const root = nodes.value.find(node => node.type === 'ROOT')
      selectedKeys.value = root ? [root.id] : []
    }
  } catch {
    error.value = t('hosts.inventoryFolders.loadError')
  } finally {
    loading.value = false
  }
}

function findInitialNode() {
  if (!props.initialNodeId) return null
  return nodes.value.find(node => node.id === props.initialNodeId && (node.type === 'ROOT' || node.type === 'FOLDER')) ?? null
}

async function createFolder() {
  const parent = selectedNode.value
  const name = createName.value.trim()
  if (!parent || name.length === 0 || creating.value) return
  creating.value = true
  createError.value = ''
  try {
    const { data } = await inventoryService.createFolder(parent.id, name)
    createName.value = ''
    await load()
    selectedKeys.value = [data.id]
    emit('changed')
  } catch {
    createError.value = t('hosts.inventoryFolders.createError')
  } finally {
    creating.value = false
  }
}

async function renameFolder() {
  const folder = selectedNode.value
  const name = renameName.value.trim()
  if (!folder || folder.type !== 'FOLDER' || !canSubmitRename.value || renaming.value) return
  renaming.value = true
  renameError.value = ''
  try {
    const { data } = await inventoryService.updateFolder(folder.id, name)
    message.success(t('hosts.inventoryFolders.renameSuccess'))
    await load()
    selectedKeys.value = [data.id]
    renameName.value = data.name
    emit('changed')
  } catch (cause: any) {
    renameError.value = cause?.response?.data?.message ?? t('hosts.inventoryFolders.renameError')
  } finally {
    renaming.value = false
  }
}

function confirmDeleteFolder() {
  const folder = selectedNode.value
  if (!folder || folder.type !== 'FOLDER' || deleting.value) return
  dialog.warning({
    title: t('hosts.inventoryFolders.deleteTitle'),
    content: t('hosts.inventoryFolders.deleteConfirm', { name: folder.name }),
    positiveText: t('hosts.inventoryFolders.deleteAction'),
    negativeText: t('common.cancel'),
    async onPositiveClick() {
      deleting.value = true
      try {
        await inventoryService.deleteFolder(folder.id)
        message.success(t('hosts.inventoryFolders.deleteSuccess'))
        const parentId = folder.parentId
        await load()
        selectedKeys.value = parentId ? [parentId] : selectedKeys.value
        emit('changed')
      } catch (cause: any) {
        message.error(cause?.response?.data?.message ?? t('hosts.inventoryFolders.deleteError'))
      } finally {
        deleting.value = false
      }
    },
  })
}

function openAclAudit() {
  const search = selectedNode.value?.type === 'ROOT'
    ? t('hosts.inventoryFolders.root')
    : selectedNode.value?.name ?? ''
  void router.push({
    name: 'admin-logs',
    query: {
      tab: 'acl',
      ...(selectedNode.value ? { targetId: String(selectedNode.value.id) } : search ? { search } : {}),
    },
  })
}

watch(() => props.active, (active) => {
  if (active) void load()
  else {
    createName.value = ''
    createError.value = ''
    renameName.value = ''
    renameError.value = ''
  }
}, { immediate: true })

watch(() => props.initialNodeId, (nodeId) => {
  if (!nodeId || nodes.value.length === 0) return
  const node = findInitialNode()
  if (node) {
    selectedKeys.value = [node.id]
  }
})

watch(selectedNode, (node) => {
  renameName.value = node?.type === 'FOLDER' ? node.name : ''
  renameError.value = ''
})
</script>

<template>
  <NSpin :show="loading">
    <NAlert v-if="error" type="error">
      {{ error }}
      <div class="mt-2">
        <NButton text @click="load">{{ $t('hosts.inventoryAcl.retry') }}</NButton>
      </div>
    </NAlert>

    <template v-else>
      <NAlert type="info" :show-icon="false" class="mb-4">
        {{ $t('hosts.inventoryFolders.description') }}
      </NAlert>

      <NAlert
        v-if="nodes.some((node) => node.type === 'FOLDER') === false"
        type="warning"
        :show-icon="false"
        class="mb-4"
      >
        {{ $t('hosts.inventoryFolders.noCorporateFolders') }}
      </NAlert>

      <NEmpty
        v-if="treeData.length === 0"
        :description="$t('hosts.inventoryFolders.empty')"
      />
      <template v-else>
        <div class="inventory-acl-workspace">
          <div class="inventory-acl-workspace__tree">
            <NTree
              v-model:selected-keys="selectedKeys"
              :data="treeData"
              block-line
              default-expand-all
              selectable
            />
            <div class="mt-5 rounded-md border border-gray-800 bg-[#111113] p-3">
              <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {{ $t('hosts.inventoryFolders.createTitle') }}
              </div>
              <div class="flex gap-2">
                <NInput
                  v-model:value="createName"
                  :placeholder="$t('hosts.inventoryFolders.createPlaceholder')"
                  :disabled="creating || selectedNode === null"
                  @keyup.enter="createFolder"
                />
                <NButton
                  secondary
                  :loading="creating"
                  :disabled="selectedNode === null || createName.trim().length === 0"
                  @click="createFolder"
                >
                  {{ $t('hosts.inventoryFolders.createAction') }}
                </NButton>
              </div>
              <div v-if="createError" class="mt-2 text-xs text-red-400">
                {{ createError }}
              </div>
            </div>

            <div class="mt-5 rounded-md border border-gray-800 bg-[#111113] p-3">
              <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {{ $t('hosts.inventoryFolders.renameTitle') }}
              </div>
              <div class="flex gap-2">
                <NInput
                  v-model:value="renameName"
                  :placeholder="$t('hosts.inventoryFolders.renamePlaceholder')"
                  :disabled="renaming || !canRenameSelectedFolder"
                  @keyup.enter="renameFolder"
                />
                <NButton
                  secondary
                  :loading="renaming"
                  :disabled="!canSubmitRename"
                  @click="renameFolder"
                >
                  {{ $t('hosts.inventoryFolders.renameAction') }}
                </NButton>
              </div>
              <div v-if="renameError" class="mt-2 text-xs text-red-400">
                {{ renameError }}
              </div>
            </div>

            <div class="mt-5 flex flex-wrap justify-end gap-2">
              <NButton
                secondary
                :disabled="selectedNode === null"
                @click="openAclAudit"
              >
                {{ $t('hosts.inventoryFolders.audit') }}
              </NButton>
              <NButton
                secondary
                type="error"
                :loading="deleting"
                :disabled="!canDeleteSelectedFolder"
                @click="confirmDeleteFolder"
              >
                {{ $t('hosts.inventoryFolders.deleteAction') }}
              </NButton>
            </div>
          </div>

          <div class="inventory-acl-workspace__permissions">
            <InventoryAclInlinePanel
              :inventory-node-id="selectedNode?.id ?? null"
              :item-name="selectedNode?.type === 'ROOT' ? $t('hosts.inventoryFolders.root') : (selectedNode?.name ?? '')"
              :active="selectedNode !== null"
            />
          </div>
        </div>
      </template>
    </template>
  </NSpin>
</template>

<style scoped>
.inventory-acl-workspace {
  display: grid;
  grid-template-columns: minmax(260px, 0.78fr) minmax(360px, 1.22fr);
  gap: 18px;
  align-items: start;
}
.inventory-acl-workspace__tree,
.inventory-acl-workspace__permissions {
  min-width: 0;
}
.inventory-acl-workspace__permissions {
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  padding-left: 18px;
}
@media (max-width: 1100px) {
  .inventory-acl-workspace {
    grid-template-columns: 1fr;
  }
  .inventory-acl-workspace__permissions {
    border-left: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-left: 0;
    padding-top: 18px;
  }
}
</style>
