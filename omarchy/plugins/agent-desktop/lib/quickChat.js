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

// listResult is the value returned by conversations:list — an array of
// Conversation rows.
function pickCreatedId(createResult, listResult) {
  if (createResult !== null && createResult !== undefined && createResult !== 0) {
    var fromCreate = Number(createResult)
    if (isFinite(fromCreate) && fromCreate > 0) return Math.floor(fromCreate)
  }

  if (!Array.isArray(listResult)) return 0

  var highest = 0
  for (var i = 0; i < listResult.length; i++) {
    var row = listResult[i]
    if (!row || row.title !== 'Quick Chat') continue
    var id = Number(row.id)
    if (!isFinite(id)) continue
    if (id > highest) highest = id
  }
  return highest > 0 ? Math.floor(highest) : 0
}
