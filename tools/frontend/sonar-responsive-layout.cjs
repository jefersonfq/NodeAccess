// Inherit the harness's existing 5 s timeout; wait for layout, never retry the workflow.
async function waitForResponsiveLayout(page) {
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth)
}
module.exports = { waitForResponsiveLayout }
