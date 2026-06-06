export type SherpaFamily = 'transducer' | 'whisper' | 'paraformer' | 'nemoCtc'

export interface SherpaDetection {
  family: SherpaFamily
  /** Role → basename, relative to the model folder. */
  models: Record<string, string>
  /** Basename of the tokens/vocab file. */
  tokens: string
}

const isOnnx = (f: string) => f.toLowerCase().endsWith('.onnx')
const has = (f: string, kw: string) => f.toLowerCase().includes(kw)

/**
 * Map a model folder's filenames to a sherpa-onnx offline family + role assignment.
 * Pure: takes basenames, returns relative names. Throws with a descriptive message
 * when the folder does not match any supported sherpa layout.
 */
export function detectArchitecture(fileNames: string[]): SherpaDetection {
  const onnx = fileNames.filter(isOnnx)
  const tokens =
    fileNames.find((f) => /(^|[-_/])tokens\.txt$/i.test(f)) ||
    fileNames.find((f) => /tokens\.txt$/i.test(f)) ||
    fileNames.find((f) => /vocab\.txt$/i.test(f))
  if (!tokens) {
    throw new Error(
      `No tokens.txt/vocab.txt found in model folder (files: ${fileNames.join(', ') || 'none'}).`,
    )
  }

  const encoder = onnx.find((f) => has(f, 'encoder'))
  const joiner = onnx.find((f) => has(f, 'joiner'))
  const decoder = onnx.find((f) => has(f, 'decoder') && !has(f, 'joiner'))

  if (encoder && decoder && joiner) {
    return { family: 'transducer', models: { encoder, decoder, joiner }, tokens }
  }
  if (encoder && decoder) {
    return { family: 'whisper', models: { encoder, decoder }, tokens }
  }

  const paraformer = onnx.find((f) => has(f, 'paraformer'))
  if (paraformer) {
    return { family: 'paraformer', models: { model: paraformer }, tokens }
  }
  const ctc = onnx.find((f) => has(f, 'ctc'))
  if (ctc) {
    return { family: 'nemoCtc', models: { model: ctc }, tokens }
  }
  if (onnx.length === 1) {
    throw new Error(
      `Ambiguous single-model folder "${onnx[0]}": cannot tell paraformer from CTC by filename. ` +
        `Use a transducer/whisper model, or rename the file to include "paraformer" or "ctc".`,
    )
  }
  throw new Error(
    `Unrecognized sherpa model layout. onnx files: ${onnx.join(', ') || 'none'}; tokens: ${tokens}.`,
  )
}
