import { describe, expect, it } from 'vitest'
import { positionTerminalAutocomplete } from './terminal-autocomplete-position.service'

describe('terminal autocomplete positioning', () => {
  it('places the popup immediately above a cursor near the bottom', () => {
    expect(positionTerminalAutocomplete({
      anchor: { left: 240, top: 680, cellHeight: 18 },
      containerWidth: 1000, containerHeight: 720, popupWidth: 320, popupHeight: 210,
    })).toEqual({ left: 240, top: 446, width: 320, placement: 'above' })
  })

  it('falls below the cursor when there is no room above', () => {
    expect(positionTerminalAutocomplete({
      anchor: { left: 20, top: 24, cellHeight: 18 },
      containerWidth: 500, containerHeight: 400, popupWidth: 280, popupHeight: 160,
    })).toEqual({ left: 20, top: 30, width: 280, placement: 'below' })
  })

  it('keeps the popup inside narrow terminal bounds', () => {
    const result = positionTerminalAutocomplete({
      anchor: { left: 370, top: 300, cellHeight: 18 },
      containerWidth: 390, containerHeight: 500, popupWidth: 300, popupHeight: 180,
    })
    expect(result).toEqual({ left: 82, top: 96, width: 300, placement: 'above' })
  })

  it('keeps the whole cursor row unobstructed when placed above', () => {
    const result = positionTerminalAutocomplete({
      anchor: { left: 40, top: 360, cellHeight: 20 },
      containerWidth: 800, containerHeight: 400, popupWidth: 320, popupHeight: 120,
    })
    expect(result.top + 120).toBeLessThanOrEqual(360 - 20 - 6)
  })
})
