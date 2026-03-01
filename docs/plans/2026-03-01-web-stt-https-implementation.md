# Web STT HTTPS Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch the web server from HTTP to HTTPS using an auto-generated self-signed certificate, enabling `getUserMedia()` for voice input in web mode.

**Architecture:** On first `startServer()`, generate a self-signed EC P-256 cert via OpenSSL CLI and store it in `~/.config/agent-desktop/ssl/`. Use `https.createServer()` instead of `http.createServer()`. All URL generation switches to `https://`. The WS shim already auto-detects `wss:` via `location.protocol`.

**Tech Stack:** Node.js `https` module, OpenSSL CLI (spawned via `child_process`), existing `ws` WebSocket library.

---

### Task 1: Create cert generation utility

**Files:**
- Create: `src/main/utils/cert.ts`

**Step 1: Write `ensureSelfSignedCert` function**

```typescript
// src/main/utils/cert.ts
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

  // Return existing cert if both files are readable
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
      '-pkeyopt', 'ec_paramgen_curve:prime256r1',
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
```

**Step 2: Commit**

```bash
git add src/main/utils/cert.ts
git commit -m "feat(web): add self-signed cert generation utility"
```

---

### Task 2: Test cert generation utility

**Files:**
- Create: `src/main/utils/cert.test.ts`

**Step 1: Write tests for `ensureSelfSignedCert`**

```typescript
// src/main/utils/cert.test.ts
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

    // Generate once
    const first = await ensureSelfSignedCert(sslDir)
    // Read again — should return same content
    const second = await ensureSelfSignedCert(sslDir)

    expect(first.key.equals(second.key)).toBe(true)
    expect(first.cert.equals(second.cert)).toBe(true)
  })

  it('regenerates if cert file is empty', async () => {
    const sslDir = path.join(tmpDir, 'ssl')
    await fs.mkdir(sslDir, { recursive: true })

    // Create empty files
    await fs.writeFile(path.join(sslDir, 'key.pem'), '')
    await fs.writeFile(path.join(sslDir, 'cert.pem'), '')

    const result = await ensureSelfSignedCert(sslDir)
    expect(result.key.length).toBeGreaterThan(0)
    expect(result.cert.toString()).toContain('CERTIFICATE')
  })
})
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/main/utils/cert.test.ts`
Expected: 3 tests PASS

**Step 3: Commit**

```bash
git add src/main/utils/cert.test.ts
git commit -m "test(web): add cert generation tests"
```

---

### Task 3: Switch webServer to HTTPS

**Files:**
- Modify: `src/main/services/webServer.ts`

This is the core change. Key modifications:

**Step 1: Add imports and update `startServer`**

At the top of `webServer.ts`, add:
```typescript
import * as https from 'https'
import { app } from 'electron'
import { ensureSelfSignedCert } from '../utils/cert'
```

**Step 2: Refactor `startServer` to be async with cert loading**

Change `startServer` from:
```typescript
export function startServer(port: number, options?: ServerStartOptions): Promise<{ url: string; token: string }> {
  return new Promise((resolve, reject) => {
    if (httpServer) {
      // ...existing early return for already-running server
    }
    // ...
    httpServer = http.createServer((req, res) => { ... })
    // ...
  })
}
```

To:
```typescript
export async function startServer(port: number, options?: ServerStartOptions): Promise<{ url: string; token: string }> {
  // Return existing server if already running
  if (httpServer) {
    const ip = getLanIp()
    const url = serverShortCode
      ? `https://${ip}:${serverPort}/s/${serverShortCode}`
      : `https://${ip}:${serverPort}?token=${serverToken}`
    return { url, token: serverToken! }
  }

  // Load or generate SSL certificate
  const sslDir = path.join(app.getPath('userData'), 'ssl')
  const { key, cert } = await ensureSelfSignedCert(sslDir)

  serverToken = crypto.randomBytes(32).toString('hex')
  serverPort = port
  serverShortCode = options?.shortCode || generateShortCode()
  serverAccessMode = options?.accessMode === 'all' ? 'all' : 'lan'
  const shimScript = generateShim(serverToken)
  const devUrl = process.env.ELECTRON_RENDERER_URL

  return new Promise((resolve, reject) => {
    httpServer = https.createServer({ key, cert }, (req, res) => {
      // ... same request handler as before ...
    })

    wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 })
    // ... rest of the function stays identical ...
  })
}
```

**Step 3: Update ALL URL strings from `http://` to `https://`**

Every place that builds a URL must switch protocol:

1. `startServer` early return (already-running server) — change `http://` to `https://`
2. `startServer` listen callback — change `http://` to `https://`
3. `getServerStatus` — change `http://` to `https://`
4. URL constructor in request handler — this is just for parsing, can stay `http://localhost` (internal only)

