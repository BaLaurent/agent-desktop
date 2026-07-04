// The local UI HTTP server (Deno.serve). The desktop window navigates here; the
// runtime auto-binds the port and sets DENO_SERVE_ADDRESS. Replaces Electron's
// custom protocol handlers (agent-model://, agent-preview://) + the renderer load.
//
// Routes:
//   GET /agent-ws-shim.js       -> generateShim(token, '/ui-ws')  (window.agent over WS)
//   GET /ui-ws                  -> WebSocket upgrade -> uiBridge (origin-checked)
//   GET /model/ort/<f>          -> node_modules/onnxruntime-web/dist/<f>   (ORT wasm)
//   GET /model/hotword/<f>      -> resources/hotword-models/<f>            (openWakeWord)
//   GET /model/hotword-model/<f>-> <custom trained wakeword dir>/<f>
//   GET /preview<abs>?base=<d>  -> sandboxed file read (validatePathSafe)
//   * (else)                    -> static out/renderer, SPA fallback, shim injected into <head>
import { extname, join, normalize, resolve, sep } from "node:path";
import { generateShim } from "../core/services/webServer";
import { validatePathSafe } from "../core/utils/validate";
import { resourcePath } from "./paths";
import type { UiBridge } from "./uiBridge";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
};

// The webview only ever loads 127.0.0.1:<port>; external links go through system.openExternal.
// Shim is an external script (script-src 'self'); the WS token rides the URL (?token=), so no
// inline-script relaxation is needed. wasm-unsafe-eval is required for ORT / onnxruntime-web.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:* wss://127.0.0.1:*",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
].join("; ");

function mimeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function serveFile(absPath: string): Promise<Response> {
  try {
    const data = await Deno.readFile(absPath);
    return new Response(data, { headers: { "content-type": mimeFor(absPath) } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

// Resolve `rest` under `baseDir`, rejecting traversal outside it (mirrors modelProtocol.confine).
function confine(baseDir: string, rest: string): string | null {
  const resolved = resolve(baseDir, rest);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + sep)) return null;
  return resolved;
}

function modelBaseDir(host: string, getHotwordModelDir?: () => string | null): string | null {
  if (host === "ort") return resourcePath("node_modules/onnxruntime-web/dist");
  if (host === "hotword") return resourcePath("resources/hotword-models");
  if (host === "hotword-model") {
    const dir = getHotwordModelDir?.() ?? null;
    return dir ? resolve(dir) : null;
  }
  return null;
}

export interface UiServerOptions {
  token: string;
  bridge: UiBridge;
  getHotwordModelDir?: () => string | null;
}

async function serveStatic(reqPath: string, rendererDir: string): Promise<Response> {
  const safe = normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
  const rel = safe === "/" ? "index.html" : safe.replace(/^\/+/, "");
  const filePath = join(rendererDir, rel);
  if (!filePath.startsWith(rendererDir)) return new Response("Forbidden", { status: 403 });

  try {
    const data = await Deno.readFile(filePath);
    if (extname(filePath).toLowerCase() === ".html") {
      const html = new TextDecoder().decode(data).replace(
        "</head>",
        `<script src="/agent-ws-shim.js"></script>\n</head>`,
      );
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP } });
    }
    return new Response(data, { headers: { "content-type": mimeFor(filePath) } });
  } catch {
    // SPA fallback: extension-less unknown routes render index.html.
    if (safe !== "/" && !extname(safe)) return serveStatic("/", rendererDir);
    return new Response("Not found", { status: 404 });
  }
}

function handleRequest(req: Request, opts: UiServerOptions, rendererDir: string): Response | Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Trusted local WS bridge. Reject any cross-origin upgrade (only our page may connect).
  if (path === "/ui-ws") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (!origin || !host || origin !== `http://${host}`) {
      return new Response("Forbidden origin", { status: 403 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    opts.bridge.handleSocket(socket);
    return response;
  }

  if (path === "/agent-ws-shim.js") {
    return new Response(generateShim(opts.token, "/ui-ws"), {
      headers: { "content-type": "application/javascript; charset=utf-8" },
    });
  }

  if (path.startsWith("/model/")) {
    const seg = path.slice("/model/".length);
    const slash = seg.indexOf("/");
    const host = slash === -1 ? seg : seg.slice(0, slash);
    const rest = slash === -1 ? "" : decodeURIComponent(seg.slice(slash + 1));
    const base = modelBaseDir(host, opts.getHotwordModelDir);
    if (!base) return new Response("Not found", { status: 404 });
    const filePath = confine(base, rest);
    if (!filePath) return new Response("Forbidden", { status: 403 });
    return serveFile(filePath);
  }

  if (path.startsWith("/preview")) {
    const rawBase = url.searchParams.get("base");
    if (!rawBase) return new Response("Forbidden: ?base= is required", { status: 403 });
    const filePath = resolve(decodeURIComponent(path.slice("/preview".length)));
    try {
      validatePathSafe(filePath, decodeURIComponent(rawBase));
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
    return serveFile(filePath);
  }

  return serveStatic(path, rendererDir);
}

export function startUiServer(opts: UiServerOptions): void {
  const rendererDir = resourcePath("out/renderer");
  Deno.serve((req) => handleRequest(req, opts, rendererDir));
}
