.pragma library

// Pure logic for shaping SETTING_DEFS into QML rows.
//
// The settings page renders rows generated from the SETTING_DEFS array in
// generated/settingDefs.js (the same data the React AI page consumes), plus
// hand-written rows for the keys without a SettingDef. Every shape decision
// that does not need QML goes here so it is node-testable.
//
// Three rules the React app follows that this code mirrors:
//
//   1. claudeOnly / piOnly rows are hidden when the active backend does not
//      match. The QML page never sees them — they're not even part of the
//      row list.
//   2. The Dropdown's `currentValue` must come from the row's option list
//      when possible, so the dropdown renders the current state. A stored
//      value not present in the list means "not in options" — Dropdown must
//      show nothing and not pick a wrong one. optionIndexFor() returns -1
//      for that case and the row renders an explicit "unknown value" hint.
//   3. A number value above the def's max or below its min must be clamped
//      before being shown (and before being written back). clampNumber() is
//      the only place that knows the bounds.
//
// All three are deliberately conservative: a missing min means no lower
// bound; a missing max means no upper bound. A non-numeric value (a stray
// string from a manual DB edit) returns the def's min if it exists, else
// its max, else NaN. The choice is documented in test_settings_rows.js.

// ---- backend filtering ------------------------------------------------

// Return the subset of `settingDefs` that should appear for the given
// active `backend`. `backend` is the value of `ai_sdkBackend`, e.g.
// "claude-agent-sdk" or "pi". Anything not matching a def's `claudeOnly`
// or `piOnly` flag passes through; a def with `claudeOnly: true` is hidden
// when backend is "pi", and vice versa.
//
// The order of the input list is preserved, which is the order the rendered
// page reads top-to-bottom.
function rowsFor(settingDefs, backend) {
  if (!Array.isArray(settingDefs)) return []
  var backendIsPi = backend === "pi"
  var out = []
  for (var i = 0; i < settingDefs.length; i++) {
    var def = settingDefs[i]
    if (!def || typeof def !== "object") continue
    if (def.claudeOnly === true && backendIsPi) continue
    if (def.piOnly === true && !backendIsPi) continue
    out.push(def)
  }
  return out
}

// ---- control-kind decision -------------------------------------------

// Map a SettingDef.type to a control kind the QML page renders. The
// React app uses the same type strings; we keep one mapping here so
// adding a new def type is one place to update.
//
//   "select"   -> "dropdown"
//   "number"   -> "number"
//   "textarea" -> "textarea"
//
// Anything else is treated as a text input. The page falls back to a
// plain TextField rather than throwing — a future def type should not
// silently vanish the row.
function controlKindFor(def) {
  if (!def) return "text"
  var t = def.type
  if (t === "select") return "dropdown"
  if (t === "number") return "number"
  if (t === "textarea") return "textarea"
  return "text"
}

// ---- number clamping --------------------------------------------------

// Return `value` clamped to the def's [min, max] range. min/max/step are
// optional; missing bounds mean "no bound on that side". Non-numeric
// inputs fall back to the def's min if set, else its max, else NaN.
//
// `step` is NOT applied here. The def stores a step but clamping to it
// is a presentation choice the QML NumberField handles natively via its
// `stepSize`; mutating the bound here would round a user-typed value
// they may be editing.
function clampNumber(value, def) {
  var v = Number(value)
  if (isNaN(v)) {
    if (def && def.min !== undefined && !isNaN(Number(def.min))) return Number(def.min)
    if (def && def.max !== undefined && !isNaN(Number(def.max))) return Number(def.max)
    return NaN
  }
  if (def && def.min !== undefined && !isNaN(Number(def.min)) && v < Number(def.min)) {
    return Number(def.min)
  }
  if (def && def.max !== undefined && !isNaN(Number(def.max)) && v > Number(def.max)) {
    return Number(def.max)
  }
  return v
}

// ---- dropdown index for current value --------------------------------

// Return the index in `def.options` whose `value` equals `currentValue`,
// or -1 when no option matches. The QML Dropdown shows the indexed
// option; -1 means "stored value not in the option list" and the page
// renders an explicit hint rather than picking a wrong row.
//
// Comparison is string-strict on the option's `value` field. The
// stored setting is always a string (settings are a Record<string,
// string>) so the comparison never coerces unexpectedly.
function optionIndexFor(def, currentValue) {
  if (!def || !Array.isArray(def.options) || def.options.length === 0) return -1
  if (currentValue === undefined || currentValue === null) return -1
  var needle = String(currentValue)
  for (var i = 0; i < def.options.length; i++) {
    if (def.options[i] && def.options[i].value === needle) return i
  }
  return -1
}