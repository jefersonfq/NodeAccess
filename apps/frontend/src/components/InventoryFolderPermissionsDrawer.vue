<script setup lang="ts">
import { NDrawer, NDrawerContent } from 'naive-ui'
import InventoryFolderPermissionsPanel from '@/components/InventoryFolderPermissionsPanel.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: []; changed: [] }>()
</script>

<template>
  <NDrawer
    :show="show"
    width="min(520px, 100vw)"
    placement="right"
    @update:show="(value) => { if (!value) emit('close') }"
  >
    <NDrawerContent :title="$t('hosts.inventoryFolders.title')" closable>
      <InventoryFolderPermissionsPanel
        :active="props.show"
        @changed="emit('changed')"
      />
    </NDrawerContent>
  </NDrawer>
</template>
