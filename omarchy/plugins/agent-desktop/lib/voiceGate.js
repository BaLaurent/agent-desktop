.pragma library

// Pure decision functions backing ContinuousVoiceStore.qml.
//
// The reference implementation in src/renderer/services/voiceGate/ is a
// factory (`createVoiceGate`) because its wake-detection correlation depends
// on a rolling event buffer and a clock the test can inject. The QML front
// has no acoustic wake-word detector (openwakeword-js runs in a browser Web
// Worker; there is no non-DOM equivalent here), so in THIS front the "wakeword"
// gate is TEXT-based — the transcript must begin with the wake phrase, matched
// with the same normalization the reference uses. Everything else about the
// gate (the follow-up window, the intent classifier, the fail-closed classifier
// branch, the generation counter that drops superseded classify replies) is a
// faithful port of `createVoiceGate.ts` so a reader who knows the reference can
// find the equivalent line in one hop.
//
// State (the follow-up window deadline, the classification generation counter)
// is owned by the CALLER (the store), not by these functions. They are pure:
// given the same `armedUntil` / `nowMs` they return the same decision, so
// they are testable without QML and without a clock injection.

function normalizeToken(tok) {
  // toLowerCase first, then strip everything that is not a Unicode letter or
  // digit. \p{L}\p{N} matches the reference's intent (case-fold + keep
  // alphanumerics, drop apostrophes, hyphens, punctuation, ellipses).
  return tok.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function tokenize(text) {
  return text.split(/\s+/).filter(Boolean)
}

// stripWakeword — cosmetic leading-strip of the wake phrase from a transcript.
//
// Token-prefix match: the FIRST N tokens of the transcript, after the same
// normalization, must equal every wake token. A mismatch anywhere returns the
// original text untouched. On a match, the remainder is cleaned of leading
// punctuation/commas left behind ("hey jarvis, what" → "what") and returned
// with `stripped: true`. An empty wakeword, or a transcript shorter than the
// wake phrase, never strips.
function stripWakeword(transcript, wakeword) {
  var original = String(transcript || '').trim()
  var wakeTokens = tokenize(String(wakeword || '')).map(normalizeToken).filter(Boolean)
  if (wakeTokens.length === 0) return { text: original, stripped: false }

  var rawTokens = tokenize(original)
  if (rawTokens.length < wakeTokens.length) return { text: original, stripped: false }

  for (var i = 0; i < wakeTokens.length; i++) {
    if (normalizeToken(rawTokens[i]) !== wakeTokens[i]) {
      return { text: original, stripped: false }
    }
  }

  var rest = rawTokens.slice(wakeTokens.length).join(' ').replace(/^[\s,.:;!?-]+/, '').trim()
  return { text: rest, stripped: true }
}

// armUntil — compute the follow-up window deadline.
//
// `nowMs + followupWindowMs` when the window is positive and finite. A non-
// positive or non-finite window means the feature is OFF ("armed forever" is
// the wrong default — a stuck gate that accepts every utterance forever
// would be worse than one that reverts to wakeword after the window), so the
// caller can compare `isArmed(deadline, now) === true` directly.
function armUntil(nowMs, followupWindowMs) {
  if (!(followupWindowMs > 0)) return 0
  if (!isFinite(followupWindowMs)) return 0
  if (!isFinite(nowMs)) return 0
  return nowMs + followupWindowMs
}

// isArmed — is the follow-up window currently open?
//
// `armedUntil > 0 && nowMs < armedUntil`. An expired window returns false;
// an uninitialized window (armedUntil === 0) returns false. The strict less
// than matches the reference: at the exact tick `nowMs === armedUntil` the
// window has closed.
function isArmed(armedUntil, nowMs) {
  if (!armedUntil || armedUntil <= 0) return false
  if (!isFinite(armedUntil) || !isFinite(nowMs)) return false
  return nowMs < armedUntil
}

// decide — the gate.
//
// `text`     finalized transcript (after STT). Whitespace-trimmed here.
// `mode`     'intent' ONLY when it is exactly the string 'intent'. Every other
//            value (including undefined, 'wakeword', a typo, the empty
//            string) is treated as wakeword. Matches the reference's
//            `mode === 'intent' ? 'intent' : 'wakeword'`.
// `wakeword` the wake phrase for cosmetic text-strip; same underscore-to-
//            space conversion as the Electron front. An empty wakeword can
//            never prefix-match, so a wakeword-mode decision on such text
//            falls through to the armed check and then to no-wakeword.
// `armedUntil` deadline the caller owns.
// `nowMs`    caller-supplied clock; defaults to Date.now() for QML use.
//
// Returns { action, text, reason, arm }.
//   action: 'send'     — emit `text`, the user clearly addressed the AI.
//   action: 'classify' — needs the (paid) intent classifier; the caller
//                        invokes it and feeds the reply back through a
//                        subsequent decide(…) call.
//   action: 'ignore'   — drop, but copy `reason` into the UI for a subtle hint.
//   arm:    true       — open the follow-up window; the user said something
//                        that proved they are in conversation, accept their
//                        next utterance for free.
//   arm:    false      — leave the window as it was.
function decide(opts) {
  opts = opts || {}
  var text = String(opts.text || '').trim()
  if (!text) return { action: 'ignore', text: '', reason: 'empty', arm: false }

  var mode = opts.mode === 'intent' ? 'intent' : 'wakeword'
  var wakeword = String(opts.wakeword || '')
  var armedUntil = opts.armedUntil || 0
  var nowMs = (opts.nowMs === undefined || opts.nowMs === null) ? Date.now() : Number(opts.nowMs)

  if (mode === 'wakeword') {
    var stripped = stripWakeword(text, wakeword)
    if (stripped.stripped) {
      // Transcript began with the wake phrase.
      if (stripped.text.length > 0) {
        // Case 1: "hey jarvis what time is it" → send "what time is it" and
        // arm so the next utterance (after a pause) is accepted for free.
        return { action: 'send', text: stripped.text, reason: 'wakeword', arm: true }
      }
      // Case 2: bare wake phrase ("hey jarvis" with no remainder). The user
      // said the wake word and paused — accept the FOLLOW-UP utterance by
      // arming now, drop THIS one.
      return { action: 'ignore', text: '', reason: 'wakeword-only', arm: true }
    }
    // No wake prefix. Follow-up window?
    if (isArmed(armedUntil, nowMs)) {
      return { action: 'send', text: text, reason: 'followup', arm: false }
    }
    return { action: 'ignore', text: '', reason: 'no-wakeword', arm: false }
  }

  // intent mode. Follow-up window short-circuits the paid classifier after an
  // exchange — that is WHY the window exists in this mode.
  if (isArmed(armedUntil, nowMs)) {
    return { action: 'send', text: text, reason: 'followup', arm: false }
  }
  return { action: 'classify', text: text, reason: '', arm: false }
}
