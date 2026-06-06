# Bundled openWakeWord models

The continuous-voice hotword detector (`src/renderer/services/hotword`) loads these ONNX models,
served to the renderer worker via `agent-model://hotword/<file>`:

- `melspectrogram.onnx` — stage 1 (shared, universal)
- `embedding_model.onnx` — stage 2 (shared, universal)
- `<wakeword>.onnx` — stage 3 pretrained wake words, e.g. `hey_jarvis.onnx`, `alexa.onnx`,
  `hey_mycroft.onnx`, `hey_rhasspy.onnx`

Download them from the openWakeWord release assets (https://github.com/dscripka/openWakeWord) and
drop the `.onnx` files here before packaging. Custom-trained models produced by the in-app trainer
are stored separately under the user data dir (`hotword-models/`) and served via
`agent-model://hotword-model/`.

This directory is bundled as `extraResources` (see `electron-builder.yml`); it must exist at package
time even if you ship only a subset of wake words.
