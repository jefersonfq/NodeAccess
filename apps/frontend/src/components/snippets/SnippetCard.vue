<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NDropdown, NTag, NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
  deserializeSnippetCommand,
  snippetPreview,
  getSnippetSecretAliases,
  type Snippet,
} from '@/services/snippet.service'

import type { SnippetCardMeta } from './snippet-card-meta'

const props = defineProps<{
  favorite?: boolean
  snippet: Snippet
  owner: boolean
  showGroup?: boolean
  meta?: SnippetCardMeta
}>()

const emit = defineEmits<{
  favorite: []
  copy: [snippet: Snippet]
  duplicate: [snippet: Snippet]
  edit: [snippet: Snippet]
  remove: [snippet: Snippet]
}>()

const { t } = useI18n()

const parsed = computed(() => deserializeSnippetCommand(props.snippet.command))
const kind = computed(() => props.meta?.kind ?? parsed.value.kind)
const secretAliases = computed(() => props.meta?.secretAliases ?? getSnippetSecretAliases(props.snippet))

const preview = computed(() => {
  if (props.meta) return props.meta.preview
  return snippetPreview(parsed.value, type => t('snippets.macro.' + type))
})

const stepCount = computed(() =>
  props.meta?.stepCount
  ?? (parsed.value.kind === 'SEQUENCE'
      ? parsed.value.steps.length
      : parsed.value.kind === 'EXPECT_SEND'
        ? parsed.value.expectSteps.length
        : parsed.value.actions?.length ?? 1),
)

const kindLabel = computed(() =>
  kind.value === 'MACRO' ? t('snippets.kind.macro') : kind.value === 'SEQUENCE'
    ? t('snippets.kind.sequence')
    : kind.value === 'EXPECT_SEND'
      ? t('snippets.kind.expectSend')
      : t('snippets.kind.command'),
)

const kindTagType = computed(() =>
  kind.value === 'SEQUENCE' ? 'success' : kind.value === 'EXPECT_SEND' ? 'warning' : 'primary',
)
const actions = computed(() => [
  { key: 'duplicate', label: t('snippetsPage.duplicate') },
  ...(props.owner ? [{ key: 'edit', label: t('common.edit') }, { key: 'remove', label: t('common.delete') }] : []),
])
function selectAction(key: string): void {
  if (key === 'duplicate') emit('duplicate', props.snippet)
  else if (key === 'edit' && props.owner) emit('edit', props.snippet)
  else if (key === 'remove' && props.owner) emit('remove', props.snippet)
}
</script>

<template>
  <article class="snippet-card">
    <div class="snippet-card__body">
      <div class="snippet-card__meta">
        <span class="snippet-card__name">{{ snippet.name }}</span>
        <NTag
          size="tiny"
          :type="snippet.scope === 'TEAM' ? 'info' : 'default'"
        >
          {{ snippet.scope === 'TEAM' ? t('snippets.scopeTeam') : t('snippets.scopePersonal') }}
        </NTag>
        <NTag
          v-if="showGroup && snippet.group"
          size="tiny"
          type="primary"
        >
          {{ snippet.group.name }}
        </NTag>
        <NTag
          size="tiny"
          :type="kindTagType"
        >
          {{ kindLabel }}
        </NTag>
        <span
          v-if="kind !== 'COMMAND'"
          class="snippet-card__steps"
        >
          {{ stepCount }} {{ t('snippets.stepsShort') }}
        </span>
        <NTooltip
          v-if="secretAliases.length > 0"
          trigger="hover"
        >
          <template #trigger>
            <NTag
              size="tiny"
              type="warning"
            >
              {{ t('snippets.usesSecret') }}
            </NTag>
          </template>
          {{ t('snippets.usesSecretAliases', { aliases: secretAliases.join(', ') }) }}
        </NTooltip>
      </div>

      <pre class="snippet-card__preview">{{ preview }}</pre>

      <p
        v-if="snippet.description"
        class="snippet-card__description"
      >
        {{ snippet.description }}
      </p>
      <p class="snippet-card__owner">
        {{ t('snippetsPage.by') }} {{ snippet.createdBy.name }}
      </p>
    </div>

    <div class="snippet-card__actions">
      <NButton
        size="small"
        :aria-label="t('snippets.macro.favorite')"
        :aria-pressed="!!favorite"
        @click="emit('favorite')"
      >
        {{ favorite ? '★' : '☆' }}
      </NButton>
      <NButton
        size="small"
        secondary
        @click="emit('copy', snippet)"
      >
        {{ t(kind === 'COMMAND' || kind === 'SEQUENCE' ? 'snippetsPage.copyCommand' : 'snippets.macro.copyMacro') }}
      </NButton>
      <NDropdown
        trigger="click"
        :options="actions"
        @select="selectAction"
      >
        <NButton
          size="small"
          :aria-label="t('snippets.macro.moreActions', { name: snippet.name })"
        >
          ⋯
        </NButton>
      </NDropdown>
    </div>
  </article>
</template>

<style scoped>
.snippet-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 12px 16px;
  border: 1px solid var(--na-border);
  border-radius: 8px;
  background: var(--na-surface-soft);
  transition: border-color 0.15s ease;
}

.snippet-card:hover,
.snippet-card:focus-within {
  border-color: var(--na-border-strong);
}

.snippet-card__body {
  min-width: 0;
}

.snippet-card__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.snippet-card__name {
  color: var(--na-text-strong);
  font-size: 14px;
  font-weight: 600;
}

.snippet-card__steps,
.snippet-card__owner {
  color: var(--na-text-subtle);
  font-size: 11px;
}

.snippet-card__preview {
  margin: 0 0 6px;
  padding: 7px 8px;
  border-radius: 6px;
  background: var(--na-surface-code);
  color: var(--na-text-strong);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.snippet-card__description {
  margin: 0 0 4px;
  color: var(--na-text-muted);
  font-size: 12px;
}

.snippet-card__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  min-width: 132px;
}

@media (max-width: 720px) {
  .snippet-card {
    grid-template-columns: 1fr;
  }

  .snippet-card__actions {
    justify-content: flex-start;
    min-width: 0;
  }
}
</style>
