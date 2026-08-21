export type SplitResizeAxis = 'column' | 'row'

export interface SplitGridLayout {
  gridTemplateColumns: string
  gridTemplateRows: string
}

export type SplitPaneSlot = string | null

export interface TerminalSplitGroup {
  id: string
  name: string
  hostIds: number[]
}

export function terminalTabDisplayName(tab: { hostName: string; customName?: string }): string {
  return tab.customName?.trim() || tab.hostName
}

const DEFAULT_RATIO = 0.5
const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RATIO
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value))
}

export function normalizeSplitPaneOrder(current: readonly string[], available: readonly string[], limit = 4): string[] {
  const allowed = new Set(available)
  const preserved = current.filter((id, index) => allowed.has(id) && current.indexOf(id) === index)
  const missing = available.filter((id) => !preserved.includes(id))
  return [...preserved, ...missing].slice(0, Math.max(0, limit))
}

export function createSplitPaneSlots(selected: readonly string[], limit = 4): SplitPaneSlot[] {
  return selected.filter((id, index) => Boolean(id) && selected.indexOf(id) === index).slice(0, Math.max(0, limit))
}

export function reconcileSplitPaneSlots(current: readonly SplitPaneSlot[], available: readonly string[]): SplitPaneSlot[] {
  const allowed = new Set(available)
  return current.map((id) => id && allowed.has(id) ? id : null)
}

export function assignSplitPaneSlot(current: readonly SplitPaneSlot[], slotIndex: number, tabId: string): SplitPaneSlot[] {
  if (slotIndex < 0 || slotIndex >= current.length || !tabId) return [...current]
  const next = current.map((id) => id === tabId ? null : id)
  next[slotIndex] = tabId
  return next
}

export function compactSplitPaneSlots(current: readonly SplitPaneSlot[]): SplitPaneSlot[] {
  return current.filter((id): id is string => Boolean(id))
}

export function sanitizeTerminalSplitGroups(value: unknown, limit = 20): TerminalSplitGroup[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const record = candidate as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim().slice(0, 60) : ''
    const hostIds = Array.isArray(record.hostIds)
      ? record.hostIds.filter((id): id is number => Number.isInteger(id) && Number(id) > 0).filter((id, index, all) => all.indexOf(id) === index).slice(0, 4)
      : []
    if (!name || hostIds.length < 2) return []
    return [{ id: typeof record.id === 'string' && record.id ? record.id : `split-${hostIds.join('-')}`, name, hostIds }]
  }).slice(0, Math.max(0, limit))
}

export function moveSplitPane(order: readonly SplitPaneSlot[], sourceId: string, targetId: string): SplitPaneSlot[] {
  if (sourceId === targetId || !order.includes(sourceId) || !order.includes(targetId)) return [...order]
  const next = order.filter((id) => id !== sourceId)
  next.splice(next.indexOf(targetId), 0, sourceId)
  return next
}

export function shiftSplitPane(order: readonly SplitPaneSlot[], paneId: string, delta: -1 | 1): SplitPaneSlot[] {
  const index = order.indexOf(paneId)
  const target = index + delta
  if (index < 0 || target < 0 || target >= order.length) return [...order]
  const next = [...order]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

export function splitRatioFromPointer(axis: SplitResizeAxis, clientX: number, clientY: number, bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): number {
  const size = axis === 'column' ? bounds.width : bounds.height
  if (size <= 0) return DEFAULT_RATIO
  const offset = axis === 'column' ? clientX - bounds.left : clientY - bounds.top
  return clampSplitRatio(offset / size)
}

export function splitGridLayout(count: number, columnRatio: number, rowRatio: number): SplitGridLayout {
  const column = clampSplitRatio(columnRatio) * 100
  const row = clampSplitRatio(rowRatio) * 100
  if (count <= 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }
  if (count === 2) return { gridTemplateColumns: `${column}% ${100 - column}%`, gridTemplateRows: '1fr' }
  return {
    gridTemplateColumns: `${column}% ${100 - column}%`,
    gridTemplateRows: `${row}% ${100 - row}%`,
  }
}
