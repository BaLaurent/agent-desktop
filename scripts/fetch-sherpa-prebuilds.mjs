#!/usr/bin/env node
/**
 * Fetch sherpa-onnx-node native prebuilds for the platforms we PACKAGE, not just the
 * host. `npm install` only pulls the host's optionalDependency, but a release built on
 * one Linux box also ships Linux-arm64 + Windows-x64 AppImages/installers — each needs
 * its own native binary present in node_modules at electron-builder time.
 *
 * npm 9.4+ (`--cpu` / `--os`) lets us fetch a foreign-platform package on any host.
 * Idempotent: skips a target if its package is already present. Uses --no-save so these
 * transient cross-builds never land in package.json (they are sherpa-onnx-node's own
 * optionalDependencies, resolved by os/arch at runtime).
 *
 * Usage:  node scripts/fetch-sherpa-prebuilds.mjs [linux|win|all]   (default: all)
 *
 * No win-arm64 / win-ia32-only note: upstream sherpa-onnx-node has NO win-arm64 prebuild,
 * so Sherpa STT is unavailable on Windows ARM (the app degrades gracefully — whisper works).
 * macOS is intentionally omitted (built separately on a real Mac, where npm install suffices).
 */
import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const versionRange = pkg.dependencies?.['sherpa-onnx-node']
if (!versionRange) {
  console.error('sherpa-onnx-node is not a dependency; nothing to fetch.')
  process.exit(0)
}
const version = versionRange.replace(/^[^0-9]*/, '') // strip ^ / ~

// Targets we publish that are NOT the host platform's auto-installed one.
const ALL_TARGETS = [
  { name: 'sherpa-onnx-linux-x64', os: 'linux', cpu: 'x64', group: 'linux' },
  { name: 'sherpa-onnx-linux-arm64', os: 'linux', cpu: 'arm64', group: 'linux' },
  { name: 'sherpa-onnx-win-x64', os: 'win32', cpu: 'x64', group: 'win' },
]

const which = (process.argv[2] || 'all').toLowerCase()
const targets = which === 'all' ? ALL_TARGETS : ALL_TARGETS.filter((t) => t.group === which)
if (targets.length === 0) {
  console.error(`Unknown target group "${which}". Use: linux | win | all`)
  process.exit(1)
}

let fetched = 0
for (const t of targets) {
  if (existsSync(join(root, 'node_modules', t.name))) {
    console.log(`✓ ${t.name} already present`)
    continue
  }
  const cmd = `npm install --no-save --no-audit --no-fund --cpu=${t.cpu} --os=${t.os} ${t.name}@${version}`
  console.log(`→ ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit' })
  fetched++
}
console.log(`Done. ${fetched} prebuild(s) fetched, ${targets.length - fetched} already present.`)
