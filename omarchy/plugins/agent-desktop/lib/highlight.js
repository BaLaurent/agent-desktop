.pragma library

// A small regex-based syntax highlighter.
//
// A decision, so it lives in JS rather than in a QML binding: Text.MarkdownText
// in Qt 6.11 produces plain monospace for fenced code, and the renderer needs
// real tokens to drive the colour-by-class pipeline. A tiny regex tokenizer
// is enough for the seven languages the chat UI actually highlights, and it
// is small enough to keep node-testable.
//
// Output: an array of {text, cls} tokens, plus a helper that renders Qt
// rich-text with explicit HTML escaping — `& < >` MUST be escaped before
// wrapping in spans, because an unescaped `<` in source code silently eats
// the rest of the block in any rich-text engine.

var TOKEN_KW = "kw"
var TOKEN_STR = "str"
var TOKEN_NUM = "num"
var TOKEN_CMT = "cmt"
var TOKEN_FN = "fn"
var TOKEN_TYP = "typ"
var TOKEN_OP = "op"
var TOKEN_PLAIN = "plain"

var LANG_ALIASES = {
  javascript: "js", js: "js", typescript: "ts", ts: "ts", tsx: "ts", jsx: "js",
  python: "py", py: "py",
  json: "json", jsonc: "json",
  bash: "bash", sh: "bash", shell: "bash", zsh: "bash",
  diff: "diff", patch: "diff"
}

// A token shape:
//   { text: "fn", cls: "fn" }
//
// Rules are tried top-to-bottom per language; the first match wins.

