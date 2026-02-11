# Agent Desktop — Architecture Call Graph

> Auto-generated comprehensive Mermaid diagram of the entire codebase.
> Shows every module, its exported functions, and call relationships across all layers.

## Legend

| Symbol | Meaning |
|--------|---------|
| Solid arrow `-->` | Direct function call |
| Dotted arrow `-.->` | IPC call (renderer → main via preload bridge) |
| Dashed arrow `-- text -->` | Event listener / callback |
| `[Box]` | Module / File |
| `([Rounded])` | Zustand Store |
| `{{Hexagon}}` | Utility module |
| `[(Database)]` | Database layer |
| `>Asymmetric]` | Component |

---

## Full Architecture Diagram

```mermaid
flowchart TD

%% ═══════════════════════════════════════════════
%% LAYER 1: ELECTRON MAIN PROCESS ENTRY
%% ═══════════════════════════════════════════════

subgraph MAIN_ENTRY["🔷 Main Process Entry"]
    direction TB
    IDX["index.ts<br/>─────────<br/>getMainWindow()<br/>createWindow()"]
    IPC["ipc.ts<br/>─────────<br/>registerAllHandlers()"]
    DB_SCHEMA["db/schema.ts<br/>─────────<br/>createTables()<br/>runMigrations()"]
    DB_CONN["db/database.ts<br/>─────────<br/>getDatabase()<br/>closeDatabase()"]
end

IDX -->|"app.whenReady()"| DB_CONN
IDX -->|"registerAllHandlers(ipcMain, db)"| IPC
IDX -->|"setupDeepLinks(app)"| SVC_DEEPLINK
IDX -->|"createTray(mainWindow)"| SVC_TRAY
DB_CONN --> DB_SCHEMA

%% ═══════════════════════════════════════════════
%% LAYER 2: MAIN PROCESS UTILITIES
%% ═══════════════════════════════════════════════

subgraph MAIN_UTILS["🔧 Main Utilities"]
    direction TB
    UTIL_VALIDATE{{"validate.ts<br/>─────────<br/>validateString()<br/>validatePositiveInt()<br/>validatePathSafe()"}}
    UTIL_JSON{{"json.ts<br/>─────────<br/>safeJsonParse()"}}
    UTIL_ERRORS{{"errors.ts<br/>─────────<br/>sanitizeError()"}}
    UTIL_ANTHROPIC{{"anthropic.ts<br/>─────────<br/>loadAgentSDK()"}}
end

%% ═══════════════════════════════════════════════
%% LAYER 3: MAIN PROCESS SERVICES
%% ═══════════════════════════════════════════════

subgraph SERVICES["🔶 Main Services"]
    direction TB

    subgraph SVC_CORE["Core Messaging"]
        SVC_MESSAGES["messages.ts<br/>─────────<br/>registerHandlers()<br/>buildMessageHistory()<br/>getSystemPrompt()<br/>getAISettings()<br/>saveMessage()<br/>generateConversationTitle()"]
        SVC_STREAMING["streaming.ts<br/>─────────<br/>streamMessage()<br/>abortStream()<br/>buildPromptWithHistory()<br/>respondToApproval()<br/>denyAllPending()<br/>sendChunk()"]
    end

    subgraph SVC_AUTH_GRP["Authentication"]
        SVC_AUTH["auth.ts<br/>─────────<br/>registerHandlers()<br/>getStatus()<br/>login()<br/>logout()"]
    end

    subgraph SVC_DATA["Data Management"]
        SVC_CONV["conversations.ts<br/>─────────<br/>registerHandlers()<br/>list/get/create/<br/>update/delete/<br/>export/import/search"]
        SVC_FOLDERS["folders.ts<br/>─────────<br/>registerHandlers()<br/>list/create/update/<br/>delete/reorder"]
        SVC_KB["knowledge.ts<br/>─────────<br/>registerHandlers()<br/>computeHash()<br/>findSupportedFiles()"]
    end

    subgraph SVC_FILES_GRP["File Operations"]
        SVC_FILES["files.ts<br/>─────────<br/>registerHandlers()<br/>classifyFileExt()<br/>listTree()<br/>expandHome()<br/>generateCopyPath()"]
        SVC_ATTACH["attachments.ts<br/>─────────<br/>registerHandlers()<br/>getMimeType()"]
    end

    subgraph SVC_CONFIG["Configuration"]
        SVC_SETTINGS["settings.ts<br/>─────────<br/>registerHandlers()<br/>get/set"]
        SVC_MCP["mcp.ts<br/>─────────<br/>registerHandlers()<br/>validateMcp*(7 fns)<br/>testStdioConnection()<br/>testHttpConnection()"]
        SVC_TOOLS["tools.ts<br/>─────────<br/>registerHandlers()<br/>getEnabledSet()<br/>saveEnabledList()"]
    end

    subgraph SVC_UI_CFG["UI Configuration"]
        SVC_THEMES["themes.ts<br/>─────────<br/>registerHandlers()<br/>list/create/update/delete"]
        SVC_SHORTCUTS["shortcuts.ts<br/>─────────<br/>registerHandlers()<br/>list/update"]
    end

    subgraph SVC_SYSTEM["System Services"]
        SVC_SYS["system.ts<br/>─────────<br/>registerHandlers()<br/>log()<br/>purgeConversations()<br/>purgeAll()"]
        SVC_DEEPLINK["deeplink.ts<br/>─────────<br/>setupDeepLinks()<br/>handleDeepLink()"]
        SVC_TRAY["tray.ts<br/>─────────<br/>createTray()"]
        SVC_WHISPER["whisper.ts<br/>─────────<br/>registerHandlers()<br/>transcribe()<br/>validateConfig()<br/>findBinary()<br/>buildAdvancedArgs()"]
    end
end

%% IPC Registry → All Services
IPC --> SVC_AUTH
IPC --> SVC_MESSAGES
IPC --> SVC_CONV
IPC --> SVC_FOLDERS
IPC --> SVC_MCP
IPC --> SVC_TOOLS
IPC --> SVC_KB
IPC --> SVC_FILES
IPC --> SVC_ATTACH
IPC --> SVC_SETTINGS
IPC --> SVC_THEMES
IPC --> SVC_SHORTCUTS
IPC --> SVC_SYS
IPC --> SVC_WHISPER

%% Service → Service calls
SVC_MESSAGES -->|"streamMessage()"| SVC_STREAMING
SVC_MESSAGES -->|"abortStream()"| SVC_STREAMING
SVC_MESSAGES -->|"respondToApproval()"| SVC_STREAMING
SVC_MESSAGES -->|"generateConversationTitle()"| UTIL_ANTHROPIC
SVC_STREAMING -->|"loadAgentSDK()"| UTIL_ANTHROPIC
SVC_STREAMING -->|"sendChunk()"| IDX
SVC_AUTH -->|"loadAgentSDK()"| UTIL_ANTHROPIC
SVC_DEEPLINK -->|"getMainWindow()"| IDX
SVC_DEEPLINK -->|"log()"| SVC_SYS

%% Service → Utility calls
SVC_MESSAGES --> UTIL_VALIDATE
SVC_MESSAGES --> UTIL_JSON
SVC_STREAMING --> UTIL_JSON
SVC_CONV --> UTIL_VALIDATE
SVC_FOLDERS --> UTIL_VALIDATE
SVC_FILES --> UTIL_VALIDATE
SVC_ATTACH --> UTIL_VALIDATE
SVC_KB --> UTIL_VALIDATE
SVC_SETTINGS --> UTIL_VALIDATE
SVC_MCP --> UTIL_JSON
SVC_TOOLS --> UTIL_JSON
SVC_THEMES --> UTIL_VALIDATE
SVC_SHORTCUTS --> UTIL_VALIDATE
SVC_WHISPER --> UTIL_JSON

%% ═══════════════════════════════════════════════
%% LAYER 4: PRELOAD BRIDGE (IPC)
%% ═══════════════════════════════════════════════

subgraph PRELOAD["🔗 Preload Bridge — window.agent"]
    direction TB
    PRE_AUTH["auth: getStatus · login · logout"]
    PRE_CONV["conversations: list · get · create · update · delete · export · import · search"]
    PRE_MSG["messages: send · stop · regenerate · edit · respondToApproval · onStream"]
    PRE_FILES["files: listTree · readFile · revealInFileManager · openWithDefault · trash · rename · duplicate"]
    PRE_FOLDERS["folders: list · create · update · delete · reorder"]
    PRE_MCP["mcp: listServers · addServer · updateServer · removeServer · toggleServer · testConnection"]
    PRE_TOOLS["tools: listAvailable · setEnabled · toggle"]
    PRE_KB["kb: listFiles · addFile · addFolder · removeFile · getConversationKB · toggleForConversation"]
    PRE_SETTINGS["settings: get · set"]
    PRE_THEMES["themes: list · create · update · delete"]
    PRE_SHORTCUTS["shortcuts: list · update"]
    PRE_WHISPER["whisper: transcribe · validateConfig"]
    PRE_SYSTEM["system: getInfo · getLogs · clearCache · openExternal · selectFolder · selectFile · purgeConversations · purgeAll"]
    PRE_EVENTS["events: onTrayNewConversation · onDeeplinkNavigate · onConversationTitleUpdated"]
    PRE_WINDOW["window: minimize · maximize · close"]
end

%% Preload → Services (IPC invoke)
PRE_AUTH -.->|"auth:*"| SVC_AUTH
PRE_CONV -.->|"conversations:*"| SVC_CONV
PRE_MSG -.->|"messages:*"| SVC_MESSAGES
PRE_FILES -.->|"files:*"| SVC_FILES
PRE_FOLDERS -.->|"folders:*"| SVC_FOLDERS
PRE_MCP -.->|"mcp:*"| SVC_MCP
PRE_TOOLS -.->|"tools:*"| SVC_TOOLS
PRE_KB -.->|"kb:*"| SVC_KB
PRE_SETTINGS -.->|"settings:*"| SVC_SETTINGS
PRE_THEMES -.->|"themes:*"| SVC_THEMES
PRE_SHORTCUTS -.->|"shortcuts:*"| SVC_SHORTCUTS
PRE_WHISPER -.->|"whisper:*"| SVC_WHISPER
PRE_SYSTEM -.->|"system:*"| SVC_SYS
PRE_WINDOW -.->|"window:*"| IDX
PRE_EVENTS -.->|"events"| SVC_TRAY
PRE_EVENTS -.->|"events"| SVC_DEEPLINK

%% ═══════════════════════════════════════════════
%% LAYER 5: RENDERER STORES
%% ═══════════════════════════════════════════════

subgraph STORES["🟢 Renderer Stores (Zustand)"]
    direction TB
    ST_CHAT(["chatStore<br/>─────────<br/>sendMessage · stopGeneration<br/>regenerateLastResponse<br/>editMessage · loadMessages<br/>setActiveConversation<br/>streamBuffers · syncViewFromBuffer"])
    ST_CONV(["conversationsStore<br/>─────────<br/>loadConversations · loadFolders<br/>createConversation · deleteConversation<br/>updateConversation · searchConversations<br/>createFolder · deleteFolder<br/>moveToFolder · exportConversation"])
    ST_AUTH(["authStore<br/>─────────<br/>checkAuth · login · logout"])
    ST_SETTINGS(["settingsStore<br/>─────────<br/>loadSettings · setSetting<br/>loadThemes · applyTheme<br/>createTheme · deleteTheme"])
    ST_FILE_EXP(["fileExplorerStore<br/>─────────<br/>loadTree · selectFile<br/>refresh · clear"])
    ST_MCP(["mcpStore<br/>─────────<br/>loadServers · addServer<br/>updateServer · removeServer<br/>toggleServer · testConnection"])
    ST_TOOLS(["toolsStore<br/>─────────<br/>loadTools · toggleTool<br/>enableAll · disableAll"])
    ST_KB(["knowledgeStore<br/>─────────<br/>loadFiles · addFile · addFolder<br/>removeFile · loadConversationKB<br/>toggleForConversation"])
    ST_UI(["uiStore<br/>─────────<br/>toggleSidebar · togglePanel<br/>setActiveView"])
    ST_SC(["shortcutsStore<br/>─────────<br/>loadShortcuts · updateShortcut"])
    ST_VOICE(["voiceInputStore<br/>─────────<br/>toggleRecording · startRecording<br/>stopAndTranscribe · cancelRecording"])
end

%% Stores → Preload IPC
ST_CHAT -->|"messages.*"| PRE_MSG
ST_CONV -->|"conversations.* · folders.*"| PRE_CONV
ST_CONV -->|"folders.*"| PRE_FOLDERS
ST_AUTH -->|"auth.*"| PRE_AUTH
ST_SETTINGS -->|"settings.* · themes.*"| PRE_SETTINGS
ST_SETTINGS -->|"themes.*"| PRE_THEMES
ST_FILE_EXP -->|"files.*"| PRE_FILES
ST_MCP -->|"mcp.*"| PRE_MCP
ST_TOOLS -->|"tools.*"| PRE_TOOLS
ST_KB -->|"kb.*"| PRE_KB
ST_SC -->|"shortcuts.*"| PRE_SHORTCUTS
ST_VOICE -->|"whisper.*"| PRE_WHISPER

%% Store cross-references
ST_CHAT -->|"notification sounds"| UTIL_NOTIF
ST_VOICE -->|"encodeWav()"| UTIL_WAV

%% ═══════════════════════════════════════════════
%% LAYER 6: RENDERER UTILITIES
%% ═══════════════════════════════════════════════

subgraph REND_UTILS["🔧 Renderer Utilities"]
    direction TB
    UTIL_SHORTCUT_MATCH{{"shortcutMatcher.ts<br/>─────────<br/>parseAccelerator()<br/>matchesEvent()"}}
    UTIL_NOTIF{{"notificationSound.ts<br/>─────────<br/>playCompletionSound()<br/>playErrorSound()"}}
    UTIL_RESOLVE{{"resolveAISettings.ts<br/>─────────<br/>parseOverrides()<br/>resolveEffectiveSettings()<br/>getInheritanceSource()"}}
    UTIL_WAV{{"wavEncoder.ts<br/>─────────<br/>encodeWav()"}}
end

%% ═══════════════════════════════════════════════
%% LAYER 7: RENDERER PAGES
%% ═══════════════════════════════════════════════

subgraph PAGES["📄 Renderer Pages"]
    direction TB
    PG_APP>"App.tsx<br/>─────────<br/>Root layout · routing<br/>keyboard shortcuts<br/>deep links · tray events"]
    PG_CHAT>"ChatView.tsx<br/>─────────<br/>Chat layout orchestrator<br/>AI settings cascade<br/>stream management"]
    PG_SETTINGS>"SettingsPage.tsx<br/>─────────<br/>Settings tabs router<br/>General · AI · Tools<br/>MCP · KB · Shortcuts<br/>Appearance · Storage · Voice · About"]
    PG_WELCOME>"WelcomeScreen.tsx<br/>─────────<br/>Landing / empty state"]
end

PG_APP --> PG_CHAT
PG_APP --> PG_SETTINGS
PG_APP --> PG_WELCOME
PG_APP -->|"dynamic shortcuts"| UTIL_SHORTCUT_MATCH
PG_APP -->|"events.*"| PRE_EVENTS
PG_CHAT --> UTIL_RESOLVE

%% Pages → Stores
PG_APP --> ST_UI
PG_APP --> ST_SC
PG_APP --> ST_AUTH
PG_APP --> ST_CONV
PG_APP --> ST_CHAT
PG_CHAT --> ST_CHAT
PG_CHAT --> ST_CONV
PG_CHAT --> ST_SETTINGS
PG_CHAT --> ST_MCP
PG_CHAT --> ST_FILE_EXP
PG_CHAT --> ST_VOICE
PG_SETTINGS --> ST_SETTINGS
PG_SETTINGS --> ST_AUTH

%% ═══════════════════════════════════════════════
%% LAYER 8: RENDERER COMPONENTS
%% ═══════════════════════════════════════════════

subgraph COMPONENTS["🟣 Renderer Components"]
    direction TB

    subgraph COMP_CHAT["Chat Components"]
        C_MSG_LIST>"MessageList"]
        C_MSG_INPUT>"MessageInput"]
        C_MSG_BUBBLE>"MessageBubble"]
        C_STREAMING>"StreamingIndicator"]
        C_TOOL_USE>"ToolUseBlock"]
        C_TOOL_CALLS>"ToolCallsSection"]
        C_TOOL_APPROV>"ToolApprovalBlock"]
        C_ASK_USER>"AskUserBlock"]
        C_MCP_STATUS>"McpStatusBlock"]
        C_CODE_BLOCK>"CodeBlock"]
        C_MD_RENDER>"MarkdownRenderer"]
        C_VOICE_BTN>"VoiceInputButton"]
        C_STATUS_LINE>"ChatStatusLine"]
    end

    subgraph COMP_SIDEBAR["Sidebar Components"]
        C_SIDEBAR>"Sidebar"]
        C_FOLDER_TREE>"FolderTree / SidebarTree"]
        C_CONV_ITEM>"ConversationItem"]
        C_SEARCH>"SearchBar"]
        C_EMPTY>"EmptyState"]
    end

    subgraph COMP_PANEL["Panel Components"]
        C_FILE_EXP>"FileExplorerPanel"]
    end

    subgraph COMP_SETTINGS["Settings Components"]
        C_GENERAL>"GeneralSettings"]
        C_AI_SETTINGS>"AISettings"]
        C_AI_OVERRIDES>"AIOverridesPopover"]
        C_APPEARANCE>"AppearanceSettings"]
        C_STORAGE>"StorageSettings"]
        C_SHORTCUT_SET>"ShortcutSettings"]
        C_VOICE_SET>"VoiceInputSettings"]
        C_ABOUT>"AboutSection"]
    end

    subgraph COMP_ATTACH["Attachment Components"]
        C_FILE_DROP>"FileDropZone"]
        C_FILE_UPLOAD>"FileUploadButton"]
        C_ATTACH_PREV>"AttachmentPreview"]
    end

    subgraph COMP_ARTIFACTS["Artifact Viewers"]
        C_CODE_ART>"CodeArtifact"]
        C_HTML_PREV>"HtmlPreview"]
        C_SVG_PREV>"SvgPreview"]
        C_MD_ART>"MarkdownArtifact"]
        C_MERMAID>"MermaidBlock"]
    end

    subgraph COMP_KB["Knowledge Components"]
        C_KB_MGR>"KnowledgeManager"]
        C_KB_LIST>"FileList"]
    end

    subgraph COMP_MCP["MCP Components"]
        C_MCP_LIST>"McpServerList"]
        C_MCP_FORM>"McpServerForm"]
    end

    subgraph COMP_TOOLS["Tool Components"]
        C_TOOL_LIST>"ToolList"]
    end

    subgraph COMP_AUTH["Auth Components"]
        C_AUTH_GUARD>"AuthGuard"]
        C_USER_PROF>"UserProfile"]
    end

    subgraph COMP_LAYOUT["Layout Components"]
        C_TITLEBAR>"Titlebar"]
        C_ERR_BOUND>"ErrorBoundary"]
    end
end

%% ═══════════════════════════════════════════════
%% COMPONENT RENDER TREE (who renders whom)
%% ═══════════════════════════════════════════════

%% App renders
PG_APP --> C_TITLEBAR
PG_APP --> C_AUTH_GUARD
PG_APP --> C_ERR_BOUND
PG_APP --> C_SIDEBAR

%% ChatView renders
PG_CHAT --> C_MSG_LIST
PG_CHAT --> C_MSG_INPUT
PG_CHAT --> C_STREAMING
PG_CHAT --> C_FILE_EXP
PG_CHAT --> C_STATUS_LINE
PG_CHAT --> C_AI_OVERRIDES
PG_CHAT --> C_FILE_DROP
PG_CHAT --> C_VOICE_BTN

%% SettingsPage renders
PG_SETTINGS --> C_GENERAL
PG_SETTINGS --> C_AI_SETTINGS
PG_SETTINGS --> C_APPEARANCE
PG_SETTINGS --> C_STORAGE
PG_SETTINGS --> C_SHORTCUT_SET
PG_SETTINGS --> C_VOICE_SET
PG_SETTINGS --> C_ABOUT
PG_SETTINGS --> C_MCP_LIST
PG_SETTINGS --> C_TOOL_LIST
PG_SETTINGS --> C_KB_MGR

%% Chat Component hierarchy
C_MSG_LIST --> C_MSG_BUBBLE
C_MSG_BUBBLE --> C_MD_RENDER
C_MSG_BUBBLE --> C_TOOL_CALLS
C_TOOL_CALLS --> C_TOOL_USE
C_MD_RENDER --> C_CODE_BLOCK
C_MD_RENDER --> C_MERMAID
C_STREAMING --> C_TOOL_USE
C_STREAMING --> C_TOOL_APPROV
C_STREAMING --> C_ASK_USER
C_STREAMING --> C_MCP_STATUS
C_MSG_INPUT --> C_FILE_UPLOAD
C_MSG_INPUT --> C_ATTACH_PREV

%% Sidebar hierarchy
C_SIDEBAR --> C_FOLDER_TREE
C_SIDEBAR --> C_SEARCH
C_SIDEBAR --> C_EMPTY
C_SIDEBAR --> C_USER_PROF
C_FOLDER_TREE --> C_CONV_ITEM

%% File Explorer uses artifact viewers
C_FILE_EXP --> C_CODE_ART
C_FILE_EXP --> C_HTML_PREV
C_FILE_EXP --> C_SVG_PREV
C_FILE_EXP --> C_MD_ART
C_FILE_EXP --> C_MERMAID

%% Knowledge hierarchy
C_KB_MGR --> C_KB_LIST

%% MCP hierarchy
C_MCP_LIST --> C_MCP_FORM

%% FolderTree uses AI overrides
C_FOLDER_TREE --> C_AI_OVERRIDES

%% ═══════════════════════════════════════════════
%% COMPONENT → STORE CONNECTIONS
%% ═══════════════════════════════════════════════

C_MSG_LIST --> ST_CHAT
C_MSG_INPUT --> ST_CHAT
C_STREAMING --> ST_CHAT
C_SIDEBAR --> ST_CONV
C_SIDEBAR --> ST_UI
C_FOLDER_TREE --> ST_CONV
C_CONV_ITEM --> ST_CONV
C_FILE_EXP --> ST_FILE_EXP
C_AUTH_GUARD --> ST_AUTH
C_USER_PROF --> ST_AUTH
C_GENERAL --> ST_SETTINGS
C_AI_SETTINGS --> ST_SETTINGS
C_APPEARANCE --> ST_SETTINGS
C_MCP_LIST --> ST_MCP
C_TOOL_LIST --> ST_TOOLS
C_KB_MGR --> ST_KB
C_SHORTCUT_SET --> ST_SC
C_VOICE_BTN --> ST_VOICE
C_VOICE_SET --> ST_SETTINGS
C_STORAGE --> PRE_SYSTEM
C_TITLEBAR --> PRE_WINDOW
C_AI_OVERRIDES --> UTIL_RESOLVE
C_TOOL_APPROV --> PRE_MSG
C_ASK_USER --> PRE_MSG
C_STATUS_LINE --> ST_MCP

%% ═══════════════════════════════════════════════
%% STYLING
%% ═══════════════════════════════════════════════

classDef mainEntry fill:#1a237e,stroke:#5c6bc0,color:#fff
classDef service fill:#e65100,stroke:#ff9800,color:#fff
classDef utility fill:#004d40,stroke:#26a69a,color:#fff
classDef preload fill:#4a148c,stroke:#ab47bc,color:#fff
classDef store fill:#1b5e20,stroke:#66bb6a,color:#fff
classDef page fill:#0d47a1,stroke:#42a5f5,color:#fff
classDef component fill:#4a148c,stroke:#ce93d8,color:#fff

class IDX,IPC,DB_SCHEMA,DB_CONN mainEntry
class SVC_MESSAGES,SVC_STREAMING,SVC_AUTH,SVC_CONV,SVC_FOLDERS,SVC_KB,SVC_FILES,SVC_ATTACH,SVC_SETTINGS,SVC_MCP,SVC_TOOLS,SVC_THEMES,SVC_SHORTCUTS,SVC_SYS,SVC_DEEPLINK,SVC_TRAY,SVC_WHISPER service
class UTIL_VALIDATE,UTIL_JSON,UTIL_ERRORS,UTIL_ANTHROPIC,UTIL_SHORTCUT_MATCH,UTIL_NOTIF,UTIL_RESOLVE,UTIL_WAV utility
class PRE_AUTH,PRE_CONV,PRE_MSG,PRE_FILES,PRE_FOLDERS,PRE_MCP,PRE_TOOLS,PRE_KB,PRE_SETTINGS,PRE_THEMES,PRE_SHORTCUTS,PRE_WHISPER,PRE_SYSTEM,PRE_EVENTS,PRE_WINDOW preload
class ST_CHAT,ST_CONV,ST_AUTH,ST_SETTINGS,ST_FILE_EXP,ST_MCP,ST_TOOLS,ST_KB,ST_UI,ST_SC,ST_VOICE store
class PG_APP,PG_CHAT,PG_SETTINGS,PG_WELCOME page
```

