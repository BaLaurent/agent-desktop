import { readdir, readFile, mkdir, writeFile, stat, unlink } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import ts from 'typescript'
import type { VariableFn } from './types'
import { createLogger } from '../../utils/logger'

const log = createLogger('variableResolver')

const DEFAULT_DIR = join(homedir(), '.agent-desktop', 'functions')

export function getFunctionsDir(): string {
  return DEFAULT_DIR
}

const CACHE_SUBDIR = '.cache'

interface CacheEntry {
  mtimeMs: number
  fn: VariableFn
}

const moduleCache = new Map<string, CacheEntry>()
const overrideWarnedFor = new Set<string>()

/** Reset internal caches — exported for tests only. */
// consumed by customLoader.test.ts and variableResolver/index.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export function _resetCacheForTests(): void {
  moduleCache.clear()
  overrideWarnedFor.clear()
}

/** Emit one warn line per custom override (first load only). */
export function warnOverrideOnce(name: string): void {
  if (overrideWarnedFor.has(name)) return
  overrideWarnedFor.add(name)
  log.warn('custom override for builtin', { name })
}

/** Delete any existing <name>-*.mjs files in cacheDir, ignoring errors. */
async function pruneStaleCacheFor(name: string, cacheDir: string): Promise<void> {
  try {
    const entries = await readdir(cacheDir)
    const prefix = `${name}-`
    const stale = entries.filter(f => f.startsWith(prefix) && f.endsWith('.mjs'))
    await Promise.all(stale.map(f => unlink(join(cacheDir, f)).catch(() => {})))
  } catch {
    // cacheDir might not exist yet — fine
  }
}

/**
 * Load a custom variable function from <functionsDir>/<name>.ts.
 * - Returns null if no file exists
 * - Transpiles TS → ESM via ts.transpileModule
 * - Caches by mtime: retranspiles only when source changed
 * - Imports the transpiled .mjs via dynamic import
 */
export async function loadCustomVariable(
  name: string,
  functionsDir: string = DEFAULT_DIR
): Promise<VariableFn | null> {
  const srcPath = join(functionsDir, `${name}.ts`)
  const srcStat = await stat(srcPath).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  if (!srcStat) return null
  const cacheKey = `${functionsDir}::${name}`
  const cached = moduleCache.get(cacheKey)
  if (cached && cached.mtimeMs === srcStat.mtimeMs) {
    return cached.fn
  }

  const cacheDir = join(functionsDir, CACHE_SUBDIR)
  await mkdir(cacheDir, { recursive: true })
  await pruneStaleCacheFor(name, cacheDir)

  const source = await readFile(srcPath, 'utf-8')

  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: true,
    },
    fileName: srcPath,
    reportDiagnostics: true,
  })

  const errorDiagnostics = (result.diagnostics ?? []).filter(
    d => d.category === ts.DiagnosticCategory.Error
  )
  if (errorDiagnostics.length > 0) {
    const messages = errorDiagnostics
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('; ')
    throw new Error(`${name}.ts: erreur de transpilation — ${messages}`)
  }

  const { outputText } = result

  const cacheFile = join(cacheDir, `${name}-${srcStat.mtimeMs}.mjs`)
  await writeFile(cacheFile, outputText, 'utf-8')

  const mod = await import(pathToFileURL(cacheFile).href)
  const fn = (mod.default ?? mod) as unknown

  if (typeof fn !== 'function') {
    throw new Error(`${name}.ts: export default doit être une fonction`)
  }

  const typedFn = fn as VariableFn
  moduleCache.set(cacheKey, { mtimeMs: srcStat.mtimeMs, fn: typedFn })
  return typedFn
}

/**
 * Parse the leading JSDoc block of a custom variable source file.
 * - Description = text before the first @tag (whitespace-collapsed)
 * - argsHint = names extracted from @arg / @param tags, joined by ':'
 *   Brackets around a name ([foo]) → optional → suffix '?'
 * Returns empty object if file is missing, has no JSDoc, or parsing yields nothing.
 */
export async function readCustomVariableMetadata(
  name: string,
  functionsDir: string = DEFAULT_DIR
): Promise<{ description?: string; argsHint?: string }> {
  const srcPath = join(functionsDir, `${name}.ts`)
  let source: string
  try {
    source = await readFile(srcPath, 'utf-8')
  } catch {
    return {}
  }

  const block = source.match(/\/\*\*([\s\S]*?)\*\//)
  if (!block) return {}

  const body = block[1]
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim()

  const firstTagIdx = body.search(/^@\w+/m)
  const descPart = firstTagIdx === -1 ? body : body.slice(0, firstTagIdx).trim()
  const tagsPart = firstTagIdx === -1 ? '' : body.slice(firstTagIdx)

  const description = descPart.length > 0 ? descPart.replace(/\s+/g, ' ') : undefined

  const argNames: string[] = []
  // @arg or @param, optional {type}, then [name] or name
  const tagRe = /@(?:arg|param)(?:\s+\{[^}]*\})?\s+(\[?[a-zA-Z_$][\w$]*\]?)/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(tagsPart)) !== null) {
    let argName = m[1]
    if (argName.startsWith('[') && argName.endsWith(']')) {
      argName = argName.slice(1, -1) + '?'
    }
    argNames.push(argName)
  }
  const argsHint = argNames.length > 0 ? argNames.join(':') : undefined

  return { description, argsHint }
}

/** List basenames of .ts files in functionsDir (no extension, ignores .cache contents). */
export async function listCustomVariables(
  functionsDir: string = DEFAULT_DIR
): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(functionsDir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  return entries
    .filter(f => extname(f) === '.ts')
    .map(f => basename(f, '.ts'))
}
