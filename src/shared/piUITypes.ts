// ─── Pi Extension UI — Declarative Node Schema ─────────────

export type PiUINode =
  | { type: 'text'; content: string; style?: 'bold' | 'muted' | 'error' | 'accent' }
  | { type: 'button'; label: string; action: string }
  | { type: 'input'; placeholder?: string; id: string }
  | { type: 'select'; options: string[]; id: string }
  | { type: 'progress'; value: number; max?: number }
  | { type: 'divider' }
  | { type: 'hstack' | 'vstack'; children: PiUINode[]; gap?: number }
  | { type: 'badge'; text: string; color?: string }

// ─── Pi Extension UI — Dialog Requests (main -> renderer) ───

export type PiUIDialog =
  | { id: string; method: 'select'; title: string; options: string[]; timeout?: number }
  | { id: string; method: 'confirm'; title: string; message: string; timeout?: number }
  | { id: string; method: 'input'; title: string; placeholder?: string; timeout?: number }
  | { id: string; method: 'editor'; title: string; prefill?: string; timeout?: number }
  | { id: string; method: 'custom'; title?: string; component: PiUINode; timeout?: number }
  | { id: string; method: 'custom_tui'; html: string; timeout?: number }

// ─── Pi Extension UI — Fire-and-Forget Events (main -> renderer)

export type PiUIEvent =
  | { method: 'notify'; message: string; level?: 'info' | 'warning' | 'error' }
  | { method: 'setStatus'; key: string; text?: string }
  | { method: 'setWidget'; key: string; content?: string[]; placement?: 'aboveEditor' | 'belowEditor' }
  | { method: 'setWorkingMessage'; message?: string }
  | { method: 'setTitle'; title: string }
  | { method: 'setHeader'; component?: PiUINode }
  | { method: 'setFooter'; component?: PiUINode }

// ─── Pi Extension UI — Request / Response ───────────────────

export type PiUIRequest = PiUIDialog

export interface PiUIResponse {
  id: string
  value?: string
  confirmed?: boolean
  cancelled?: boolean
}

// ─── Pi Extension UI — Component Actions (renderer -> main) ─

export interface PiUIComponentAction {
  id: string
  actionId: string
  data?: unknown
}

// ─── Pi Extension UI — Renderer State ───────────────────────

export interface PiUINotification {
  id: string
  message: string
  level: 'info' | 'warning' | 'error'
  timestamp: number
}

export interface PiUIWidget {
  key: string
  content: string[]
  placement: 'aboveEditor' | 'belowEditor'
}

// ─── Pi Extension UI — TUI Bridge IPC (headless TUI) ────────

export interface PiUITuiInput {
  id: string
  data: string
}

export interface PiUITuiRender {
  id: string
  html: string
}
