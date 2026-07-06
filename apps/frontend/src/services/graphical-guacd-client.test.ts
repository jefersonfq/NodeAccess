import { describe, expect, it } from 'vitest'
import {
  GuacdClipboardStreamDecoder,
  GuacdDisplayCommandDecoder,
  GuacdInstructionBuffer,
  createGuacdAckResponse,
  createGuacdSyncResponse,
  encodeGuacdInstruction,
  encodeGuacdKey,
  encodeGuacdClipboardText,
  encodeGuacdMouse,
  encodeGuacdSize,
  keysymFromKeyboardEvent,
  resolveGuacdDisplayMetrics,
} from './graphical-guacd-client'

describe('graphical-guacd-client', () => {
  it('encodes Guacamole instructions', () => {
    expect(encodeGuacdInstruction('sync', '123')).toBe('4.sync,3.123;')
  })

  it('parses complete and partial instructions', () => {
    const buffer = new GuacdInstructionBuffer()

    expect(buffer.push('4.sync')).toEqual([])
    expect(buffer.push(',3.123;3.nop;')).toEqual([
      { opcode: 'sync', args: ['123'] },
      { opcode: 'nop', args: [] },
    ])
  })

  it('creates sync response for server sync instruction', () => {
    expect(createGuacdSyncResponse({ opcode: 'sync', args: ['456'] })).toBe('4.sync,3.456;')
    expect(createGuacdSyncResponse({ opcode: 'nop', args: [] })).toBeNull()
  })

  it('creates ack response for server blob instruction', () => {
    expect(createGuacdAckResponse({ opcode: 'blob', args: ['8', 'abc'] })).toBe('3.ack,1.8,2.OK,1.0;')
    expect(createGuacdAckResponse({ opcode: 'sync', args: ['123'] })).toBeNull()
  })

  it('encodes mouse, key and size instructions', () => {
    expect(encodeGuacdMouse(12.4, 20.6, 1)).toBe('5.mouse,2.12,2.21,1.1;')
    expect(encodeGuacdKey(0xff0d, true)).toBe('3.key,5.65293,1.1;')
    expect(encodeGuacdSize(1280, 720, 96)).toBe('4.size,4.1280,3.720,2.96;')
  })

  it('resolves HiDPI display metrics for graphical sessions', () => {
    expect(resolveGuacdDisplayMetrics(1280, 720, 1)).toEqual({
      width: 1280,
      height: 720,
      dpi: 96,
      scale: 1,
    })
    expect(resolveGuacdDisplayMetrics(1280, 720, 1.5)).toEqual({
      width: 1920,
      height: 1080,
      dpi: 144,
      scale: 1.5,
    })
    expect(resolveGuacdDisplayMetrics(1280, 720, 3)).toEqual({
      width: 2560,
      height: 1440,
      dpi: 192,
      scale: 2,
    })
  })

  it('encodes clipboard text stream instructions', () => {
    expect(encodeGuacdClipboardText('olá', 7)).toEqual([
      '9.clipboard,1.7,24.text/plain;charset=utf-8;',
      '4.blob,1.7,8.b2zDoQ==;',
      '3.end,1.7;',
    ])
  })

  it('decodes remote clipboard text stream instructions', () => {
    const decoder = new GuacdClipboardStreamDecoder()

    expect(decoder.decode({ opcode: 'clipboard', args: ['3', 'text/plain;charset=utf-8'] })).toBeNull()
    expect(decoder.decode({ opcode: 'blob', args: ['3', 'b2'] })).toBeNull()
    expect(decoder.decode({ opcode: 'blob', args: ['3', 'zDoQ=='] })).toBeNull()
    expect(decoder.decode({ opcode: 'end', args: ['3'] })).toEqual({
      streamIndex: '3',
      text: 'olá',
    })
  })

  it('ignores non-text clipboard streams', () => {
    const decoder = new GuacdClipboardStreamDecoder()

    expect(decoder.decode({ opcode: 'clipboard', args: ['4', 'image/png'] })).toBeNull()
    expect(decoder.decode({ opcode: 'blob', args: ['4', 'abc'] })).toBeNull()
    expect(decoder.decode({ opcode: 'end', args: ['4'] })).toBeNull()
  })

  it('maps keyboard events to Guacamole keysyms', () => {
    expect(keysymFromKeyboardEvent({ key: 'a' })).toBe(97)
    expect(keysymFromKeyboardEvent({ key: 'Enter' })).toBe(0xff0d)
    expect(keysymFromKeyboardEvent({ key: 'F2' })).toBe(0xffbf)
    expect(keysymFromKeyboardEvent({ key: 'x', ctrlKey: true })).toBe(88)
    expect(keysymFromKeyboardEvent({ key: 'Unidentified' })).toBeNull()
  })

  it('decodes basic display commands', () => {
    const decoder = new GuacdDisplayCommandDecoder()

    expect(decoder.decode({ opcode: 'size', args: ['0', '1024', '768'] })).toEqual({
      type: 'resize',
      layer: '0',
      width: 1024,
      height: 768,
    })
    expect(decoder.decode({ opcode: 'rect', args: ['4', '0', '10', '20', '30', '40'] })).toBeNull()
    expect(decoder.decode({ opcode: 'cfill', args: ['4', '0', '255', '128', '0', '255'] })).toEqual({
      type: 'fillRect',
      layer: '0',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      color: 'rgba(255, 128, 0, 1)',
    })
    expect(decoder.decode({ opcode: 'png', args: ['0', '0', '12', '34', 'abc'] })).toEqual({
      type: 'image',
      layer: '0',
      mimeType: 'image/png',
      x: 12,
      y: 34,
      data: 'abc',
    })
    expect(decoder.decode({ opcode: 'copy', args: ['0', '1', '2', '30', '40', '4', '0', '50', '60'] })).toEqual({
      type: 'copy',
      srcLayer: '0',
      srcX: 1,
      srcY: 2,
      width: 30,
      height: 40,
      dstLayer: '0',
      dstX: 50,
      dstY: 60,
    })
    expect(decoder.decode({ opcode: 'cursor', args: ['1', '2', '-1', '3', '4', '16', '24'] })).toEqual({
      type: 'cursor',
      hotspotX: 1,
      hotspotY: 2,
      srcLayer: '-1',
      srcX: 3,
      srcY: 4,
      width: 16,
      height: 24,
    })
  })

  it('decodes streamed image updates', () => {
    const decoder = new GuacdDisplayCommandDecoder()

    expect(decoder.decode({ opcode: 'img', args: ['8', 'image/png', '4', '0', '12', '34'] })).toBeNull()
    expect(decoder.decode({ opcode: 'blob', args: ['8', 'abc'] })).toBeNull()
    expect(decoder.decode({ opcode: 'blob', args: ['8', '123'] })).toBeNull()
    expect(decoder.decode({ opcode: 'end', args: ['8'] })).toEqual({
      type: 'image',
      layer: '0',
      mimeType: 'image/png',
      x: 12,
      y: 34,
      data: 'abc123',
    })
  })

  it('decodes streamed image updates with any browser image MIME', () => {
    const decoder = new GuacdDisplayCommandDecoder()

    expect(decoder.decode({ opcode: 'img', args: ['9', 'image/webp', '4', '0', '22', '33'] })).toBeNull()
    expect(decoder.decode({ opcode: 'blob', args: ['9', 'webp-data'] })).toBeNull()
    expect(decoder.decode({ opcode: 'end', args: ['9'] })).toEqual({
      type: 'image',
      layer: '0',
      mimeType: 'image/webp',
      x: 22,
      y: 33,
      data: 'webp-data',
    })
  })

  it('decodes streamed image updates without composite mode', () => {
    const decoder = new GuacdDisplayCommandDecoder()

    expect(decoder.decode({ opcode: 'img', args: ['11', 'image/png', '-1', '368', '180'] })).toBeNull()
    expect(decoder.decode({ opcode: 'blob', args: ['11', 'cursor-data'] })).toBeNull()
    expect(decoder.decode({ opcode: 'end', args: ['11'] })).toEqual({
      type: 'image',
      layer: '-1',
      mimeType: 'image/png',
      x: 368,
      y: 180,
      data: 'cursor-data',
    })
  })

  it('decodes streamed image updates defensively when MIME is missing', () => {
    const decoder = new GuacdDisplayCommandDecoder()

    expect(decoder.decode({ opcode: 'img', args: ['10', '4', '0', '44', '55'] })).toBeNull()
    expect(decoder.decode({ opcode: 'blob', args: ['10', 'png-data'] })).toBeNull()
    expect(decoder.decode({ opcode: 'end', args: ['10'] })).toEqual({
      type: 'image',
      layer: '0',
      mimeType: 'image/png',
      x: 44,
      y: 55,
      data: 'png-data',
    })
  })
})
