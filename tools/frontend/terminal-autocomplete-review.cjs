// Browser review extension. Uses only the parent harness's simulated SSH/SFTP.
module.exports = async function reviewAutocomplete(page, input, popup) {
  const sent = () => page.evaluate(() => window.__terminalExperience.sent.join(''))
  const reset = async () => {
    await input.focus(); if (await popup.isVisible()) await input.press('Escape')
    await input.press('Control+C')
    await page.evaluate(() => window.__emitLatestSshBytes('\r\n$ '))
    await page.waitForTimeout(30)
  }
  await reset()
  await input.pressSequentially('cat /review-delayed/r', { delay: 5 })
  await page.waitForFunction(() => window.__terminalExperience.sftpMessages.includes('/review-delayed'))
  await input.press('Control+U')
  await input.pressSequentially('pw', { delay: 10 })
  await popup.getByText('pwd', { exact: true }).waitFor()
  await page.waitForTimeout(800)
  if (await popup.getByText('cat /review-delayed/report.txt', { exact: true }).count()) throw new Error('Late remote response replaced the current query')
  await popup.getByText('pwd', { exact: true }).waitFor()
  const beforeAccept = await sent()
  await input.press('Tab')
  const inserted = (await sent()).slice(beforeAccept.length)
  if (/[\r\n]/.test(inserted)) throw new Error('Completion executed a command without submission')

  await reset()
  await input.pressSequentially('cat /review-dismiss/r', { delay: 5 })
  await page.waitForFunction(() => window.__terminalExperience.sftpMessages.includes('/review-dismiss'))
  await input.press('Escape')
  await page.waitForTimeout(800)
  const escapeReopenedByLateResponse = await popup.isVisible()
  if (escapeReopenedByLateResponse) throw new Error('Esc did not cancel the remote lookup')

  const invisibleRemoteStates = []
  for (const path of ['/review-empty', '/review-denied']) {
    await reset()
    await input.pressSequentially(`cat ${path}/r`, { delay: 5 })
    await page.waitForFunction(path => window.__terminalExperience.sftpMessages.includes(path), path)
    await page.waitForTimeout(150)
    const state = await popup.locator('[data-autocomplete-state]').getAttribute('data-autocomplete-state')
    if (state !== (path === '/review-empty' ? 'empty' : 'error')) throw new Error(`Missing distinct remote feedback: ${path}: ${state}`)
    invisibleRemoteStates.push({ path, popupVisible: await popup.isVisible(), state })
    if (path === '/review-denied') {
      await popup.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
      await popup.getByText('cat /review-denied/recovered.txt', { exact: true }).waitFor()
    }
    const beforeTyping = await sent()
    await input.pressSequentially('x')
    if (!(await sent()).slice(beforeTyping.length).includes('x')) throw new Error('Remote lookup failure blocked typing')
  }

  await reset()
  await input.pressSequentially('sy', { delay: 10 })
  await popup.waitFor()
  const beforeWordMovement = await sent()
  await input.press('Control+ArrowRight')
  const wordMovementBytes = (await sent()).slice(beforeWordMovement.length)
  // Modifier shortcuts must retain their shell meaning.
  const modifiedArrowAcceptedCompletion = /stemctl/.test(wordMovementBytes)
  if (modifiedArrowAcceptedCompletion || !wordMovementBytes.includes('\u001b')) throw new Error('Ctrl+Right was intercepted by autocomplete')
  if (await popup.isVisible()) throw new Error('Autocomplete remained visible with an uncertain cursor')
  if (/[\r\n]/.test(wordMovementBytes)) throw new Error('Word navigation executed a command')
  await reset()
  // Restore an open local popup, as expected by the parent's Escape/mobile scenario.
  await input.pressSequentially('sy', { delay: 10 })
  await popup.waitFor()
  const activeId = await input.getAttribute('aria-activedescendant')
  if (!activeId || !await popup.locator(`[id="${activeId}"]`).count()) throw new Error('Focused terminal input is not linked to its active option')
  await popup.getByRole('checkbox').uncheck()
  const preference = await page.evaluate(() => localStorage.getItem('na:terminal-autocomplete-history:1:1:9401:enabled'))
  if (preference !== 'false') throw new Error('History opt-out was not saved')
  await popup.getByRole('checkbox').check()
  await popup.getByRole('button', { name: 'Limpar histórico deste host' }).click()
  await page.locator('.n-popconfirm__action button').last().click()
  const history = await page.evaluate(() => localStorage.getItem('na:terminal-autocomplete-history:1:1:9401'))
  if (history !== null) throw new Error('Confirmed history cleanup retained stored commands')
  const helpContrast = await popup.locator('[role="status"] > span').first().evaluate(element => {
    const luminance = values => values.map(value => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const color = getComputedStyle(element).color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number)
    return (luminance(color) + 0.05) / (luminance([17, 19, 24]) + 0.05)
  })
  if (helpContrast < 4.5) throw new Error(`Autocomplete help contrast is too low: ${helpContrast}`)
  const result = { helpContrast, retryRecovered: true, historyPreferenceAndClear: true, focusedInputLinkedToOption: true,

    staleRemoteResponseIgnored: true, insertionWithoutExecution: true,
    typingDuringRemoteFailure: true, escapeReopenedByLateResponse,
    modifiedArrowAcceptedCompletion, wordMovementBytes,
    remoteEmptyAndErrorBothInvisible: invisibleRemoteStates.every(state => !state.popupVisible),
    invisibleRemoteStates,
  }
  require('node:fs').writeFileSync(`/tmp/nodeaccess-autocomplete-observations-${process.env.UI_THEME || 'dark'}.json`, JSON.stringify(result, null, 2))
  return result
}
