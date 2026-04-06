<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NSpace, NSpin, NAlert, NTooltip } from 'naive-ui'
import { sftpService } from '@/services/sftp.service'
import { usePlatform } from '@/composables/usePlatform'
import loader from '@monaco-editor/loader'

const props = defineProps<{
  hostId:   number
  filePath: string
  fileName: string
}>()

const emit = defineEmits<{ close: []; saved: [] }>()
const { t } = useI18n()
const { shortcuts } = usePlatform()

// ── State ──────────────────────────────────────────────────────────────────

const loading         = ref(true)
const saving          = ref(false)
const errorMsg        = ref<string | null>(null)
const truncated       = ref(false)
const isDirty         = ref(false)
const originalContent = ref('')
const editorEl        = ref<HTMLElement | null>(null)

let monacoEditor: any = null
let monacoApi: any    = null

// ── Language ───────────────────────────────────────────────────────────────

function detectLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    vue: 'html', py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', php: 'php', cs: 'csharp', cpp: 'cpp', c: 'c',
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini',
    xml: 'xml', html: 'html', css: 'css', scss: 'scss', less: 'less',
    md: 'markdown', sql: 'sql', conf: 'ini', env: 'ini',
    dockerfile: 'dockerfile',
  }
  return map[ext] ?? 'plaintext'
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  loading.value  = true
  errorMsg.value = null
  try {
    const { data } = await sftpService.readFile(props.hostId, props.filePath)
    originalContent.value = data.content
    truncated.value       = data.truncated

    // Wait for DOM then mount editor
    await new Promise<void>((resolve) => {
      const check = () => editorEl.value ? resolve() : requestAnimationFrame(check)
      check()
    })

    monacoApi = await loader.init()
    monacoEditor = monacoApi.editor.create(editorEl.value!, {
      value:               data.content,
      language:            detectLanguage(props.fileName),
      theme:               'vs-dark',
      automaticLayout:     true,
      minimap:             { enabled: false },
      fontSize:            13,
      tabSize:             2,
      wordWrap:            'on',
      scrollBeyondLastLine: false,
      fontFamily:          'Menlo, Monaco, "Courier New", monospace',
    })

    monacoEditor.onDidChangeModelContent(() => {
      isDirty.value = monacoEditor.getValue() !== originalContent.value
    })

    // Ctrl/Cmd+S to save
    monacoEditor.addCommand(
      monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS,
      () => save(),
    )
  } catch {
    errorMsg.value = t('fileEditor.loadError')
  } finally {
    loading.value = false
  }
}

// ── Save ───────────────────────────────────────────────────────────────────

async function save() {
  if (!monacoEditor || saving.value) return
  saving.value   = true
  errorMsg.value = null
  try {
    const content = monacoEditor.getValue()
    await sftpService.writeFile(props.hostId, props.filePath, content)
    originalContent.value = content
    isDirty.value         = false
    emit('saved')
  } catch {
    errorMsg.value = t('fileEditor.saveError')
  } finally {
    saving.value = false
  }
}

// ── Close ──────────────────────────────────────────────────────────────────

function tryClose() {
  if (isDirty.value && !window.confirm(t('fileEditor.unsavedConfirm'))) return
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !isDirty.value) emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  init()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  monacoEditor?.dispose()
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[300] flex flex-col bg-[#1e1e1e]">

      <!-- ── Header ─────────────────────────────────────────────────────── -->
      <div class="flex items-center gap-3 px-4 py-2 bg-[#1a1b1e] border-b border-gray-800 shrink-0">
        <span class="text-sm font-mono text-gray-300 truncate flex-1">
          {{ filePath }}
          <span v-if="isDirty" class="ml-1 text-yellow-400 text-xs">●</span>
        </span>

        <span
          v-if="truncated"
          class="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded"
        >{{ $t('fileEditor.truncated') }}</span>

        <NSpace size="small">
          <NTooltip trigger="hover" placement="bottom">
            <template #trigger>
              <NButton
                size="small"
                type="primary"
                :loading="saving"
                :disabled="!isDirty || saving"
                @click="save"
              >{{ $t('fileEditor.save') }}</NButton>
            </template>
            <span class="text-xs font-mono">{{ shortcuts.save }}</span>
          </NTooltip>
          <NButton size="small" @click="tryClose">{{ $t('common.cancel') }}</NButton>
        </NSpace>
      </div>

      <!-- ── Loading / Error ────────────────────────────────────────────── -->
      <div v-if="loading" class="flex-1 flex items-center justify-center">
        <NSpin size="large" />
      </div>

      <NAlert
        v-if="errorMsg && !loading"
        type="error"
        :title="errorMsg"
        class="m-4 shrink-0"
      >
        <NButton size="small" @click="init">{{ $t('fileManager.retry') }}</NButton>
      </NAlert>

      <!-- ── Monaco Editor ──────────────────────────────────────────────── -->
      <div
        v-show="!loading && !errorMsg"
        ref="editorEl"
        class="flex-1 min-h-0"
      />

    </div>
  </Teleport>
</template>
