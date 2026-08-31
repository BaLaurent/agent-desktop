.pragma library

// Pure decision functions backing `ConversationsStore.ensureQuickChat`.
//
// The Electron app follows the same rules in `src/main/services/quickChat.ts`:
// the bridge used to resolve a quick-chat conversation id by hand, but with
// the bridge now feature-agnostic that logic moved into QML. These functions
// stay as a `lib/` resource so every branch — including the off-spec cases
// the database really does produce — is reachable from a node test.
//
// The three "spec-able" rules:
//
//   1. Which setting holds the pinned conversation id? The voice mode has its
//      own slot only when `quickChat_separateVoiceConversation === 'true'`;
//      everything else shares one slot with text mode.
//   2. Normalise whatever is in that slot to a usable number. The strings
//      `'null'` and `'undefined'` really do land here — both because the
//      renderer used to persist them and because the migration imported
//      raw values from the old app — and a stored id of 0 means "empty".
//   3. `conversations:create` over WS can return `null` even though the row
//      WAS inserted, so on a null result fall back to the list, filter
//      `title === 'Quick Chat'`, and take the HIGHEST `id`. A previous bug
//      that took the first match instead broke across server restarts.

function settingKeyFor(mode, separateVoiceConversation) {
  if (mode === 'voice' && String(separateVoiceConversation) === 'true') {
    return 'quickChat_voiceConversationId'
  }
  return 'quickChat_conversationId'
}

function normalizeStoredId(raw) {
  if (raw === undefined || raw === null) return 0
  // The strings 'null' and 'undefined' are not edge cases — they are exactly
  // what ends up persisted when the renderer writes JSON.stringify(undefined).
  if (raw === 'null' || raw === 'undefined') return 0
  if (raw === '' || raw === '0') return 0
  var n = Number(raw)
  // NaN, Infinity, a non-numeric string — all collapse to 0.
  if (!isFinite(n)) return 0
  // Stored ids are positive SQLite rowids; nothing in the schema forbids
  // negative ids, but every consumer treats anything <= 0 as "empty".
  return n > 0 ? Math.floor(n) : 0
}

// Resolve the id of the quick chat that was just created.
//
// `createResult` is whatever `conversations:create` answered and `listResult`
// is a subsequent `conversations:list`. `title` is the title the caller asked
// for — "Quick Chat" for text mode, "Quick Chat (Voice)" for voice — and it
// defaults to "Quick Chat" so an older two-argument call keeps its behaviour.
//
// Two reply shapes are accepted because two have been observed. The handler
// returns the Conversation ROW (`service.create` returns the object), while
// the same call over this front's WebSocket has been measured answering
// literally `null` with the row nonetheless inserted. Neither is a bug we can
// fix from here, so both are handled: the object's `id`, a bare numeric id,
// and finally the list scan.
//
// The scan matches `title` rather than the hardcoded "Quick Chat" it used to.
// A voice quick chat is titled "Quick Chat (Voice)", so the old scan could
// never find one — it returned the highest TEXT quick chat instead, which
// would then be pinned into the voice slot as if it were a new conversation.
function pickCreatedId(createResult, listResult, title) {
  var wanted = (title === undefined || title === null || String(title).length === 0)
    ? 'Quick Chat'
    : String(title)

  if (createResult !== null && createResult !== undefined && createResult !== 0) {
    var direct = (typeof createResult === 'object')
      ? Number(createResult.id)
      : Number(createResult)
    if (isFinite(direct) && direct > 0) return Math.floor(direct)
  }

  if (!Array.isArray(listResult)) return 0

  var highest = 0
  for (var i = 0; i < listResult.length; i++) {
    var row = listResult[i]
    if (!row || row.title !== wanted) continue
    var id = Number(row.id)
    if (!isFinite(id)) continue
    if (id > highest) highest = id
  }
  return highest > 0 ? Math.floor(highest) : 0
}

// Should a summon of `mode` run with NO window at all?
//
// `quickChat_voiceHeadless` promises "notifications only, no overlay". Only
// voice mode can honour it — a headless TEXT quick chat has no input to type
// into, so it would just be a summon that does nothing — and only the exact
// string 'true' turns it on. Every other value (unset, 'false', the literal
// 'null'/'undefined' an old renderer write leaves behind) means "show the
// overlay", so a corrupt setting fails towards the visible surface rather than
// towards a mode with no UI.
function wantsHeadlessVoice(mode, headlessSetting) {
  if (mode !== 'voice') return false
  return String(headlessSetting) === 'true'
}
