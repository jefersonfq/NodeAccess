const assert = require('node:assert/strict')
module.exports = async ({ page }) => {
  const tabs = page.locator('.terminal-tab')
  for (let i = 0; i < 2; i++) {
    await tabs.first().click({button:'right'})
    await page.getByText('Duplicar aba', {exact:true}).click()
    await page.waitForFunction(n => document.querySelectorAll('.terminal-tab').length === n, i + 2)
  }
  await page.waitForFunction(() => window.__terminalExperience.sockets.filter(s => s.url.includes('/ws/ssh/') && s.readyState === 1).length === 3)
  const order = () => tabs.evaluateAll(elements => elements.map(el => el.dataset.terminalTabId))
  const initial = await order()
  const tab = id => page.locator(`[data-terminal-tab-id="${id}"]`)
  const active = await page.locator('.terminal-tab-active').getAttribute('data-terminal-tab-id')
  const connections = await page.evaluate(() => window.__terminalExperience.sockets.length)
  const marker = page.getByTestId('terminal-tab-drop-marker')
  const transfer = await page.evaluateHandle(() => new DataTransfer())
  async function over(id, side) {
    const box = await tab(id).boundingBox()
    await tab(id).dispatchEvent('dragover', {dataTransfer:transfer, clientX:box.x + box.width * (side === 'before' ? 0.2 : 0.8)})
    return box
  }
  async function drop(id, side) {
    const box = await over(id, side)
    await tab(id).dispatchEvent('drop', {dataTransfer:transfer, clientX:box.x + box.width * (side === 'before' ? 0.2 : 0.8)})
  }
  await tab(initial[0]).dispatchEvent('dragstart', {dataTransfer:transfer})
  await over(initial[2], 'before')
  assert.equal(await tab(initial[2]).getAttribute('data-drop-side'), 'before')
  assert.deepEqual(await order(), initial, 'Preview must not reorder or remount panes')
  await over(initial[2], 'after')
  assert.equal(await tab(initial[2]).getAttribute('data-drop-side'), 'after')
  await page.screenshot({path:`/tmp/nodeaccess-terminal-drag-preview-${process.env.UI_THEME === 'light' ? 'light' : 'dark'}.png`})
  await drop(initial[2], 'after')
  assert.deepEqual(await order(), [initial[1], initial[2], initial[0]])
  assert.equal(await marker.count(), 0)
  // Reverse direction and verify that the preview and committed position agree.
  await tab(initial[0]).dispatchEvent('dragstart', {dataTransfer:transfer})
  await drop(initial[1], 'before')
  assert.deepEqual(await order(), initial)
  // Dropping onto the source or the adjacent equivalent slot is a no-op.
  await tab(initial[0]).dispatchEvent('dragstart', {dataTransfer:transfer})
  await over(initial[1], 'before')
  assert.equal(await marker.count(), 0)
  await drop(initial[0], 'after')
  assert.deepEqual(await order(), initial)
  // Leaving a target and cancellation clear the feedback without changing order.
  await tab(initial[0]).dispatchEvent('dragstart', {dataTransfer:transfer})
  await over(initial[2], 'after')
  await tab(initial[2]).dispatchEvent('dragleave')
  assert.equal(await marker.count(), 0)
  await over(initial[2], 'before')
  await tab(initial[0]).dispatchEvent('dragend', {clientX:100, clientY:100})
  assert.equal(await marker.count(), 0)
  assert.deepEqual(await order(), initial)
  // External drags cannot acquire a marker or reorder sessions.
  await over(initial[2], 'after')
  await drop(initial[2], 'after')
  assert.equal(await marker.count(), 0)
  assert.deepEqual(await order(), initial)
  // Actual mouse drag, including native dragstart/dragover/drop in Chromium.
  const source = await tab(initial[0]).boundingBox()
  const target = await tab(initial[2]).boundingBox()
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, {steps:5})
  await page.mouse.move(target.x + target.width * 0.8, target.y + target.height / 2, {steps:12})
  await page.mouse.move(target.x + target.width * 0.85, target.y + target.height / 2)
  await marker.waitFor()
  await page.mouse.up()
  await page.waitForFunction(id => [...document.querySelectorAll('.terminal-tab')].at(-1)?.dataset.terminalTabId === id, initial[0])
  assert.equal(await marker.count(), 0)
  assert.equal(await page.locator('.terminal-tab-active').getAttribute('data-terminal-tab-id'), active)
  assert.equal(await page.evaluate(() => window.__terminalExperience.sockets.length), connections)
  // Reduced motion retains the destination indicator without animation.
  await page.emulateMedia({reducedMotion:'reduce'})
  await tab(initial[0]).dispatchEvent('dragstart', {dataTransfer:transfer})
  await over(initial[1], 'before')
  assert.equal(await marker.evaluate(el => getComputedStyle(el).animationName), 'none')
  await tab(initial[0]).dispatchEvent('dragend', {clientX:100,clientY:100})
  return {passed:true,previewBeforeAfter:true,mouseDrag:true,noOp:true,cancelAndLeave:true,externalDragIgnored:true,activeSessionPreserved:true,noReconnection:true,reducedMotion:true}
}
