# Pi Extension UI Support — Design Document

**Date**: 2026-02-28
**Status**: Approved

## Goal

Enable Pi extensions to inject UI elements into Agent Desktop. Extensions can show dialogs, notifications, status badges, widgets, and custom components — all rendered natively in React.

## Architecture: IPC Bridge + Zustand Store

```
Extension calls ctx.ui.select("Pick", ["A","B"])
       ↓
PiUIContext (main process) → Promise + IPC 'pi:uiRequest'
       ↓
Renderer receives via preload bridge
       ↓
piExtensionUIStore (Zustand) queues dialog
       ↓
<ExtensionDialog> renders React modal
       ↓
User clicks "B" → preload 'pi:uiResponse' {id, value: "B"}
       ↓
PiUIContext resolves Promise → extension receives "B"
```

## Components

### 1. Main Process: `PiUIContext` (`src/main/services/piUIContext.ts`)

Implements `ExtensionUIContext` from Pi SDK.

**Dialog methods** (select, confirm, input, editor):
- Generate unique `requestId`
- Send `pi:uiRequest` to renderer via BrowserWindow.webContents.send
- Store `{ resolve, reject }` in `Map<string, PendingRequest>`
- Timeout resolves with SDK defaults (undefined/false)

**Fire-and-forget** (notify, setStatus, setWidget, setWorkingMessage, setTitle):
- Send `pi:uiEvent` immediately, no Promise

**Custom components** (setFooter, setHeader, custom):
- Emit `pi:uiRequest`/`pi:uiEvent` with JSON declarative UI tree
- TUI-native factories are not executable — graceful no-op with warning log

**No-op methods**: onTerminalInput, setEditorComponent, getToolsExpanded, setToolsExpanded

**Editor bridge**: setEditorText/getEditorText/pasteToEditor delegate to MessageInput via IPC

**Theme bridge**: theme/getAllThemes/getTheme/setTheme map to Agent Desktop theme system

**Lifecycle**:
- Created per-session in `streamMessagePI.ts` after `createAgentSession()`
- Bound via `session.bindExtensions({ uiContext })`
- `dispose()` on stream end/abort: rejects pending Promises, clears listeners

### 2. IPC Protocol

```
Main → Renderer (one-way):
  pi:uiEvent     { method: string, ...data }

Main → Renderer (request):
  pi:uiRequest   { id: string, method: string, ...data }

Renderer → Main (response):
  pi:uiResponse  { id: string, value?: string, confirmed?: boolean, cancelled?: boolean }

Renderer → Main (component action):
  pi:uiComponentAction  { id: string, actionId: string, data?: any }
```

### 3. Preload API Extension

```typescript
pi: {
  listExtensions(): Promise<PIExtensionInfo[]>        // existing
  onUIEvent(callback: (event: PiUIEvent) => void): () => void
  onUIRequest(callback: (request: PiUIRequest) => void): () => void
  respondUI(id: string, response: PiUIResponse): void
  respondComponentAction(id: string, actionId: string, data?: any): void
}
```

### 4. Renderer Store: `piExtensionUIStore`

```typescript
interface PiExtensionUIState {
  activeDialog: PiUIDialog | null
  dialogQueue: PiUIDialog[]
  notifications: PiUINotification[]
  statusEntries: Record<string, string>
  widgets: Record<string, PiUIWidget>
  workingMessage: string | null
  headerComponent: PiUIJsonNode | null
  footerComponent: PiUIJsonNode | null
  titleOverride: string | null
}
```

Reset on conversation change. Notifications auto-dismiss after 5s.

### 5. React Components

| Component | Type | Placement |
|-----------|------|-----------|
| `ExtensionDialog` | Modal overlay | Center screen, high z-index |
| `ExtensionToast` | Auto-dismiss notification | Top-right corner, stacked |
| `ExtensionStatusBadge` | Inline badges | ChatStatusLine (next to MCP/KB) |
| `ExtensionWidget` | Text block with accent border | Above or below MessageInput |
| `ExtensionHeader` | Custom header zone | Between chat header and messages |
| `ExtensionFooter` | Custom footer zone | Between messages and input |
| `ExtensionComponentRenderer` | JSON tree → React | Used by Header/Footer/Custom |

### 6. JSON Declarative UI Schema

```typescript
type PiUINode =
  | { type: 'text'; content: string; style?: 'bold' | 'muted' | 'error' | 'accent' }
  | { type: 'button'; label: string; action: string }
  | { type: 'input'; placeholder?: string; id: string }
  | { type: 'select'; options: string[]; id: string }
  | { type: 'progress'; value: number; max?: number }
  | { type: 'divider' }
  | { type: 'hstack' | 'vstack'; children: PiUINode[]; gap?: number }
  | { type: 'badge'; text: string; color?: string }
```

Button/input actions emit `pi:uiComponentAction` → main routes to `done()` callback.

### 7. Dialog Types

**Select**: Title + list of clickable options. Returns selected string or undefined.
**Confirm**: Title + message + Yes/No buttons. Returns boolean.
**Input**: Title + text field + placeholder + Submit/Cancel. Returns string or undefined.
**Editor**: Title + multi-line textarea + prefilled text + Submit/Cancel. Returns string or undefined.

All dialogs: ESC = cancel (returns default). Timeout countdown shown if extension set timeout.

### 8. Integration Point

In `streamMessagePI.ts`, after `createAgentSession()`:

```typescript
const uiContext = new PiUIContext(mainWindow, conversationId)
await session.bindExtensions({ uiContext })
// ... session.prompt() ...
// On cleanup:
uiContext.dispose()
```

### 9. Scoping Rules

- Extension UI state is **per-conversation** (not global)
- Switching conversations clears all extension UI
- Multiple concurrent extensions can set status/widgets (keyed by extension name)
- Dialogs are queued — only one shown at a time (FIFO)
- Notifications stack (max 5 visible, oldest auto-dismissed)

### 10. Non-Goals (This Iteration)

- Extension marketplace/install UI
- Extension sandboxing/permissions beyond Pi SDK's built-in
- Custom editor component replacement (setEditorComponent)
- Terminal input forwarding (onTerminalInput)
- Hot-reload of extensions during session
