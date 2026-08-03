<script setup lang="ts">
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NDataTable,
  NEmpty,
  NTag,
  NText,
  NTooltip,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type {
  AclPrincipalType,
  InventoryAclEntryPublic,
  InventoryPermissions,
} from '@nodeaccess/shared'

const props = withDefaults(defineProps<{
  entries: InventoryAclEntryPublic[]
  emptyDescription: string
  showActions?: boolean
  actionDisabled?: boolean
}>(), {
  showActions: false,
  actionDisabled: false,
})

const emit = defineEmits<{
  revoke: [entry: InventoryAclEntryPublic]
}>()

const { t } = useI18n()

type PermissionKey = keyof InventoryPermissions

const compactPermissionTitles: Record<PermissionKey, string> = {
  view: 'Ver',
  connect: 'Conectar',
  edit: 'Editar',
  admin: 'Admin',
}

function principalName(entry: InventoryAclEntryPublic): string {
  if (entry.principalType !== 'ROLE') return entry.principalName
  return t(entry.principalId === 2 ? 'hosts.inventoryAcl.tenantAdmins' : 'hosts.inventoryAcl.allUsers')
}

function principalTypeLabel(type: AclPrincipalType): string {
  return t(`hosts.inventoryAcl.effective.principalTypes.${type}`)
}

function principalTypeClass(type: AclPrincipalType): string {
  if (type === 'GROUP') return 'success'
  if (type === 'ROLE') return 'info'
  return 'default'
}