Search for all occurrences: `grep 'http://' src/main/services/webServer.ts`

**Step 4: Update variable type**

The `httpServer` variable is typed as `http.Server | null`. Since `https.Server` extends `tls.Server` extends `net.Server` (not `http.Server`), update the type:

```typescript
let httpServer: http.Server | https.Server | null = null
```

Or simpler, since we only call `.listen()`, `.close()`, `.on()` (all from `net.Server`):
```typescript
import type { Server as HttpsServer } from 'https'
// ...
let httpServer: http.Server | HttpsServer | null = null
```

**Step 5: Commit**

```bash
git add src/main/services/webServer.ts
git commit -m "feat(web): switch web server from HTTP to HTTPS"
```

---

### Task 4: Update webServer tests for HTTPS

**Files:**
- Modify: `src/main/services/webServer.test.ts`

The tests currently use `http://` URLs and `ws://` WebSocket connections. They need:
1. A mock for `ensureSelfSignedCert` (or a real test cert)
2. `NODE_TLS_REJECT_UNAUTHORIZED=0` for `fetch()` to accept self-signed certs
3. `wss://` URLs with `{ rejectUnauthorized: false }` for WebSocket

**Step 1: Add cert mock and TLS setup**

Add mock for `../utils/cert` and `electron` (for `app.getPath`). Generate a real test cert in `beforeAll` so `https.createServer` gets valid PEM data:

```typescript
import { execFileSync } from 'child_process'

// Mock electron app (not available in test env)
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/agent-test') },
}))

// Generate a test cert once for all tests
let testKey: Buffer
let testCert: Buffer

beforeAll(async () => {
  const tmpSsl = path.join(os.tmpdir(), `webserver-test-ssl-${Date.now()}`)
  await fs.mkdir(tmpSsl, { recursive: true })
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec',
    '-pkeyopt', 'ec_paramgen_curve:prime256r1',
    '-keyout', path.join(tmpSsl, 'key.pem'),
    '-out', path.join(tmpSsl, 'cert.pem'),
    '-days', '1', '-nodes',
    '-subj', '/CN=Test',
  ])
  testKey = await fs.readFile(path.join(tmpSsl, 'key.pem'))
  testCert = await fs.readFile(path.join(tmpSsl, 'cert.pem'))
})

// Mock cert module to return our test cert
vi.mock('../utils/cert', () => ({
  ensureSelfSignedCert: vi.fn(),
}))

// In beforeEach, set the mock return value:
import { ensureSelfSignedCert } from '../utils/cert'
beforeEach(() => {
  vi.mocked(ensureSelfSignedCert).mockResolvedValue({ key: testKey, cert: testCert })
})
```

**Step 2: Disable TLS verification for fetch**

Add at top of test file (or in `beforeAll`):
```typescript
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
```

Restore in `afterAll`:
```typescript
afterAll(() => {
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
})
```

**Step 3: Update all HTTP references to HTTPS**

Replace in test file:
- `http://127.0.0.1:${port}/` → `https://127.0.0.1:${port}/`
- `ws://127.0.0.1:${port}/ws` → `wss://127.0.0.1:${port}/ws`

For WebSocket connections, add `rejectUnauthorized: false`:
```typescript
const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
```

**Step 4: Update URL assertions**

Any `expect(result.url).toContain(...)` that checks for `http://` must change to `https://`.

**Step 5: Run tests to verify**

Run: `npx vitest run src/main/services/webServer.test.ts`
Expected: All existing tests PASS with HTTPS

**Step 6: Commit**

```bash
git add src/main/services/webServer.test.ts
git commit -m "test(web): update webServer tests for HTTPS"
```

---

### Task 5: Run full test suite and verify build

**Step 1: Run all tests**

Run: `npm test`
Expected: All 1917+ tests pass, no regressions

**Step 2: Run build**

Run: `npm run build`
Expected: 0 errors, 0 warnings

**Step 3: Final commit (if any fixups needed)**

Only if previous tasks needed adjustments discovered during full test run.

---

## Dependency Graph

```
Task 1 (cert.ts) → Task 2 (cert.test.ts) → Task 3 (webServer.ts HTTPS) → Task 4 (webServer.test.ts) → Task 5 (full verification)
```

All tasks are sequential — each depends on the previous.

## Files Changed Summary

| File | Action |
|------|--------|
| `src/main/utils/cert.ts` | CREATE — cert generation utility |
| `src/main/utils/cert.test.ts` | CREATE — cert generation tests |
| `src/main/services/webServer.ts` | MODIFY — HTTP → HTTPS, import cert util |
| `src/main/services/webServer.test.ts` | MODIFY — mock cert, HTTPS URLs, TLS config |
