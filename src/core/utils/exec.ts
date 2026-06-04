import { execFile } from 'child_process'

/** Promisified execFile with a 5s timeout; resolves trimmed stdout, rejects on error. */
export function execFileAsync(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}
