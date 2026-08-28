.pragma library

// Line-level diff for the transcript's edit-tool cards.
//
// The plugin rendered an Edit/Write/MultiEdit tool call as
// `JSON.stringify(input)` — a single unreadable blob containing the ENTIRE old
// and new strings. The Electron front shows a diff instead
// (src/renderer/components/chat/toolUse/EditTools.tsx:20), which is the whole
// point of an edit card: you want to see what changed, not the payload that
// carried it.
//
// One exported function:
//
//   lineDiff(oldStr, newStr, cap?) -> { rows, truncated, added, removed }
//     rows: [{ op: " " | "-" | "+", text }]  in display order
//     truncated: true when either side exceeded `cap` lines and the diff was
//                skipped (rows is empty) — the caller must say so rather than
//                silently showing nothing
//
// Standard LCS backtrack. The table is O(n*m), so `cap` bounds it: a Write of
// a whole file can be thousands of lines and a quadratic table on the UI
// thread would freeze the transcript. 400x400 is 160k cells — a few ms — and
// past that a diff is not something a human reads in a chat bubble anyway.

var DEFAULT_CAP = 400

function _lines(s) {
  // A trailing newline produces a final "" element in a naive split, which
  // then shows up as a phantom changed line. Drop exactly one.
  var t = String(s === undefined || s === null ? "" : s)
  if (t.length === 0) return []
  if (t.charAt(t.length - 1) === "\n") t = t.slice(0, -1)
  return t.split("\n")
}

function lineDiff(oldStr, newStr, cap) {
  var limit = (typeof cap === "number" && cap > 0) ? cap : DEFAULT_CAP
  var a = _lines(oldStr)
  var b = _lines(newStr)

  if (a.length > limit || b.length > limit) {
    return ({ rows: [], truncated: true, added: 0, removed: 0 })
  }

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  var lcs = new Array(a.length + 1)
  for (var i = a.length; i >= 0; i--) {
    lcs[i] = new Array(b.length + 1)
    for (var j = b.length; j >= 0; j--) {
      if (i === a.length || j === b.length) {
        lcs[i][j] = 0
      } else if (a[i] === b[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1
      } else {
        lcs[i][j] = lcs[i + 1][j] >= lcs[i][j + 1] ? lcs[i + 1][j] : lcs[i][j + 1]
      }
    }
  }

  var rows = []
  var added = 0
  var removed = 0
  var x = 0
  var y = 0
  while (x < a.length && y < b.length) {
    if (a[x] === b[y]) {
      rows.push({ op: " ", text: a[x] })
      x++
      y++
    } else if (lcs[x + 1][y] >= lcs[x][y + 1]) {
      // Deletions before insertions at the same position, so a replaced line
      // reads as "- old" then "+ new" rather than the other way round.
      rows.push({ op: "-", text: a[x] })
      removed++
      x++
    } else {
      rows.push({ op: "+", text: b[y] })
      added++
      y++
    }
  }
  while (x < a.length) {
    rows.push({ op: "-", text: a[x] })
    removed++
    x++
  }
  while (y < b.length) {
    rows.push({ op: "+", text: b[y] })
    added++
    y++
  }

  return ({ rows: rows, truncated: false, added: added, removed: removed })
}
