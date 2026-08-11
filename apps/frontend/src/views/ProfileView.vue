<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { NCard, NForm, NFormItem, NInput, NButton, NAlert, NDivider, NText, NSelect, NInputNumber, NSwitch, NCollapse, NCollapseItem, useDialog, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { termSettings, setAutoFullscreenOnConnect, setGraphicalOpenMode, setShowTerminalToolbar, setFontSize, setMultilinePasteMode, setTheme, setRightClickMode, setTerminalSidebarRailPosition, applyTerminalPreset, resetTerminalPreferences, presetOptions, themeOptions, rightClickModeOptions, multilinePasteModeOptions } from '@/composables/useTerminal'
import { usePlatform, setSnippetShortcutMode, resetSnippetShortcutMode, snippetShortcutModeOptions, setHostSwitcherShortcutMode, resetHostSwitcherShortcutMode, hostSwitcherShortcutModeOptions } from '@/composables/usePlatform'
import {
  hostDisplayMode,
  setHostDisplayMode,
  hostsDefaultView,
  setHostsDefaultView,
  homeMaxFavorites,
  setHomeMaxFavorites,
  homeMaxRecents,
  setHomeMaxRecents,
  hostsSidebarWidth,
  HOSTS_SIDEBAR_MAX_WIDTH,
  HOSTS_SIDEBAR_MIN_WIDTH,
  setHostsSidebarWidth,
  foldersPanelExpandedPreference,
  groupsPanelExpandedPreference,
  tagsPanelExpandedPreference,
  setFoldersPanelExpandedPreference,
  setGroupsPanelExpandedPreference,
  setTagsPanelExpandedPreference,
} from '@/services/host-view-preferences.service'
import { snippetPickerView, setSnippetPickerView, snippetPageView, setSnippetPageView } from '@/services/snippet-view-preferences.service'
import { userService } from '@/services/user.service'
import UserAvatar from '@/components/UserAvatar.vue'
import AvatarCropModal from '@/components/AvatarCropModal.vue'
import { AVATAR_MAX_SOURCE_BYTES, isAcceptedAvatarType } from '@/services/avatar-image-processing'

const { t } = useI18n()
const auth    = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const loading = ref(false)
const logoutAllLoading = ref(false)
const avatarUploading = ref(false)
const selectedAvatarFile = ref<File | null>(null)
const showAvatarCrop = ref(false)
const error   = ref<string | null>(null)
const success  = ref(false)
const { platform, snippetShortcutMode, hostSwitcherShortcutMode } = usePlatform()

const form = ref({ currentPassword: '', newPassword: '', confirm: '' })
const avatarInput = ref<HTMLInputElement | null>(null)
const passwordPanelExpanded = ref<string[]>(auth.user?.forcePasswordChange ? ['password'] : [])
const hostDisplayModeOptions = computed(() => [
  { label: t('profile.hosts.modes.cards'), value: 'cards' },
  { label: t('profile.hosts.modes.list'), value: 'list' },
])
const hostsDefaultViewOptions = computed(() => [
  { label: t('profile.hosts.defaultViews.home'), value: 'home' },
  { label: t('profile.hosts.defaultViews.list'), value: 'list' },
])
const snippetViewModeOptions = computed(() => [
  { label: t('profile.snippets.modes.flat'), value: 'flat' },
  { label: t('profile.snippets.modes.grouped'), value: 'grouped' },
])
const autoFullscreenOptions = computed(() => [
  { label: t('common.no'), value: 'disabled' },
  { label: t('common.yes'), value: 'enabled' },
])
const terminalSidebarRailPositionOptions = computed(() => [
  { label: t('profile.terminal.sidebarRailPositions.right'), value: 'right' },
  { label: t('profile.terminal.sidebarRailPositions.left'), value: 'left' },
])
const graphicalOpenModeOptions = computed(() => [
  { label: t('profile.terminal.graphicalOpenModes.dedicated'), value: 'dedicated' },
  { label: t('profile.terminal.graphicalOpenModes.tab'), value: 'tab' },
])
const uiThemeModeOptions = computed(() => [
  { label: t('profile.ui.themeModes.dark'), value: 'dark' },
  { label: t('profile.ui.themeModes.light'), value: 'light' },
])
const autoCollapseSidebarOnTerminalOptions = computed(() => [
  { label: t('common.no'), value: 'disabled' },
  { label: t('common.yes'), value: 'enabled' },
])
const autoFullscreenValue = computed(() => (termSettings.autoFullscreenOnConnect ? 'enabled' : 'disabled'))
const autoCollapseSidebarOnTerminalValue = computed(() => (ui.autoCollapseSidebarOnTerminal ? 'enabled' : 'disabled'))
const requiresCurrentPassword = computed(() => !auth.user?.forcePasswordChange)

function openAvatarPicker() {
  avatarInput.value?.click()
}

async function uploadAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!isAcceptedAvatarType(file.type)) {
    message.error(t('profile.avatar.invalidType'))
    return
  }
  if (file.size > AVATAR_MAX_SOURCE_BYTES) {
    message.error(t('profile.avatar.sourceFileTooLarge'))
    return
  }
  selectedAvatarFile.value = file
  showAvatarCrop.value = true
}

