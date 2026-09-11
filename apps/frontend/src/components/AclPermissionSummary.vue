<script setup lang="ts">
import { NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { InventoryPermissions } from '@nodeaccess/shared'
defineProps<{ permissions: InventoryPermissions }>()
const { t } = useI18n()
const actions = ['view', 'connect', 'edit', 'admin'] as const
</script>
<template>
  <ul
    class="flex flex-wrap gap-2"
    data-acl-permission-summary
  >
    <li
      v-for="action in actions"
      :key="action"
    >
      <NTag
        :type="permissions[action] ? 'success' : 'default'"
        size="small"
      >
        {{ t(`hosts.inventoryAcl.${action}`) }}: {{ t(`hosts.inventoryAcl.ux.${permissions[action] ? 'allowed' : 'denied'}`) }}
      </NTag>
    </li>
  </ul>
</template>