---

## IPC Handler Registry

All IPC handlers registered via `src/main/ipc.ts → registerAllHandlers()`:

| Service File | IPC Handlers |
|---|---|
| `auth.ts` | `auth:getStatus` · `auth:login` · `auth:logout` |
| `conversations.ts` | `conversations:list` · `conversations:get` · `conversations:create` · `conversations:update` · `conversations:delete` · `conversations:export` · `conversations:import` · `conversations:search` |
| `messages.ts` | `messages:send` · `messages:stop` · `messages:regenerate` · `messages:edit` · `messages:respondToApproval` |
| `folders.ts` | `folders:list` · `folders:create` · `folders:update` · `folders:delete` · `folders:reorder` |
| `files.ts` | `files:listTree` · `files:readFile` · `files:revealInFileManager` · `files:openWithDefault` · `files:trash` · `files:rename` · `files:duplicate` |
| `attachments.ts` | `attachments:readFile` · `attachments:getInfo` |
| `mcp.ts` | `mcp:listServers` · `mcp:addServer` · `mcp:updateServer` · `mcp:removeServer` · `mcp:toggleServer` · `mcp:testConnection` |
| `tools.ts` | `tools:listAvailable` · `tools:setEnabled` · `tools:toggle` |
| `knowledge.ts` | `kb:listFiles` · `kb:addFile` · `kb:addFolder` · `kb:removeFile` · `kb:getConversationKB` · `kb:toggleForConversation` |
| `settings.ts` | `settings:get` · `settings:set` |
| `themes.ts` | `themes:list` · `themes:create` · `themes:update` · `themes:delete` |
| `shortcuts.ts` | `shortcuts:list` · `shortcuts:update` |
| `system.ts` | `system:getInfo` · `system:getLogs` · `system:clearCache` · `system:openExternal` · `system:showNotification` · `system:selectFolder` · `system:selectFile` · `system:purgeConversations` · `system:purgeAll` |
| `whisper.ts` | `whisper:transcribe` · `whisper:validateConfig` |
| `index.ts` (on) | `window:minimize` · `window:maximize` · `window:close` |

