#!/usr/bin/env node
/**
 * Fetch sherpa-onnx-node native prebuilds for the platforms we PACKAGE, not just the
 * host. `npm install` only pulls the host's optionalDependency, but a release built on
 * one Linux box also ships Linux-arm64 + Windows-x64 AppImages/installers — each needs
 * its own native binary present in node_modules at electron-builder time.
 *
 * Why `npm pack` and not `npm install --cpu/--os`: under npm 11 a cross-platform
 * `npm install` is rejected with EBADPLATFORM, and `--force` "fixes" the error only by
 * reconciling the whole optional-dependency set for that one target — which PRUNES the
 * other platforms' prebuilds (and the host's). `npm pack` just downloads the tarball
 * (no platform check, no dependency-tree mutation), so prebuilds accumulate
 * side-effect-free on any host. The prebuild tarballs are self-contained (the `.node`
 * addon + its `.so`/`.dll`, no postinstall step).
 *
 * For a single-group build we also PRUNE prebuilds outside the requested group, so the
 * AppImage/installer never bundles a foreign platform's native binary (electron-builder's
 * `files` filter bundles every `sherpa-onnx-*` dir that happens to be present).
 *
 * Idempotent: skips a target whose `.node` addon is already present.
 *
 * Usage:  node scripts/fetch-sherpa-prebuilds.mjs [linux|win|all]   (default: all)
 *
 * No win-arm64: upstream sherpa-onnx-node has NO win-arm64 prebuild, so Sherpa STT is
 * unavailable on Windows ARM (the app degrades gracefully — whisper works). macOS is
 * intentionally omitted (built separately on a real Mac, where npm install suffices).
 */
import { readFileSync, existsSync, rmSync, mkdirSync, mkdtempSync, readdirSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { tmpdir } from 'os'

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
  { name: 'sherpa-onnx-linux-x64', group: 'linux' },
  { name: 'sherpa-onnx-linux-arm64', group: 'linux' },
  { name: 'sherpa-onnx-win-x64', group: 'win' },
]

const which = (process.argv[2] || 'all').toLowerCase()
if (!['linux', 'win', 'all'].includes(which)) {
  console.error(`Unknown target group "${which}". Use: linux | win | all`)
  process.exit(1)
}
const targets = which === 'all' ? ALL_TARGETS : ALL_TARGETS.filter((t) => t.group === which)
const nodeModules = join(root, 'node_modules')

// Prune prebuilds outside the requested group so a single-host build does not bundle a
// foreign platform's native binary. Skipped for `all` (which wants every prebuild).
if (which !== 'all') {
  for (const t of ALL_TARGETS) {
    if (t.group !== which && existsSync(join(nodeModules, t.name))) {
      console.log(`✗ pruning foreign prebuild ${t.name}`)
      rmSync(join(nodeModules, t.name), { recursive: true, force: true })
    }
  }
}

let fetched = 0
for (const t of targets) {
  const dest = join(nodeModules, t.name)
  if (existsSync(join(dest, 'sherpa-onnx.node'))) {
    console.log(`✓ ${t.name} already present`)
    continue
  }
  const tmp = mkdtempSync(join(tmpdir(), 'sherpa-prebuild-'))
  try {
    console.log(`→ npm pack ${t.name}@${version}`)
    execSync(`npm pack ${t.name}@${version} --pack-destination "${tmp}"`, { cwd: root, stdio: 'inherit' })
    const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'))
    if (!tgz) throw new Error(`npm pack produced no tarball for ${t.name}`)
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    // Tarball root is `package/`; strip it straight into node_modules/<name>/.
    execSync(`tar -xzf "${join(tmp, tgz)}" -C "${dest}" --strip-components=1`, { stdio: 'inherit' })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  fetched++
}
console.log(`Done. ${fetched} prebuild(s) fetched, ${targets.length - fetched} already present.`)