function renderPrincipalTypeIcon(type: AclPrincipalType) {
  const isGroup = type === 'GROUP'
  const label = principalTypeLabel(type)
  return h(NTooltip, { trigger: 'hover', placement: 'top' }, {
    trigger: () => h('span', {
      class: ['acl-principal-type-icon', `acl-principal-type-icon--${principalTypeClass(type)}`],
      role: 'img',
      'aria-label': label,
      title: label,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        color: type === 'ROLE' ? '#93c5fd' : '#9ca3af',
        flexShrink: '0',
      },
    }, [
      h('svg', {
        viewBox: '0 0 24 24',
        width: '14',
        height: '14',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.9',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        style: {
          width: '14px',
          height: '14px',
          display: 'block',
        },
      }, isGroup
        ? [
            h('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
            h('circle', { cx: '9', cy: '7', r: '4' }),
            h('path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }),
            h('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }),
          ]
        : [
            h('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
            h('circle', { cx: '12', cy: '7', r: '4' }),
          ]),
    ]),
    default: () => label,
  })
}

function originLabel(entry: InventoryAclEntryPublic): string {
  return entry.inventoryNodeName
}

function renderPermissionCell(entry: InventoryAclEntryPublic, permission: PermissionKey) {
  const granted = Boolean(entry.permissions[permission])
  const stateLabel = granted ? t('hosts.inventoryAcl.permissionGranted') : t('hosts.inventoryAcl.permissionDenied')
  const icon = granted
    ? h('svg', {
        class: 'acl-permission-icon',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2.4',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      }, [
        h('path', { d: 'M20 6 9 17l-5-5' }),
      ])
    : h('svg', {
        class: 'acl-permission-icon',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2.1',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      }, [
        h('circle', { cx: '12', cy: '12', r: '9' }),
        h('path', { d: 'm15 9-6 6' }),
        h('path', { d: 'm9 9 6 6' }),
      ])
  return h(NTooltip, { trigger: 'hover', placement: 'top' }, {
    trigger: () => h(
      'span',
      {
        class: ['acl-permission-cell', granted ? 'acl-permission-cell--granted' : 'acl-permission-cell--denied'],
        role: 'img',
        'aria-label': stateLabel,
        title: stateLabel,
      },
      [icon],
    ),
    default: () => `${stateLabel}: ${t(`hosts.inventoryAcl.tooltips.${permission}`)}`,
  })
}

function renderPermissionTitle(permission: PermissionKey) {
  const label = t(permission === 'view'
    ? 'hosts.inventoryAcl.view'
    : permission === 'connect'
      ? 'hosts.inventoryAcl.connect'
      : permission === 'edit'
        ? 'hosts.inventoryAcl.edit'
        : 'hosts.inventoryAcl.admin')

  return h(NTooltip, { trigger: 'hover', placement: 'top' }, {
    trigger: () => h('span', {
      class: 'acl-permission-title',
      'aria-label': label,
      title: label,
    }, compactPermissionTitles[permission]),
    default: () => label,
  })
}

function renderPrincipalName(entry: InventoryAclEntryPublic) {
  const label = `${principalTypeLabel(entry.principalType)}: ${principalName(entry)} · ID ${entry.principalId}`
  return h(NTooltip, { trigger: 'hover', placement: 'top' }, {
    trigger: () => h('span', {
      class: 'acl-principal-cell__name',
      'aria-label': label,
      title: label,
    }, [
      h(NText, { strong: true }, { default: () => principalName(entry) }),
    ]),
    default: () => label,
  })
}

const columns = computed<DataTableColumns<InventoryAclEntryPublic>>(() => {
  const baseColumns: DataTableColumns<InventoryAclEntryPublic> = [
    {
      title: t('hosts.inventoryAcl.columns.name'),
      key: 'principalName',
      minWidth: 180,
      render: (entry) => h('div', { class: 'acl-principal-cell' }, [
        h('div', { class: 'acl-principal-cell__title' }, [
          renderPrincipalTypeIcon(entry.principalType),
          renderPrincipalName(entry),
        ]),
      ]),
    },
    {
      title: t('hosts.inventoryAcl.columns.origin'),
      key: 'origin',
      minWidth: 170,
      render: (entry) => h(NText, { depth: 3 }, { default: () => originLabel(entry) }),
    },
    {
      title: () => renderPermissionTitle('view'),
      key: 'view',
      align: 'center',
      width: 76,
      render: (entry) => renderPermissionCell(entry, 'view'),
    },
    {
      title: () => renderPermissionTitle('connect'),
      key: 'connect',
      align: 'center',
      width: 76,
      render: (entry) => renderPermissionCell(entry, 'connect'),
    },
    {
      title: () => renderPermissionTitle('edit'),
      key: 'edit',
      align: 'center',
      width: 76,
      render: (entry) => renderPermissionCell(entry, 'edit'),
    },
    {
      title: () => renderPermissionTitle('admin'),
      key: 'admin',
      align: 'center',
      width: 86,
      render: (entry) => renderPermissionCell(entry, 'admin'),
    },
  ]

  if (!props.showActions) return baseColumns

  return [
    ...baseColumns,
    {
      title: t('hosts.inventoryAcl.columns.actions'),
      key: 'actions',
      width: 96,
      render: (entry) => h(
        NButton,
        {
          size: 'small',
          type: 'error',
          secondary: true,
          disabled: props.actionDisabled,
          onClick: () => emit('revoke', entry),
        },
        { default: () => t('hosts.inventoryAcl.revoke') },
      ),
    },
  ]
})
</script>

<template>
  <NDataTable
    size="small"
    :columns="columns"
    :data="entries"
    :row-key="(entry) => entry.id"
    :bordered="false"
    :single-line="false"
    :pagination="false"
    :scroll-x="820"
  >
    <template #empty>
      <NEmpty :description="emptyDescription" size="small" />
    </template>
  </NDataTable>
</template>

<style scoped>
.acl-principal-cell {
  min-width: 0;
}

.acl-principal-cell__title {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.acl-principal-cell__name {
  display: inline-flex;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acl-principal-cell__name :deep(.n-text) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.acl-permission-cell) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  line-height: 1;
}

:deep(.acl-permission-cell--granted) {
  color: #22c55e;
}

:deep(.acl-permission-cell--denied) {
  color: #ef4444;
  opacity: 0.88;
}

:deep(.acl-permission-icon) {
  display: block;
  width: 16px;
  height: 16px;
}

:deep(.acl-permission-title) {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: nowrap;
}

.acl-principal-type-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: #9ca3af;
  flex-shrink: 0;
}

.acl-principal-type-icon svg {
  width: 14px;
  height: 14px;
}

.acl-principal-type-icon--success {
  color: #a1a1aa;
}

.acl-principal-type-icon--info {
  color: #93c5fd;
}
</style>
