import { z } from 'zod'

export const TerminalThemeNameSchema = z.enum(['dark', 'dracula', 'solarized', 'one-dark', 'nord', 'tokyo-night'])
export const TerminalPresetSchema = z.enum(['auto', 'windows', 'linux', 'macos', 'custom'])
export const RightClickModeSchema = z.enum(['paste', 'browser-menu', 'host-switcher', 'default'])
export const MultilinePasteModeSchema = z.enum(['always', 'more-than-5', 'never'])
export const SnippetShortcutModeSchema = z.enum(['default', 'ctrl-space', 'disabled'])
export const SnippetPickerViewSchema   = z.enum(['flat', 'grouped'])
export const SnippetPageViewSchema     = z.enum(['flat', 'grouped'])
export const HostSwitcherShortcutModeSchema = z.enum(['default', 'disabled'])
export const HostDisplayModeSchema = z.enum(['cards', 'list'])
export const UiThemeModeSchema = z.enum(['dark', 'light'])

export const UserTerminalPreferencesSchema = z.object({
  preset: TerminalPresetSchema.default('auto'),
  fontSize: z.number().int().min(10).max(24).default(14),
  fontFamily: z.string().min(1).max(255),
  theme: TerminalThemeNameSchema.default('dark'),
  rightClickMode: RightClickModeSchema.default('paste'),
  multilinePasteMode: MultilinePasteModeSchema.default('always'),
  autoFullscreenOnConnect: z.boolean().default(false),
  snippetShortcutMode: SnippetShortcutModeSchema.default('default'),
  hostSwitcherShortcutMode: HostSwitcherShortcutModeSchema.default('default'),
  showTerminalToolbar: z.boolean().default(true),
})

export const UserHostPreferencesSchema = z.object({
  displayMode: HostDisplayModeSchema.default('cards'),
  favoriteHostIds: z.array(z.number().int().positive()).default([]),
  recentHostIds: z.array(z.number().int().positive()).max(8).default([]),
  quickAccessCollapsed: z.boolean().default(false),
  productivityCollapsed: z.boolean().default(false),
})

export const UserSnippetPreferencesSchema = z.object({
  pickerView: SnippetPickerViewSchema.default('flat'),
  pageView:   SnippetPageViewSchema.default('flat'),
})

export const UserPreferencesSchema = z.object({
  ui: z.object({
    themeMode: UiThemeModeSchema.default('dark'),
  }),
  terminal: UserTerminalPreferencesSchema,
  hosts:    UserHostPreferencesSchema,
  snippets: UserSnippetPreferencesSchema.default({}),
})

export const PatchUserPreferencesSchema = z.object({
  ui: z.object({
    themeMode: UiThemeModeSchema.optional(),
  }).optional(),
  terminal: UserTerminalPreferencesSchema.partial().optional(),
  hosts:    UserHostPreferencesSchema.partial().optional(),
  snippets: UserSnippetPreferencesSchema.partial().optional(),
})

export type TerminalThemeName = z.infer<typeof TerminalThemeNameSchema>
export type TerminalPreset = z.infer<typeof TerminalPresetSchema>
export type RightClickMode = z.infer<typeof RightClickModeSchema>
export type MultilinePasteMode = z.infer<typeof MultilinePasteModeSchema>
export type SnippetShortcutMode    = z.infer<typeof SnippetShortcutModeSchema>
export type SnippetPickerView      = z.infer<typeof SnippetPickerViewSchema>
export type SnippetPageView        = z.infer<typeof SnippetPageViewSchema>
export type UserSnippetPreferences = z.infer<typeof UserSnippetPreferencesSchema>
export type HostSwitcherShortcutMode = z.infer<typeof HostSwitcherShortcutModeSchema>
export type HostDisplayMode = z.infer<typeof HostDisplayModeSchema>
export type UiThemeMode = z.infer<typeof UiThemeModeSchema>
export type UserTerminalPreferences = z.infer<typeof UserTerminalPreferencesSchema>
export type UserHostPreferences = z.infer<typeof UserHostPreferencesSchema>
export type UserPreferences = z.infer<typeof UserPreferencesSchema>
export type PatchUserPreferencesDto = z.infer<typeof PatchUserPreferencesSchema>
