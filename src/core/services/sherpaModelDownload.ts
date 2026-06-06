import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'
import { SHERPA_MODEL_PRESETS } from './sherpaPresets'

export interface DownloadProgress {
  file: string
  index: number
  total: number
}

export function getModelsRoot(): string {
  return path.join(os.homedir(), '.agent-desktop', 'stt-models')
}

/**
 * Download every file of a preset from HuggingFace into ~/.agent-desktop/stt-models/<id>/.
 * Returns the destination folder. Reports coarse per-file progress.
 */
export async function downloadPreset(
  presetId: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<string> {
  const preset = SHERPA_MODEL_PRESETS.find((p) => p.id === presetId)
  if (!preset) throw new Error(`Unknown sherpa preset: ${presetId}`)

  const destDir = path.join(getModelsRoot(), preset.id)
  await fs.mkdir(destDir, { recursive: true })

  for (let i = 0; i < preset.files.length; i++) {
    const file = preset.files[i]
    const url = `https://huggingface.co/${preset.repo}/resolve/main/${file}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${file}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.writeFile(path.join(destDir, path.basename(file)), buf)
    onProgress?.({ file, index: i, total: preset.files.length })
  }
  return destDir
}
