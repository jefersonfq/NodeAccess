#!/usr/bin/env node
'use strict'
// Opt-in canvas checks. No probes are added to the application/session flow.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

async function main() {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: true,
    args: ['--no-sandbox'],
  })
  try {
    const page = await browser.newPage()
    await page.goto(process.env.FRONTEND_URL || 'http://127.0.0.1:5173')
    const result = await page.evaluate(async () => {
      const { guacdChannelMaskToCompositeOperation: operation, GuacdDisplayCommandDecoder } = await import('/src/services/graphical-guacd-client.ts')
      const canvas = document.createElement('canvas')
      canvas.width = 4
      canvas.height = 2
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const pixel = (x = 0, y = 0) => [...ctx.getImageData(x, y, 1, 1).data]
      const reset = () => {
        ctx.globalCompositeOperation = 'source-over'
        ctx.clearRect(0, 0, 4, 2)
        ctx.fillStyle = '#ff0000'
        ctx.fillRect(0, 0, 4, 2)
      }
      const samples = {}
      for (const [mask, color] of [[2, '#000000'], [9, 'rgba(0,0,0,0)'], [14, '#0000ff'], [12, 'rgba(0,0,0,0)']]) {
        reset()
        ctx.save()
        ctx.globalCompositeOperation = operation(mask)
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        ctx.restore()
        samples[mask] = pixel()
        samples[`state-${mask}`] = ctx.globalCompositeOperation
      }
      // The same wire path combines rectangles without losing another layer's path.
      reset()
      const decoder = new GuacdDisplayCommandDecoder()
      decoder.decode({ opcode: 'rect', args: ['0', '0', '0', '1', '1'] })
      decoder.decode({ opcode: 'rect', args: ['-2', '0', '0', '1', '1'] })
      decoder.decode({ opcode: 'rect', args: ['0', '2', '0', '1', '1'] })
      const command = decoder.decode({ opcode: 'cfill', args: ['14', '0', '0', '0', '255', '255'] })
      ctx.save()
      ctx.globalCompositeOperation = operation(command.mask)
      ctx.fillStyle = command.color
      ctx.beginPath()
      for (const rect of command.rects) ctx.rect(rect.x, rect.y, rect.width, rect.height)
      ctx.fill()
      ctx.restore()
      samples.path = [pixel(0), pixel(1), pixel(2)]
      samples.offscreenPath = decoder.decode({ opcode: 'cfill', args: ['2', '-2', '0', '0', '0', '255'] }).layer
      return samples
    })
    for (const mask of [2, 9, 12]) assert.deepEqual(result[mask], [0, 0, 0, 0], `mask ${mask} clears destination`)
    assert.deepEqual(result[14], [0, 0, 255, 255])
    for (const mask of [2, 9, 12, 14]) assert.equal(result[`state-${mask}`], 'source-over')
    assert.deepEqual(result.path, [[0, 0, 255, 255], [255, 0, 0, 255], [0, 0, 255, 255]])
    assert.equal(result.offscreenPath, '-2')
    console.log('PASS: real canvas Porter-Duff pixels, state restoration, interleaved/multiple rectangle paths')
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
