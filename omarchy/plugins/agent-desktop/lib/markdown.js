.pragma library

// Split a markdown message into ordered blocks of {kind:'md'|'code', text,
// lang?}, cut at fenced-code boundaries.
//
// Qt 6.11's Text { textFormat: Text.MarkdownText } parses CommonMark plus
// the GitHub extensions — tables, task lists, strikethrough, autolinks — but
// treats fenced code as plain monospace without syntax highlighting (QTextDocument
// docs). So we lift fenced blocks out and render them with the dedicated
// CodeBlock delegate; everything else goes through Text.MarkdownText.
//
// Supports ``` and ~~~ fences. An opening fence without a matching closer
// runs to end of input — that's what the renderer's ReactMarkdown does too,
// and it's what makes copy/paste of a half-typed code snippet legible.

var FENCE_TRIPLE_BACKTICK = "```"
var FENCE_TRIPLE_TILDE = "~~~"

function split(text) {
  if (text === undefined || text === null) return []
  var src = String(text)
  if (src.length === 0) return []

  var blocks = []
  var lines = src.split("\n")
  var i = 0
  var inCode = false
  var fenceMarker = ""
  var fenceLen = 0
  var fenceLang = ""
  var buffer = [] // current block being built
  var codeBuffer = []

  function flushMd() {
    if (buffer.length === 0) return
    blocks.push({ kind: "md", text: buffer.join("\n") })
    buffer = []
  }
  function flushCode() {
    if (codeBuffer.length === 0) return
    var payload = ({})
    payload.kind = "code"
    payload.text = codeBuffer.join("\n")
    if (fenceLang) payload.lang = fenceLang
    blocks.push(payload)
    codeBuffer = []
  }

  while (i < lines.length) {
    var line = lines[i]
    if (!inCode) {
      var fenceInfo = detectOpenFence(line)
      if (fenceInfo) {
        flushMd()
        inCode = true
        fenceMarker = fenceInfo.marker
        fenceLen = fenceInfo.len
        fenceLang = fenceInfo.lang
        codeBuffer = []
      } else {
        buffer.push(line)
      }
    } else {
      // Inside a code block: same marker char + at least as long as the
      // opener (closing fences with extra chars are allowed by CommonMark).
      var closeInfo = detectCloseFence(line, fenceMarker, fenceLen)
      if (closeInfo) {
        flushCode()
        inCode = false
        fenceMarker = ""
        fenceLen = 0
        fenceLang = ""
      } else {
        codeBuffer.push(line)
      }
    }
    i++
  }
  if (inCode) {
    // Unterminated fence: keep the accumulated code (no closing delimiter).
    flushCode()
  } else {
    flushMd()
  }
  return blocks
}

function detectOpenFence(line) {
  // Backtick fence — pragmatic: accept the info string whether or not a
  // separator whitespace is present, matching the renderer's behaviour.
  var m = /^(\s*)(`{3,})(?:[ \t]*([^\s`][^\s`]*))?[^`]*$/.exec(line)
  if (m) {
    var marker = m[2]
    var lang = (m[3] || "").trim()
    return ({ marker: marker, len: marker.length, lang: lang })
  }
  // Tilde fence (no info string after, per CommonMark)
  var t = /^(\s*)(~{3,}).*$/.exec(line)
  if (t) {
    return ({ marker: t[2], len: t[2].length, lang: "" })
  }
  return null
}

function detectCloseFence(line, marker, len) {
  if (!marker) return null
  var c = marker[0]
  var pattern
  if (c === "`") {
    pattern = /^(\s*)(`{3,})\s*$/
  } else if (c === "~") {
    pattern = /^(\s*)(~{3,})\s*$/
  } else {
    return null
  }
  var m = pattern.exec(line)
  if (!m) return null
  if (m[2].length < len) return null
  // Tilde close can be any length ≥ opener; backtick close too. The CommonMark
  // rule about indentation stripping applies, but the renderer doesn't care,
  // and QML doesn't need it perfect.
  return ({ marker: m[2], len: m[2].length })
}
