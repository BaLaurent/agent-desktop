import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ensureSelfSignedCert } from './cert'

describe('ensureSelfSignedCert', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cert-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('generates cert and key when missing', async () => {
    const sslDir = path.join(tmpDir, 'ssl')
    const result = await ensureSelfSignedCert(sslDir)

    expect(result.key.length).toBeGreaterThan(0)
    expect(result.cert.length).toBeGreaterThan(0)
    expect(result.key.toString()).toContain('PRIVATE KEY')
    expect(result.cert.toString()).toContain('CERTIFICATE')

    // Files should exist on disk
    const keyFile = await fs.readFile(path.join(sslDir, 'key.pem'), 'utf-8')
    expect(keyFile).toContain('PRIVATE KEY')
  })

  it('reuses existing cert if already present', async () => {
    const sslDir = path.join(tmpDir, 'ssl')

    const first = await ensureSelfSignedCert(sslDir)
    const second = await ensureSelfSignedCert(sslDir)

    expect(first.key.equals(second.key)).toBe(true)
    expect(first.cert.equals(second.cert)).toBe(true)
  })

  it('regenerates if cert file is empty', async () => {
    const sslDir = path.join(tmpDir, 'ssl')
    await fs.mkdir(sslDir, { recursive: true })

    await fs.writeFile(path.join(sslDir, 'key.pem'), '')
    await fs.writeFile(path.join(sslDir, 'cert.pem'), '')

    const result = await ensureSelfSignedCert(sslDir)
    expect(result.key.length).toBeGreaterThan(0)
    expect(result.cert.toString()).toContain('CERTIFICATE')
  })
})
