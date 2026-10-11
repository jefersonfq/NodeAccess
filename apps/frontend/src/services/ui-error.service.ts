import type { App } from 'vue'

export const UI_ERROR_EVENT = 'nodeaccess:ui-error'
let lastNotice = 0
/** Never send exception text/stack, component props or terminal contents to logs. */
export function installUiErrorHandler(app: App): void {
  app.config.errorHandler = (): void => {
    const now = Date.now()
    if (now - lastNotice < 5_000) return
    lastNotice = now
    window.dispatchEvent(new Event(UI_ERROR_EVENT))
    void import('naive-ui').then(({ createDiscreteApi }) => {
      const { message } = createDiscreteApi(['message'])
      const portuguese = !document.documentElement.lang || document.documentElement.lang.startsWith('pt')
      message.error(portuguese ? 'Não foi possível concluir esta ação. Tente novamente.' : 'Unable to complete this action. Please try again.')
    }).catch(() => { /* No recursive error handling if notification itself fails. */ })
  }
}