function closeAvatarCrop() {
  if (avatarUploading.value) return
  showAvatarCrop.value = false
  selectedAvatarFile.value = null
}

async function confirmAvatarCrop(file: File) {
  avatarUploading.value = true
  try {
    const { data } = await userService.updateOwnAvatar(file)
    auth.updateProfileUser(data)
    message.success(t('profile.avatar.updated'))
    showAvatarCrop.value = false
    selectedAvatarFile.value = null
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    message.error(e.response?.data?.message ?? t('profile.avatar.updateError'))
  } finally {
    avatarUploading.value = false
  }
}

async function removeAvatar() {
  avatarUploading.value = true
  try {
    const { data } = await userService.removeOwnAvatar()
    auth.updateProfileUser(data)
    message.success(t('profile.avatar.removed'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    message.error(e.response?.data?.message ?? t('profile.avatar.removeError'))
  } finally {
    avatarUploading.value = false
  }
}

function updateHostDisplayPreference(value: 'cards' | 'list') {
  setHostDisplayMode(value)
}

function updateHostsDefaultView(value: 'home' | 'list') {
  setHostsDefaultView(value)
}

function resetTerminalLocalPreferences() {
  resetTerminalPreferences()
  resetSnippetShortcutMode()
  resetHostSwitcherShortcutMode()
}

const detectedPlatformLabel = computed(() => {
  if (platform === 'macos') return 'macOS'
  if (platform === 'windows') return 'Windows'
  return 'Linux'
})

async function changePassword() {
  error.value   = null
  success.value = false

  if (form.value.newPassword !== form.value.confirm) {
    error.value = t('profile.passwordMismatch')
    return
  }

  if (requiresCurrentPassword.value && !form.value.currentPassword) {
    error.value = t('profile.currentPasswordRequired')
    return
  }

  loading.value = true
  try {
    await userService.changePassword(
      form.value.newPassword,
      requiresCurrentPassword.value ? form.value.currentPassword : undefined,
    )
    const refreshed = await auth.refresh()
    if (!refreshed) {
      auth.markPasswordChanged()
    }
    success.value = true
    form.value    = { currentPassword: '', newPassword: '', confirm: '' }
    if (!auth.user?.forcePasswordChange) {
      router.push({ name: 'hosts' })
    }
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    error.value = e.response?.data?.message ?? t('profile.changeError')
  } finally {
    loading.value = false
  }
}

function confirmLogoutAll() {
  dialog.warning({
    title: t('profile.sessions.confirmTitle'),
    content: t('profile.sessions.confirmDescription'),
    positiveText: t('profile.sessions.confirmAction'),
    negativeText: t('common.cancel'),
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      logoutAllLoading.value = true
      try {
        await auth.logoutAll()
        await router.replace({ name: 'login' })
      } catch {
        message.error(t('profile.sessions.error'))
        logoutAllLoading.value = false
        return false
      }
    },
  })
}
</script>

<template>
  <div class="p-6 max-w-3xl">
    <h1 class="text-xl font-semibold text-white mb-6">{{ $t('profile.title') }}</h1>

    <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mb-4">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 items-center gap-4">
          <UserAvatar :user="auth.user" :size="64" />
          <div class="min-w-0">
            <NText strong class="block truncate">{{ auth.user?.name }}</NText>
            <NText depth="3" class="text-sm">{{ auth.user?.email }}</NText>
            <div class="mt-1 text-xs text-gray-500">{{ $t('profile.avatar.help') }}</div>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <input
            ref="avatarInput"
            class="hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            @change="uploadAvatar"
          >
          <NButton secondary :loading="avatarUploading" @click="openAvatarPicker">
            {{ $t('profile.avatar.upload') }}
          </NButton>
          <NButton v-if="auth.user?.avatarUrl" secondary :disabled="avatarUploading" @click="removeAvatar">
            {{ $t('profile.avatar.remove') }}
          </NButton>
        </div>
      </div>
    </NCard>

    <AvatarCropModal
      :show="showAvatarCrop"
      :file="selectedAvatarFile"
      @close="closeAvatarCrop"
      @confirm="confirmAvatarCrop"
    />

    <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mt-4" :title="$t('profile.terminal.title')">
      <NForm label-placement="top" class="mb-4">
        <NFormItem :label="$t('profile.ui.theme')">
          <NSelect
            :value="ui.themeMode"
            :options="uiThemeModeOptions"
            @update:value="(v) => ui.setThemeMode(v)"
          />
        </NFormItem>
        <NFormItem :label="$t('profile.ui.autoCollapseSidebarOnTerminal')">
          <NSelect
            :value="autoCollapseSidebarOnTerminalValue"
            :options="autoCollapseSidebarOnTerminalOptions"
            @update:value="(v) => ui.setAutoCollapseSidebarOnTerminal(v === 'enabled')"
          />
        </NFormItem>
      </NForm>

      <div class="mb-4 text-sm text-gray-400">
        {{ $t('profile.terminal.description', { platform: detectedPlatformLabel }) }}
      </div>

      <NForm label-placement="top">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NFormItem :label="$t('profile.terminal.preset')">
            <NSelect
              :value="termSettings.preset"
              :options="presetOptions"
              @update:value="(v) => applyTerminalPreset(v)"
            />
          </NFormItem>

          <NFormItem :label="$t('profile.terminal.theme')">
            <NSelect
              :value="termSettings.theme"
              :options="themeOptions"
              @update:value="(v) => setTheme(v)"
            />
          </NFormItem>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NFormItem :label="$t('profile.terminal.fontSize')">
            <div class="flex items-center gap-2">
              <NButton @click="setFontSize(termSettings.fontSize - 1)">A-</NButton>
              <div class="min-w-[72px] text-center text-sm text-gray-300">
                {{ termSettings.fontSize }}px
              </div>
              <NButton @click="setFontSize(termSettings.fontSize + 1)">A+</NButton>
            </div>
          </NFormItem>

          <NFormItem :label="$t('profile.terminal.fontFamily')">
            <div class="text-sm text-gray-300 break-all">
              {{ termSettings.fontFamily }}
            </div>
          </NFormItem>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NFormItem :label="$t('profile.terminal.rightClick')">
            <NSelect
              :value="termSettings.rightClickMode"
              :options="rightClickModeOptions.map((option) => ({
                value: option.value,
                label: $t(`profile.terminal.rightClickModes.${option.value}`),
              }))"
              @update:value="(v) => setRightClickMode(v)"
            />
          </NFormItem>

          <NFormItem :label="$t('profile.terminal.multilinePaste')">
            <NSelect
              :value="termSettings.multilinePasteMode"
              :options="multilinePasteModeOptions.map((option) => ({
                value: option.value,
                label: $t(`profile.terminal.multilinePasteModes.${option.value}`),
              }))"
              @update:value="(v) => setMultilinePasteMode(v)"
            />
          </NFormItem>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NFormItem :label="$t('profile.terminal.snippetShortcut')">
            <NSelect
              :value="snippetShortcutMode"
              :options="snippetShortcutModeOptions.map((option) => ({
                value: option.value,
                label: $t(`profile.terminal.snippetShortcutModes.${option.value}`),
              }))"
              @update:value="(v) => setSnippetShortcutMode(v)"
            />
          </NFormItem>

          <NFormItem :label="$t('profile.terminal.autoFullscreen')">
            <NSelect
              :value="autoFullscreenValue"
              :options="autoFullscreenOptions"
              @update:value="(v) => setAutoFullscreenOnConnect(v === 'enabled')"
            />
          </NFormItem>

          <NFormItem :label="$t('profile.terminal.showToolbar')">
            <NSelect
              :value="termSettings.showTerminalToolbar ? 'show' : 'hide'"
              :options="[
                { label: $t('profile.terminal.showToolbarOptions.show'), value: 'show' },
                { label: $t('profile.terminal.showToolbarOptions.hide'), value: 'hide' },
              ]"
              @update:value="(v) => setShowTerminalToolbar(v === 'show')"
            />
          </NFormItem>

          <NFormItem :label="$t('profile.terminal.graphicalOpenMode')">
            <NSelect
              :value="termSettings.graphicalOpenMode"
              :options="graphicalOpenModeOptions"
              @update:value="(v) => setGraphicalOpenMode(v)"
            />
          </NFormItem>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NFormItem :label="$t('profile.terminal.sidebarRailPosition')">
            <NSelect
              :value="termSettings.sidebarRailPosition"
              :options="terminalSidebarRailPositionOptions"
              @update:value="(v) => setTerminalSidebarRailPosition(v)"
            />
          </NFormItem>

          <NFormItem :label="$t('profile.terminal.hostSwitcherShortcut')">
            <NSelect
              :value="hostSwitcherShortcutMode"
              :options="hostSwitcherShortcutModeOptions.map((option) => ({
                value: option.value,
                label: $t(`profile.terminal.hostSwitcherShortcutModes.${option.value}`),
              }))"
              @update:value="(v) => setHostSwitcherShortcutMode(v)"
            />
          </NFormItem>
        </div>
      </NForm>

      <div class="mt-4 flex items-center gap-2">
        <NButton type="primary" secondary @click="applyTerminalPreset(platform)">
          {{ $t('profile.terminal.applyRecommended', { platform: detectedPlatformLabel }) }}
        </NButton>
        <NButton quaternary @click="resetTerminalLocalPreferences">
          {{ $t('profile.terminal.reset') }}
        </NButton>
        <NText depth="3" class="text-xs">
          {{ $t('profile.terminal.localOnly') }}
        </NText>
      </div>
    </NCard>

    <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mt-4" :title="$t('profile.hosts.title')">
      <div class="mb-4 text-sm text-gray-400">
        {{ $t('profile.hosts.description') }}
      </div>

      <NForm label-placement="top">
        <NFormItem :label="$t('profile.hosts.displayMode')">
          <NSelect
            :value="hostDisplayMode"
            :options="hostDisplayModeOptions"
            @update:value="updateHostDisplayPreference"
          />
        </NFormItem>
        <NFormItem :label="$t('profile.hosts.defaultView')">
          <NSelect
            :value="hostsDefaultView"
            :options="hostsDefaultViewOptions"
            @update:value="updateHostsDefaultView"
          />
        </NFormItem>
        <NFormItem :label="$t('profile.hosts.foldersPanelExpanded')">
          <NSwitch
            :value="foldersPanelExpandedPreference"
            @update:value="setFoldersPanelExpandedPreference"
          />
        </NFormItem>
        <NFormItem :label="$t('profile.hosts.groupsPanelExpanded')">
          <NSwitch
            :value="groupsPanelExpandedPreference"
            @update:value="setGroupsPanelExpandedPreference"
          />
        </NFormItem>
        <NFormItem :label="$t('profile.hosts.tagsPanelExpanded')">
          <NSwitch
            :value="tagsPanelExpandedPreference"
            @update:value="setTagsPanelExpandedPreference"
          />
        </NFormItem>
        <NFormItem :label="$t('profile.hosts.homeMaxFavorites')">
          <NInputNumber
            :value="homeMaxFavorites"
            :min="5"
            :max="30"
            :step="1"
            style="width: 120px"
            @update:value="(v) => v !== null && setHomeMaxFavorites(v)"
          />
        </NFormItem>
        <NFormItem :label="$t('profile.hosts.homeMaxRecents')">
          <NInputNumber
            :value="homeMaxRecents"
            :min="5"
            :max="30"
            :step="1"
            style="width: 120px"
            @update:value="(v) => v !== null && setHomeMaxRecents(v)"
          />
        </NFormItem>
        <NFormItem :label="$t('profile.hosts.sidebarWidth')">
          <NInputNumber
            :value="hostsSidebarWidth"
            :min="HOSTS_SIDEBAR_MIN_WIDTH"
            :max="HOSTS_SIDEBAR_MAX_WIDTH"
            :step="8"
            style="width: 140px"
            @update:value="(v) => v !== null && setHostsSidebarWidth(v)"
          />
          <template #feedback>
            {{ $t('profile.hosts.sidebarWidthHelp') }}
          </template>
        </NFormItem>
      </NForm>

      <div class="mt-2">
        <NText depth="3" class="text-xs">
          {{ $t('profile.hosts.localOnly') }}
        </NText>
      </div>
    </NCard>

    <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mt-4" :title="$t('profile.snippets.title')">
      <div class="mb-4 text-sm text-gray-400">
        {{ $t('profile.snippets.description') }}
      </div>

      <NForm label-placement="top">
        <NFormItem :label="$t('profile.snippets.pageView')">
          <NSelect
            :value="snippetPageView"
            :options="snippetViewModeOptions"
            @update:value="(v: 'flat' | 'grouped') => setSnippetPageView(v)"
          />
        </NFormItem>
        <NFormItem :label="$t('profile.snippets.pickerView')">
          <NSelect
            :value="snippetPickerView"
            :options="snippetViewModeOptions"
            @update:value="(v: 'flat' | 'grouped') => setSnippetPickerView(v)"
          />
        </NFormItem>
      </NForm>

      <div class="mt-2">
        <NText depth="3" class="text-xs">
          {{ $t('profile.snippets.localOnly') }}
        </NText>
      </div>
    </NCard>

    <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mt-4">
      <NCollapse v-model:expanded-names="passwordPanelExpanded" arrow-placement="right">
        <NCollapseItem :title="$t('profile.changePassword')" name="password">
          <NAlert
            v-if="auth.user?.forcePasswordChange"
            type="warning"
            class="mb-4"
            :title="$t('profile.forceChangeTitle')"
            :description="$t('profile.forceChangeDesc')"
          />
          <NAlert v-if="error"   type="error"   class="mb-4" :title="error" />
          <NAlert v-if="success" type="success" class="mb-4" :title="$t('profile.successTitle')" />

          <NForm @submit.prevent="changePassword">
            <NFormItem v-if="requiresCurrentPassword" :label="$t('profile.currentPassword')">
              <NInput
                v-model:value="form.currentPassword"
                type="password"
                show-password-on="click"
                autocomplete="current-password"
              />
            </NFormItem>
            <NFormItem :label="$t('profile.newPassword')">
              <NInput
                v-model:value="form.newPassword"
                type="password"
                show-password-on="click"
                autocomplete="new-password"
              />
            </NFormItem>
            <NFormItem :label="$t('profile.confirmPassword')">
              <NInput
                v-model:value="form.confirm"
                type="password"
                show-password-on="click"
                autocomplete="new-password"
              />
            </NFormItem>
            <NButton type="primary" :loading="loading" @click="changePassword">
              {{ $t('profile.submit') }}
            </NButton>
          </NForm>
        </NCollapseItem>
      </NCollapse>
    </NCard>

    <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mt-4" :title="$t('profile.sessions.title')">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="max-w-xl text-sm text-gray-400">
          {{ $t('profile.sessions.description') }}
        </div>
        <NButton
          secondary
          type="error"
          :loading="logoutAllLoading"
          @click="confirmLogoutAll"
        >
          {{ $t('profile.sessions.action') }}
        </NButton>
      </div>
    </NCard>
  </div>
</template>
