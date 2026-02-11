import * as path from 'path'

// Blocked system directories that should never be read
const BLOCKED_PREFIXES = ['/proc', '/sys', '/dev', '/boot', '/sbin', '/etc']

export function validateString(value: unknown, name: string, maxLength = 10000): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  if (value.length > maxLength) throw new Error(`${name} exceeds max length (${maxLength})`)
  return value
}

export function validatePositiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

export function validatePathSafe(filePath: string, allowedBase?: string): string {
  const resolved = path.resolve(filePath)

  // Block system directories
  for (const prefix of BLOCKED_PREFIXES) {
    if (resolved.startsWith(prefix + '/') || resolved === prefix) {
      throw new Error(`Access denied: ${prefix} is a protected directory`)
    }
  }

  // If an allowedBase is provided, ensure path stays within it
  if (allowedBase) {
    const resolvedBase = path.resolve(allowedBase)
    if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) {
      throw new Error(`Path traversal detected: ${resolved} is outside ${resolvedBase}`)
    }
  }

  return resolved
}
