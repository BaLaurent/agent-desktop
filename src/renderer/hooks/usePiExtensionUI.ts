import { useEffect } from 'react'
import { usePiExtensionUIStore } from '../stores/piExtensionUIStore'
import type { PiUIRequest, PiUIEvent } from '../../shared/piUITypes'

export function usePiExtensionUI(): void {
  const enqueueDialog = usePiExtensionUIStore((s) => s.enqueueDialog)
  const dismissDialogById = usePiExtensionUIStore((s) => s.dismissDialogById)
  const addNotification = usePiExtensionUIStore((s) => s.addNotification)
  const setStatusEntry = usePiExtensionUIStore((s) => s.setStatusEntry)
  const clearStatusEntry = usePiExtensionUIStore((s) => s.clearStatusEntry)
  const setWidget = usePiExtensionUIStore((s) => s.setWidget)
  const clearWidget = usePiExtensionUIStore((s) => s.clearWidget)
  const setWorkingMessage = usePiExtensionUIStore((s) => s.setWorkingMessage)
  const setHeaderComponent = usePiExtensionUIStore((s) => s.setHeaderComponent)
  const setFooterComponent = usePiExtensionUIStore((s) => s.setFooterComponent)
  const setTitleOverride = usePiExtensionUIStore((s) => s.setTitleOverride)

  useEffect(() => {
    const unsubRequest = window.agent.pi.onUIRequest((request: PiUIRequest) => {
      enqueueDialog(request)
    })

    const unsubTuiDone = window.agent.pi.onTuiDone((payload: { id: string }) => {
      dismissDialogById(payload.id)
    })

    const unsubEvent = window.agent.pi.onUIEvent((event: PiUIEvent) => {
      switch (event.method) {
        case 'notify':
          addNotification(event.message, event.level || 'info')
          break
        case 'setStatus':
          if (event.text != null) setStatusEntry(event.key, event.text)
          else clearStatusEntry(event.key)
          break
        case 'setWidget':
          if (event.content != null) setWidget(event.key, event.content, event.placement || 'belowEditor')
          else clearWidget(event.key)
          break
        case 'setWorkingMessage':
          setWorkingMessage(event.message)
          break
        case 'setTitle':
          setTitleOverride(event.title)
          break
        case 'setHeader':
          setHeaderComponent(event.component ?? null)
          break
        case 'setFooter':
          setFooterComponent(event.component ?? null)
          break
      }
    })

    return () => {
      unsubRequest()
      unsubEvent()
      unsubTuiDone()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- subscribe once, unsubscribe on unmount
}
