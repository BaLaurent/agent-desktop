// Central dispatch registration for the desktop shell — the replacement for Electron's
// bridgeDispatchToIpc (src/main/ipc.ts). Registers Category B (transport-independent core:
// web-server control + discord bridge) and Category C (ported native services) on
// engine.dispatch, wrapped with sanitizeError so path-bearing errors don't leak to remote
// WS clients (mirrors Electron's withSanitizedErrors). Category A (conversations/messages/
// settings/pi/…) is registered inside engine.init(); the scheduler subgraph is a follow-up.
import type { AgentEngine } from "../core";
import type { HandleRegistrar } from "../core/dispatch";
import type Database from "better-sqlite3";
import { sanitizeError } from "./utils/errors";
import { registerWebServerHandlers } from "../core/services/webServer";
import { registerDiscordHandlers } from "../core/services/discord";
import { registerHandlers as registerSystem } from "./services/system";
import { registerHandlers as registerFiles } from "./services/files";
import { registerHandlers as registerQuickChat } from "./services/quickChat";
import { registerHandlers as registerStreaming } from "./services/streaming";
import { registerHandlers as registerUpdater } from "./services/updater";
import { registerHandlers as registerOpenscad } from "./services/openscad";
import { registerHandlers as registerPiExtensions } from "./services/piExtensions";
import { registerHandlers as registerCommands } from "./services/commands";
import { registerHandlers as registerJupyter } from "./services/jupyter";
import { registerHandlers as registerHotwordTrainer } from "./services/hotwordTrainer";
import { registerHandlers as registerThemes } from "./services/themes";
import { registerHandlers as registerKnowledge } from "./services/knowledge";
import { registerHandlers as registerWhisper } from "./services/whisper";
import { registerHandlers as registerScheduler } from "./services/scheduler";
import "./services/tts"; // side-effect: wires speaking-state listener + web-audio sink → broadcast()

export function registerLocalServices(engine: AgentEngine): void {
  // engine.db is the SqlJsAdapter, which duck-types better-sqlite3's Database (the type the
  // ported services + core getSetting declare). The two nominal types can't unify and the
  // runtime db has always been this adapter (Electron bridged with `as any`); bridge once here.
  const db = engine.db as unknown as Database.Database;
  const dispatch = engine.dispatch;

  // Error-sanitizing facade over the registry: scrubs absolute paths from thrown errors before
  // they cross to the (possibly remote) renderer, matching Electron's per-handler withSanitizedErrors.
  const safe: HandleRegistrar = {
    handle(channel, listener) {
      dispatch.handle(channel, async (event, ...args) => {
        try {
          return await listener(event, ...args);
        } catch (err) {
          throw new Error(sanitizeError(err));
        }
      });
    },
  };

  // Category B — transport-independent core services.
  registerWebServerHandlers(safe, { webPassword: engine.webPassword, dispatch });
  registerDiscordHandlers(safe, dispatch);

  // Category C — ported native services.
  registerSystem(safe, db);
  registerFiles(safe, db);
  registerQuickChat(safe, db);
  registerStreaming(safe, db);
  registerUpdater(safe, db);
  registerOpenscad(safe, db);
  registerPiExtensions(safe, db);
  registerCommands(safe, db);
  registerJupyter(safe, db);
  registerHotwordTrainer(safe, db);
  registerThemes(safe, db);
  registerKnowledge(safe, db);
  // Scheduler dispatch (scheduler:* channels). Takes the raw SqlJsAdapter (engine.db), not the
  // bridged Database — scheduler.ts constructs its own SchedulerService and bridges internally.
  registerScheduler(safe, engine.db);
  // whisper LAST: overrides core's sherpa:transcribe to route through the Node STT sidecar
  // (sherpa-onnx-node N-API can't load in-process under deno desktop). Last-writer wins.
  registerWhisper(safe, db);
}
