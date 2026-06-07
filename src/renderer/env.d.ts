/// <reference types="../preload/api" />

// Electron's `-webkit-app-region` drag handle is not in the standard CSS
// typings. Declared here so titlebar/overlay drag styles type-check without
// per-callsite `as never` casts.
import 'react'
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}
