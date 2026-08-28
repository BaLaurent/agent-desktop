.pragma library

// Notification helpers, owned by Phase 2.
//
// Pure functions usable from QML JS (`import "lib/notify.js" as Notify`):
//
//   commandFor(title, body)
//     -> ["notify-send", "-a", "Agent Desktop", title, body]
//
//   shouldNotify(notificationConfigJson, event)
//     -> bool   (the DESKTOP half of the per-event config)
//
//   shouldPlaySound(notificationConfigJson, event)
//     -> bool   (the SOUND half)
//
//   soundCommandFor(event)
//     -> ["canberra-gtk-play", "-i", <freedesktop sound id>]
//
// The sound half existed only as UI: the settings page draws a Sound column
// with one switch per event (components/settings/NotificationConfigGrid.qml),
// the switches persisted, and NOTHING read `.sound` — `shouldNotify` answers
// `merged.desktop === true` and nothing else. Seven visible, enabled,
// persisted controls that did nothing. The Electron front does play them
// (src/renderer/stores/chatStore.ts:869) with one sound for success and
// another for every failure, which is the split reproduced here.
//
// The actual `Quickshell.execDetached` call lives in a component (NOT in a
// store — CONTRACTS.md §2), so a store that wants to surface a turn-end or
// scheduler-fire notification emits a signal and the integration owner wires
// it up. This file exists so the argv-building rule and the gate logic live in
// exactly one place, are testable from node, and stay aligned with the
// server's NotificationConfig shape (DEFAULT_NOTIFICATION_CONFIG from
// generated/settingDefs.js).
//
// DEFAULT_NOTIFICATION_CONFIG is consumed by `import "..."` as a peer; tests
// pass it in directly. We never hand-copy the defaults.
.import "../generated/settingDefs.js" as SettingDefs

function commandFor(title, body) {
  return [
    "notify-send",
    "-a", "Agent Desktop",
    String(title),
    String(body)
  ]
}

function _normalizeConfig(raw) {
  // Accept either a parsed object (from JSON.parse) or a JSON string. The
  // QML settings store hands JSON strings, but a node test can pass the
  // parsed object directly.
  var parsed = raw
  if (typeof raw === "string") {
    if (raw.length === 0) return ({})
    try { parsed = JSON.parse(raw) } catch (e) { return ({}) }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return ({})
  return parsed
}

// The two halves share `_slotFor` so a partially-populated config falls back
// to the server's defaults for BOTH fields. The previous merge dropped the
// sound flag whenever the user had touched only `desktop` — it rebuilt the
// object from `slot.sound`, which is undefined in that case.
function _slotFor(rawConfig, event) {
  var defaults = SettingDefs.DEFAULT_NOTIFICATION_CONFIG
  var base = defaults[event]
  if (!base) return null
  var slot = _normalizeConfig(rawConfig)[event]
  if (!slot || typeof slot !== "object") return base
  return ({
    desktop: slot.desktop === true || slot.desktop === false ? slot.desktop : base.desktop,
    sound: slot.sound === true || slot.sound === false ? slot.sound : base.sound
  })
}

function shouldNotify(rawConfig, event) {
  var slot = _slotFor(rawConfig, event)
  return !!slot && slot.desktop === true
}

function shouldPlaySound(rawConfig, event) {
  var slot = _slotFor(rawConfig, event)
  return !!slot && slot.sound === true
}

// Freedesktop sound ids rather than bundled audio: `canberra-gtk-play -i`
// resolves them against the user's own sound theme, so the plugin inherits
// whatever their desktop already uses and ships no assets. Success gets a
// distinct sound from every failure, matching the Electron split
// (playCompletionSound / playErrorSound, src/renderer/stores/chatStore.ts:870).
function soundCommandFor(event) {
  var id = String(event) === "success" ? "complete" : "dialog-error"
  return ["canberra-gtk-play", "-i", id]
}