**Total: 14 service files · ~63 IPC handlers**

---

## Event Channels (main → renderer)

| Event | Emitter | Listener |
|---|---|---|
| `messages:stream` | `streaming.ts sendChunk()` | `chatStore.ts onStream()` |
| `conversations:titleUpdated` | `messages.ts generateConversationTitle()` | `conversationsStore.ts` |
| `tray:newConversation` | `tray.ts` | `App.tsx` |
| `deeplink:navigate` | `deeplink.ts` | `App.tsx` |

---

## Cross-Layer Function Call Summary

### Main Service → Utility Dependencies

| Utility | Used By |
|---|---|
| `validateString()` | messages, conversations, folders, files, attachments, settings, themes, shortcuts, mcp |
| `validatePositiveInt()` | messages, conversations, folders, files, themes, shortcuts, knowledge |
| `validatePathSafe()` | messages, files, attachments, knowledge |
| `safeJsonParse()` | messages, streaming, mcp, tools, whisper |
| `sanitizeError()` | (available but used sparingly via try/catch wrappers) |
| `loadAgentSDK()` | messages (title gen), streaming (query), auth (status check) |

### Renderer Store → Utility Dependencies

| Utility | Used By |
|---|---|
| `playCompletionSound()` | chatStore |
| `playErrorSound()` | chatStore |
| `encodeWav()` | voiceInputStore |
| `parseAccelerator()` | App.tsx |
| `matchesEvent()` | App.tsx |
| `resolveEffectiveSettings()` | ChatView.tsx |
| `parseOverrides()` | ChatView.tsx, AIOverridesPopover.tsx |
| `getInheritanceSource()` | AIOverridesPopover.tsx |
