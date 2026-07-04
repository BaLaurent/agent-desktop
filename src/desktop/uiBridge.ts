// Local (trusted) WebSocket bridge — the desktop twin of webServer.ts::handleWsMessage.
//
// Reuses the EXACT wire protocol the renderer shim speaks (generateShim in
// webServer.ts): client sends {type:'auth',token} then {type:'invoke',id,channel,args};
// server replies {type:'auth_result',...} / {type:'result',id,result|error} and pushes
// {type:'event',channel,data}. Differences from the remote WS route:
//   - token-only auth (no cookie / scrypt password, no rate limiter)
//   - dispatch origin is 'local': the local UI is fully trusted, so there is NO
//     isWsBlocked / LOCAL_ONLY_CHANNELS filter — every channel is invokable
//     (quickChat:*, mcp:*, jupyter:*, updates:*, server:*, …).
//
// Engine/service events reach clients the same way headless does: everything is
// funnelled through the global broadcast() (the engine's Broadcaster port forwards
// to it — see main.ts), and we register an addBroadcastHandler that fans out to the
// local sockets. We do NOT subscribe to engine.emit directly; the 12 typed events
// are all published via broadcast() (verified: deeplink.ts / tray.ts call broadcast()).
import { addBroadcastHandler } from "../core/utils/broadcast";
import type { DispatchRegistry } from "../core/dispatch";

interface InvokeMessage {
  type?: string;
  token?: string;
  id?: string;
  channel?: string;
  args?: unknown[];
}

export interface UiBridge {
  /** Attach a freshly-upgraded socket (from Deno.upgradeWebSocket). */
  handleSocket(socket: WebSocket): void;
  /** Number of currently-authenticated local clients. */
  clientCount(): number;
  /** Unregister the broadcast handler and drop all sockets. */
  close(): void;
}

// Decode the wire encoding generateShim applies to invoke args:
//   undefined      -> { __type: 'undefined' }
//   Uint8Array     -> { __type: 'binary', data: <base64> }
function decodeArg(arg: unknown): unknown {
  if (arg && typeof arg === "object" && "__type" in arg) {
    const type = arg.__type;
    if (type === "undefined") return undefined;
    if (type === "binary" && "data" in arg && typeof arg.data === "string") {
      return Uint8Array.from(atob(arg.data), (c) => c.charCodeAt(0));
    }
  }
  return arg;
}

export function createUiBridge(dispatch: DispatchRegistry, token: string): UiBridge {
  const authed = new Set<WebSocket>();

  function send(ws: WebSocket, payload: string): void {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    } catch {
      authed.delete(ws);
    }
  }

  function handleMessage(ws: WebSocket, raw: string): void {
    let msg: InvokeMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "auth") {
      const ok = msg.token === token;
      if (ok) authed.add(ws);
      send(ws, JSON.stringify({ type: "auth_result", success: ok, error: ok ? undefined : "Invalid token" }));
      return;
    }

    if (!authed.has(ws)) {
      send(ws, JSON.stringify({ type: "auth_result", success: false, error: "Not authenticated" }));
      return;
    }

    if (msg.type === "invoke" && msg.id && msg.channel) {
      const id = msg.id;
      const handler = dispatch.get(msg.channel);
      if (!handler) {
        send(ws, JSON.stringify({ type: "result", id, error: `Unknown channel: ${msg.channel}` }));
        return;
      }
      const decoded = (msg.args ?? []).map(decodeArg);
      handler(...decoded)
        .then((result) => send(ws, JSON.stringify({ type: "result", id, result })))
        .catch((err) => send(ws, JSON.stringify({ type: "result", id, error: err instanceof Error ? err.message : String(err) })));
    }
  }

  function handleSocket(socket: WebSocket): void {
    socket.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") handleMessage(socket, ev.data);
    });
    socket.addEventListener("close", () => authed.delete(socket));
    socket.addEventListener("error", () => authed.delete(socket));
  }

  const unsubscribe = addBroadcastHandler((channel: string, ...args: unknown[]) => {
    if (authed.size === 0) return;
    const data = args.length === 1 ? args[0] : args;
    const payload = JSON.stringify({ type: "event", channel, data });
    for (const ws of authed) send(ws, payload);
  });

  return {
    handleSocket,
    clientCount: () => authed.size,
    close() {
      unsubscribe();
      for (const ws of authed) {
        try {
          ws.close();
        } catch {
          // already closing
        }
      }
      authed.clear();
    },
  };
}