var RULES_JS = [
  { re: /\/\/[^\n]*/g, cls: TOKEN_CMT },
  { re: /\/\*[\s\S]*?\*\//g, cls: TOKEN_CMT },
  { re: /"(?:\\.|[^"\\\n])*"/g, cls: TOKEN_STR },
  { re: /'(?:\\.|[^'\\\n])*'/g, cls: TOKEN_STR },
  { re: /`(?:\\.|[^`\\])*`/g, cls: TOKEN_STR },
  { re: /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|default|break|continue|new|class|extends|super|this|import|export|from|as|async|await|try|catch|finally|throw|typeof|instanceof|in|of|void|yield|null|undefined|true|false)\b/g, cls: TOKEN_KW },
  { re: /\b\d+(?:\.\d+)?\b/g, cls: TOKEN_NUM },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: TOKEN_TYP },
  { re: /\b([a-zA-Z_$][\w$]*)(?=\s*\()/g, cls: TOKEN_FN }
]

var RULES_PY = [
  { re: /#[^\n]*/g, cls: TOKEN_CMT },
  { re: /"""[\s\S]*?"""/g, cls: TOKEN_STR },
  { re: /'''[\s\S]*?'''/g, cls: TOKEN_STR },
  { re: /"(?:\\.|[^"\\\n])*"/g, cls: TOKEN_STR },
  { re: /'(?:\\.|[^'\\\n])*'/g, cls: TOKEN_STR },
  { re: /\b(?:def|return|if|elif|else|for|while|break|continue|class|import|from|as|with|try|except|finally|raise|pass|lambda|yield|async|await|True|False|None|and|or|not|in|is|global|nonlocal)\b/g, cls: TOKEN_KW },
  { re: /\b\d+(?:\.\d+)?\b/g, cls: TOKEN_NUM },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: TOKEN_TYP },
  { re: /\b([a-zA-Z_][\w]*)(?=\s*\()/g, cls: TOKEN_FN }
]

var RULES_JSON = [
  { re: /"(?:\\.|[^"\\\n])*"(?=\s*:)/g, cls: TOKEN_KW }, // keys
  { re: /"(?:\\.|[^"\\\n])*"/g, cls: TOKEN_STR },         // values
  { re: /\b(?:true|false|null)\b/g, cls: TOKEN_KW },
  { re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, cls: TOKEN_NUM }
]

var RULES_BASH = [
  { re: /#[^\n]*/g, cls: TOKEN_CMT },
  { re: /"(?:\\.|[^"\\\n])*"/g, cls: TOKEN_STR },
  { re: /'(?:\\.|[^'\\\n])*'/g, cls: TOKEN_STR },
  { re: /\$\{[^}]+\}/g, cls: TOKEN_TYP },
  { re: /\$[A-Za-z_][\w]*/g, cls: TOKEN_TYP },
  { re: /\b(?:if|then|else|elif|fi|for|in|do|done|while|case|esac|function|return|exit|export|local|set|unset|readonly|declare|source)\b/g, cls: TOKEN_KW },
  { re: /\b\d+\b/g, cls: TOKEN_NUM },
  { re: /\b([a-zA-Z_][\w-]*)(?=\s*\()/g, cls: TOKEN_FN }
]

var RULES_DIFF = [
  // Whole lines starting with +/-/@@/diff --git get a single-line class.
  { re: /^@@.*$/gm, cls: TOKEN_TYP },
  { re: /^\+[^\n]*$/gm, cls: "add" },
  { re: /^-[^\n]*$/gm, cls: "del" },
  { re: /^diff[^\n]*$/gm, cls: TOKEN_TYP }
]

var RULES_BY_LANG = {
  js: RULES_JS,
  ts: RULES_JS,
  py: RULES_PY,
  json: RULES_JSON,
  bash: RULES_BASH,
  diff: RULES_DIFF
}

function resolveLang(lang) {
  if (!lang) return null
  var key = String(lang).toLowerCase()
  return LANG_ALIASES[key] || key
}

function tokens(code, lang) {
  if (!code) return []
  var resolved = resolveLang(lang)
  var rules = resolved && RULES_BY_LANG[resolved]
  if (!rules) {
    return [{ text: String(code), cls: TOKEN_PLAIN }]
  }

  // Collect every match first across all rules, then merge into a sorted,
  // non-overlapping stream.
  var hits = []
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i]
    // .lastIndex-managed regexes cannot be reused safely across calls — clone
    // each rule's source by creating a fresh RegExp from its flags.
    var re = new RegExp(rule.re.source, rule.re.flags)
    var m
    while ((m = re.exec(code)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      var hit = ({})
      hit.start = m.index
      hit.end = m.index + m[0].length
      hit.cls = rule.cls
      // For rules that capture group 1 as the actual token (function names,
      // types), wrap the captured group with the class and the surrounding
      // match as plain.
      if (m.length > 1 && m[1] && (rule.cls === TOKEN_FN || rule.cls === TOKEN_TYP)) {
        var inner = m.index + m[0].indexOf(m[1])
        if (inner > m.index) {
          hits.push({ start: m.index, end: inner, cls: TOKEN_PLAIN })
        }
        hits.push({ start: inner, end: inner + m[1].length, cls: rule.cls })
        if (inner + m[1].length < hit.end) {
          hits.push({ start: inner + m[1].length, end: hit.end, cls: TOKEN_PLAIN })
        }
      } else {
        hits.push(hit)
      }
      // Guard against zero-width infinite loops even though the empty-string
      // check above should have caught them.
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }
  hits.sort(function (a, b) { return a.start - b.start })
  // Drop overlaps: a hit keeps its class only if no earlier hit covered it.
  var accepted = []
  var lastEnd = 0
  for (var k = 0; k < hits.length; k++) {
    var h = hits[k]
    if (h.start < lastEnd) continue
    accepted.push(h)
    lastEnd = h.end
  }
  // Build the output stream, padding with plain where nothing matched.
  var out = []
  var cursor = 0
  for (var j = 0; j < accepted.length; j++) {
    var a = accepted[j]
    if (a.start > cursor) {
      out.push({ text: code.slice(cursor, a.start), cls: TOKEN_PLAIN })
    }
    out.push({ text: code.slice(a.start, a.end), cls: a.cls })
    cursor = a.end
  }
  if (cursor < code.length) {
    out.push({ text: code.slice(cursor), cls: TOKEN_PLAIN })
  }
  return out
}

function escapeHtml(s) {
  // & must be replaced first so the other replacements don't double-encode.
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

// Render the tokens as a Qt rich-text string. A single root span sets the
// monospace family; per-token spans set the colour class. The caller may
// pass a `colors` map of {cls: hex} pairs; defaults are sensible.
function toRichText(code, lang, colors) {
  var c = colors || {}
  function col(cls) { return c[cls] || "" }
  var toks = tokens(code, lang)
  var family = c.family || "monospace"
  var defaultColor = c.defaultColor || "#dde3e6"
  var out = []
  out.push('<span style="font-family:' + escapeHtml(family) + '; color:' + escapeHtml(defaultColor) + '">')
  for (var i = 0; i < toks.length; i++) {
    var t = toks[i]
    var color = col(t.cls)
    if (color) {
      out.push('<span style="color:' + escapeHtml(color) + '">' + escapeHtml(t.text) + '</span>')
    } else {
      out.push(escapeHtml(t.text))
    }
  }
  out.push('</span>')
  return out.join("")
}
