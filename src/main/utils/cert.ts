import * as fs from 'fs/promises'
import * as path from 'path'
import { execFile } from 'child_process'

interface CertResult {
  key: Buffer
  cert: Buffer
}

export async function ensureSelfSignedCert(sslDir: string): Promise<CertResult> {
  const keyPath = path.join(sslDir, 'key.pem')
  const certPath = path.join(sslDir, 'cert.pem')

  // Return existing cert if both files are readable and non-empty
  try {
    const [key, cert] = await Promise.all([
      fs.readFile(keyPath),
      fs.readFile(certPath),
    ])
    if (key.length > 0 && cert.length > 0) return { key, cert }
  } catch {
    // Files missing or unreadable — generate below
  }

  // Ensure directory exists
  await fs.mkdir(sslDir, { recursive: true })

  // Generate self-signed cert via OpenSSL
  await new Promise<void>((resolve, reject) => {
    execFile('openssl', [
      'req', '-x509',
      '-newkey', 'ec',
      '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-keyout', keyPath,
      '-out', certPath,
      '-days', '3650',
      '-nodes',
      '-subj', '/CN=Agent Desktop',
      '-addext', 'subjectAltName=IP:127.0.0.1,IP:::1,DNS:localhost',
    ], { timeout: 10_000 }, (err, _stdout, stderr) => {
      if (err) {
        const hint = stderr?.trim().slice(0, 200) || err.message
        reject(new Error(`Failed to generate SSL certificate: ${hint}. Is openssl installed?`))
      } else {
        resolve()
      }
    })
  })

  // Read the generated files
  const [key, cert] = await Promise.all([
    fs.readFile(keyPath),
    fs.readFile(certPath),
  ])
  return { key, cert }
}
