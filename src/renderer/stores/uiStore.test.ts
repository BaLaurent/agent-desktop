import { useUiStore } from './uiStore'

beforeEach(() => {
  useUiStore.setState({ sidebarVisible: true, panelVisible: false, activeView: 'welcome' })
})

describe('uiStore', () => {
  it('has correct initial state', () => {
    const state = useUiStore.getState()
    expect(state.sidebarVisible).toBe(true)
    expect(state.panelVisible).toBe(false)
    expect(state.activeView).toBe('welcome')
  })

  it('toggleSidebar flips sidebarVisible to false', () => {
    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState().sidebarVisible).toBe(false)
  })

  it('togglePanel flips panelVisible to true', () => {
    useUiStore.getState().togglePanel()
    expect(useUiStore.getState().panelVisible).toBe(true)
  })

  it('setActiveView changes activeView', () => {
    useUiStore.getState().setActiveView('chat')
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('double toggleSidebar returns to original', () => {
    useUiStore.getState().toggleSidebar()
    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState().sidebarVisible).toBe(true)
  })

  it('setActiveView to settings then back to chat', () => {
    useUiStore.getState().setActiveView('settings')
    expect(useUiStore.getState().activeView).toBe('settings')
    useUiStore.getState().setActiveView('chat')
    expect(useUiStore.getState().activeView).toBe('chat')
  })
})
