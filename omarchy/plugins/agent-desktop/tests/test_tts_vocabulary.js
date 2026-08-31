const assert = require('assert')
const fs = require('fs')
const path = require('path')

// The settings UI may not invent values the SERVER cannot consume.
//
// It did, and text-to-speech was completely dead because of it. VoiceSettings
// offered a hand-typed response-mode list — "off" / "first" / "all" — while
// `speakResponse` (src/core/handlers/tts.ts) branches on off | full | summary |
// auto. A user who picked "All messages" stored "all", the if-chain matched
// nothing, and the call returned successfully having played nothing: the Speak
// button on every message and the automatic response TTS were both silent, with
// no error anywhere to explain it. The provider list had the same disease —
// "auto" (no such case; `speak()` throws "Unknown TTS provider") and the value
// "say" behind the label "spd-say" (`say` is macOS-only and refuses to run).
//
// Both lists are settings whose VALUES are a server contract, so this test
// checks them against the server's own sources rather than against a copy.
const PLUGIN = path.join(__dirname, '..')
const REPO = path.resolve(PLUGIN, '../../..')

const voiceSettings = fs.readFileSync(
  path.join(PLUGIN, 'components/VoiceSettings.qml'), 'utf8')
const ttsHandler = fs.readFileSync(
  path.join(REPO, 'src/core/handlers/tts.ts'), 'utf8')
const generated = fs.readFileSync(
  path.join(PLUGIN, 'generated/settingDefs.js'), 'utf8')

// ---- response mode -------------------------------------------------------
//
// The canonical list is the server's, emitted into generated/settingDefs.js.
// VoiceSettings must READ it, not restate it: a restated list is exactly what
// drifted. So the assertion is structural — the QML derives the options from
// SETTING_DEFS and contains no literal option list of its own.
const modeBlock = voiceSettings.match(
  /readonly property var ttsResponseModes:[\s\S]*?\n  \}/)
assert.ok(modeBlock, 'VoiceSettings.qml no longer declares ttsResponseModes')
assert.ok(
  /SETTING_DEFS/.test(modeBlock[0]) && /tts_responseMode/.test(modeBlock[0]),
  'ttsResponseModes must be derived from the server-generated SETTING_DEFS, ' +
    'not retyped in QML:\n' + modeBlock[0]
)
assert.ok(
  !/value:\s*"(first|all)"/.test(modeBlock[0]),
  'ttsResponseModes offers "first"/"all" again — values speakResponse has no ' +
    'branch for, which silently disables TTS entirely'
)

// The generated defs are the source that block reads, so they must actually
// carry the key with options; otherwise the dropdown renders empty.
const genModeOptions = generated.match(
  /"key":\s*"tts_responseMode"[\s\S]*?"options":\s*\[([\s\S]*?)\]/)
assert.ok(genModeOptions, 'generated/settingDefs.js has no tts_responseMode options')
const genModeValues = [...genModeOptions[1].matchAll(/"value":\s*"([^"]+)"/g)].map((m) => m[1])
assert.deepStrictEqual(
  genModeValues.slice().sort(),
  ['auto', 'full', 'off', 'summary'],
  'the server\'s response-mode vocabulary changed; re-run build:omarchy-consts ' +
    'and re-check speakResponse\'s branches'
)

// ---- provider ------------------------------------------------------------
//
// `speak()` switches on the raw setting string, so every value the dropdown can
// write must be a case in that switch (plus "off", handled before it).
const speakSwitch = ttsHandler.match(/switch \(provider\) \{([\s\S]*?)\n  \}/)
assert.ok(speakSwitch, 'could not find the provider switch in src/core/handlers/tts.ts')
const serverProviders = new Set(
  [...speakSwitch[1].matchAll(/case '([^']+)':/g)].map((m) => m[1]).concat('off')
)

const providerBlock = voiceSettings.match(
  /readonly property var ttsProviders:[\s\S]*?\n  \]/)
assert.ok(providerBlock, 'VoiceSettings.qml no longer declares ttsProviders')
const uiProviders = [...providerBlock[0].matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1])
assert.ok(uiProviders.length > 0, 'ttsProviders is empty')

for (const value of uiProviders) {
  assert.ok(
    serverProviders.has(value),
    `TTS provider "${value}" is offered by the settings UI but \`speak()\` has ` +
      `no case for it — picking it throws "Unknown TTS provider". Server ` +
      `accepts: ${[...serverProviders].join(', ')}`
  )
}

// `say` is guarded by a platform check that rejects on Linux, and this plugin
// only ever runs on the Omarchy (Linux) shell.
assert.ok(
  !uiProviders.includes('say'),
  'the Linux settings UI offers "say", which src/core/handlers/tts.ts refuses ' +
    'off-macOS ("say is only available on macOS")'
)

console.log('test_tts_vocabulary: ok')
