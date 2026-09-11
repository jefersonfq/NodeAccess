import { describe, expect, it, vi } from 'vitest'
import { applySshPtyResize } from './ssh-pty-resize'

describe('applySshPtyResize', () => {
  it('maps the browser cols/rows contract to ssh2 setWindow rows/cols', () => {
    const shell = { setWindow: vi.fn() }
    expect(applySshPtyResize(shell as never, 149, 35)).toBe(true)
    expect(shell.setWindow).toHaveBeenCalledOnce()
    expect(shell.setWindow).toHaveBeenCalledWith(35, 149, 0, 0)
  })

  it('does nothing before the shell exists', () => {
    expect(applySshPtyResize(null, 149, 35)).toBe(false)
  })

  it.each([
    [0, 35], [149, 0], [1, 35], [1001, 35], [149, 501],
    [149.5, 35], [149, Number.NaN],
  ])('rejects an unsafe or malformed size (%s x %s)', (cols, rows) => {
    const shell = { setWindow: vi.fn() }
    expect(applySshPtyResize(shell as never, cols, rows)).toBe(false)
    expect(shell.setWindow).not.toHaveBeenCalled()
  })

  it('applies rapid resizes in order so the last browser size prevails', () => {
    const shell = { setWindow: vi.fn() }
    applySshPtyResize(shell as never, 120, 30)
    applySshPtyResize(shell as never, 149, 35)
    expect(shell.setWindow.mock.calls.at(-1)).toEqual([35, 149, 0, 0])
  })
})
