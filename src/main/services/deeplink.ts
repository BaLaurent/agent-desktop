import type { App } from 'electron'
import { getMainWindow } from '../index'
import { log } from './system'

export function setupDeepLinks(app: App): void {
  app.setAsDefaultProtocolClient('agent')

  // macOS: open-url event
  app.on('open-url', (_event, url) => {
    handleDeepLink(url)
  })

  // Linux/Windows: second-instance event
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith('agent://'))
    if (url) {
      handleDeepLink(url)
    }
  })
}

function handleDeepLink(url: string): void {
  try {
    const parsed = new URL(url)
    const pathSegments = parsed.pathname.replace(/^\/+/, '').split('/')

    if (parsed.host === 'conversation' && pathSegments[0]) {
      const conversationId = parseInt(pathSegments[0], 10)
      if (isNaN(conversationId)) {
        log('error', `Deep link: invalid conversation ID`, url)
        return
      }
      log('info', `Deep link: open conversation ${conversationId}`, url)
      const win = getMainWindow()
      if (win) {
        win.webContents.send('deeplink:navigate', conversationId)
        win.show()
        win.focus()
      }
    } else {
      log('info', `Deep link received: ${url}`)
    }
  } catch (err) {
    log('error', `Failed to parse deep link: ${url}`, (err as Error).message)
  }
}
