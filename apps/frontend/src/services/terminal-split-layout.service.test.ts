import { describe, expect, it } from 'vitest'
import {
  clampSplitRatio,
  assignSplitPaneSlot,
  compactSplitPaneSlots,
  createSplitPaneSlots,
  moveSplitPane,
  normalizeSplitPaneOrder,
  reconcileSplitPaneSlots,
  sanitizeTerminalSplitGroups,
  splitGridLayout,
  splitRatioFromPointer,
  shiftSplitPane,
  terminalTabDisplayName,
} from './terminal-split-layout.service'

describe('terminal split layout', () => {
  it('preserves visual order, removes closed panes and appends new sessions', () => {
    expect(normalizeSplitPaneOrder(['c', 'a', 'closed'], ['a', 'b', 'c', 'd', 'e'])).toEqual(['c', 'a', 'b', 'd'])
  })

  it('moves a pane before its drop target without duplicating sessions', () => {
    expect(moveSplitPane(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(moveSplitPane(['a', 'b'], 'a', 'missing')).toEqual(['a', 'b'])
  })

  it('moves panes one position using accessible controls and respects boundaries', () => {
    expect(shiftSplitPane(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(shiftSplitPane(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(shiftSplitPane(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
  })

  it('clamps proportions so every terminal remains usable', () => {
    expect(clampSplitRatio(-1)).toBe(0.2)
    expect(clampSplitRatio(0.62)).toBe(0.62)
    expect(clampSplitRatio(4)).toBe(0.8)
    expect(clampSplitRatio(Number.NaN)).toBe(0.5)
  })

  it('calculates horizontal and vertical ratios from pointer coordinates', () => {
    const bounds = { left: 100, top: 50, width: 1000, height: 600 }
    expect(splitRatioFromPointer('column', 700, 0, bounds)).toBe(0.6)
    expect(splitRatioFromPointer('row', 0, 200, bounds)).toBe(0.25)
    expect(splitRatioFromPointer('column', 50, 0, bounds)).toBe(0.2)
  })

  it('builds two- and four-pane grids from independent proportions', () => {
    expect(splitGridLayout(2, 0.6, 0.3)).toEqual({ gridTemplateColumns: '60% 40%', gridTemplateRows: '1fr' })
    expect(splitGridLayout(4, 0.6, 0.3)).toEqual({ gridTemplateColumns: '60% 40%', gridTemplateRows: '30% 70%' })
  })

  it('keeps a custom tab label separate from the real host name', () => {
    expect(terminalTabDisplayName({ hostName: 'srv-prod', customName: 'Banco primário' })).toBe('Banco primário')
    expect(terminalTabDisplayName({ hostName: 'srv-prod', customName: '   ' })).toBe('srv-prod')
  })

  it('keeps empty split slots stable instead of pulling the next available tab', () => {
    expect(reconcileSplitPaneSlots(['a', 'b', 'c', 'd'], ['a', 'c', 'd', 'e'])).toEqual(['a', null, 'c', 'd'])
  })

  it('creates explicit unique slots and replaces a slot without duplicating a session', () => {
    expect(createSplitPaneSlots(['a', 'b', 'a', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd'])
    expect(assignSplitPaneSlot(['a', null, 'c', 'd'], 1, 'd')).toEqual(['a', 'd', 'c', null])
  })

  it('only compacts slots after an explicit action', () => {
    expect(compactSplitPaneSlots(['a', null, 'c', null])).toEqual(['a', 'c'])
  })

  it('sanitizes persisted groups and limits them to four unique hosts', () => {
    expect(sanitizeTerminalSplitGroups([{ id: 'ops', name: ' Operação ', hostIds: [1, 2, 2, 3, 4, 5] }, { name: '', hostIds: [1, 2] }])).toEqual([
      { id: 'ops', name: 'Operação', hostIds: [1, 2, 3, 4] },
    ])
  })
})
