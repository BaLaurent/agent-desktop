.pragma library

// Pure formatters for the scheduler UI. Pure means a function cannot call
// `new Date()` itself: every entry point takes `nowIso` so a node test can
// freeze time and assert the exact string it produces, instead of racing it.
//
// Three rows carry the meat of the page:
//   - formatInterval:   "every 15 minutes"   — how often
//   - formatNextRun:    "in 4 min" / "overdue by 2 h" / "—" — when next
//   - formatLastRun:    "5 min ago" / "just now" / "never"
// Plus describeTask, which the row summary binds to.

var SECOND = 1
var MINUTE = 60
var HOUR = 3600
var DAY = 86400

// How the interval reads in English.
var UNIT_LABELS = {
  minutes: { singular: "minute", plural: "minutes" },
  hours:   { singular: "hour",   plural: "hours"   },
  days:    { singular: "day",    plural: "days"    }
}

function formatInterval(value, unit) {
  value = Number(value)
  if (!isFinite(value) || value <= 0) return "—"
  var labels = UNIT_LABELS[String(unit)]
  if (!labels) return "every " + value + " " + String(unit)
  var noun = (value === 1) ? labels.singular : labels.plural
  return "every " + value + " " + noun
}

// Difference in seconds, rounded toward zero. null/undefined/non-finite parse
// returns null — callers translate null to "—".
function diffSeconds(iso, nowIso) {
  if (!iso || !nowIso) return null
  var then = Date.parse(String(iso))
  var now = Date.parse(String(nowIso))
  if (!isFinite(then) || !isFinite(now)) return null
  return Math.round((then - now) / 1000)
}

function relativeFromNow(seconds, suffixPast, suffixFuture) {
  // The headline is the largest unit. <60s rounds to "a moment" — finer
  // resolution is noise on a scheduler row.
  var abs = Math.abs(seconds)
  var direction
  if (seconds < 0) direction = suffixPast
  else if (seconds > 0) direction = suffixFuture
  else return "now"

  if (abs < 60) return direction + " a moment"

  if (abs < HOUR) {
    var minutes = Math.round(abs / MINUTE)
    return direction + " " + minutes + " min"
  }
  if (abs < DAY) {
    var hours = Math.round(abs / HOUR)
    return direction + " " + hours + " h"
  }
  var days = Math.round(abs / DAY)
  return direction + " " + days + " d"
}

// `nextRunAtIso` may be null (max_runs reached, or task disabled). `nowIso`
// is the caller's now-anchor, so a unit test can pin it.
function formatNextRun(nextRunAtIso, nowIso) {
  if (!nextRunAtIso) return "—"
  var seconds = diffSeconds(nextRunAtIso, nowIso)
  if (seconds === null) return "—"
  if (seconds <= 0) return relativeFromNow(seconds, "overdue by", "in")
  return relativeFromNow(seconds, "overdue by", "in")
}

// `lastRunAtIso` is null until the first run.
function formatLastRun(lastRunAtIso, nowIso) {
  if (!lastRunAtIso) return "never"
  var seconds = diffSeconds(lastRunAtIso, nowIso)
  if (seconds === null) return "never"
  if (Math.abs(seconds) < 60) return "just now"
  if (seconds < 0) return relativeAgo(Math.abs(seconds))
  // A last_run_at in the future has to be clock skew — render as "just now"
  // rather than a confusing "in -3 min".
  return "just now"
}

// Past-tense counterpart of relativeFromNow: "4 min ago", "2 h ago", "3 d
// ago". Split out so formatLastRun reads naturally — the empty-suffix hack of
// prepending "in" then appending " ago" was a footgun that fell through to
// "in 4 min ago" on every realistic run.
function relativeAgo(seconds) {
  if (seconds < HOUR) return Math.round(seconds / MINUTE) + " min ago"
  if (seconds < DAY) return Math.round(seconds / HOUR) + " h ago"
  return Math.round(seconds / DAY) + " d ago"
}

// What `max_runs` reached its limit looks like in the row summary.
// `task.conversation_title` is optional and not always present.
function describeTask(task, nowIso) {
  if (!task) return ""
  var bits = []
  bits.push(formatInterval(task.interval_value, task.interval_unit))
  if (task.max_runs !== null && task.max_runs !== undefined
      && task.run_count !== undefined && task.run_count >= task.max_runs) {
    bits.push("limit reached")
  } else {
    bits.push(formatNextRun(task.next_run_at, nowIso))
  }
  if (task.conversation_title) bits.push("→ " + task.conversation_title)
  return bits.join(" · ")
}
