# Web Speech-to-Text via HTTPS Self-Signed Certificate

## Problem

Voice input (`getUserMedia`) fails in web server mode because browsers restrict microphone access to secure contexts (HTTPS or localhost). When accessing the app via `http://192.168.x.x:3484/s/...`, `navigator.mediaDevices` is `undefined`.

## Root Cause

W3C Secure Context specification: `getUserMedia()` requires HTTPS. The existing WS → WhisperCPP pipeline works correctly — only the browser-side recording is blocked.

## Solution

Switch the web server from HTTP to HTTPS using an auto-generated self-signed certificate.

### Certificate Generation

On first `startServer()`, generate cert via OpenSSL if not already present:

- **Storage**: `~/.config/agent-desktop/ssl/{cert.pem, key.pem}`
- **Algorithm**: EC P-256 (fast generation, small key)
- **Validity**: 10 years (local tool, no renewal needed)
- **SAN**: `IP:127.0.0.1, IP:::1, DNS:localhost`

### Server Changes (`webServer.ts`)

- Read cert files before server creation
- Replace `http.createServer(handler)` with `https.createServer({ key, cert }, handler)`
- Update all URL generation to use `https://` protocol
- WebSocket upgrade continues to work (ws library handles both HTTP and HTTPS)
- Dev proxy to Vite remains HTTP (internal, localhost only)

### New Utility (`src/main/utils/cert.ts`)

Single exported function: `ensureSelfSignedCert(sslDir: string): Promise<{ key: Buffer; cert: Buffer }>`

- Checks if cert/key exist and are readable
- If missing, spawns `openssl` to generate them
- Returns the key and cert buffers

### Files Modified

| File | Change |
|------|--------|
| `src/main/services/webServer.ts` | HTTPS server creation, URL protocol update |
| `src/main/utils/cert.ts` (new) | Certificate generation utility |

### No Changes Needed

- `voiceInputStore.ts` — already works, just blocked by insecure context
- `VoiceInputButton.tsx` — no change
- `whisper.ts` — already wired via ipcDispatch
- WS shim — already detects protocol dynamically (`location.protocol`)
- `wavEncoder.ts` — no change

### User Experience

1. First visit: browser shows "Your connection is not private" warning
2. User clicks "Advanced" → "Proceed to [IP]" once
3. Subsequent visits: browser remembers the cert exception
4. Voice input works normally via existing pipeline

### Compatibility

- Electron desktop mode: unaffected (doesn't use web server)
- Existing WS protocol: unchanged (ws → wss is automatic via protocol detection)
- Dev mode proxy: stays HTTP to Vite dev server (localhost, no cert needed)
