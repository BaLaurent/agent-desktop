pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

import "settings" as S
import "../lib/settingsRows.js" as SR
import "../generated/settingDefs.js" as SD

// The settings window entry point. Two regions: a sidebar rail with
// the 16 categories in display order (mirrors `SettingsPage.tsx:26-43`),
// and a content pane hosting the active category.
//
// One author per state. The activeCategory lives here; each category
// component is body-only and reaches its data through `settingsStore`
// and `rpc` injected as properties.
//
// The page reads `manifest.version` once and passes it to the About
// category. `Main` mounts the page inside the app window and routes
// `open(payload)` payloads with `mode === "settings"` to summon it.
Item {
  id: root

  // Service.qml + stores.
  required property var settingsStore
  required property var rpc
  required property var manifest

  // The five stores this category surfaces own their own channels:
  // McpStore, ToolsStore, KnowledgeStore, MacrosStore, ShortcutsStore.
  // VoiceSettings is body-only; it consumes SettingsStore + rpc + TtsStore.
  required property var mcpStore
  required property var toolsStore
  required property var knowledgeStore
  required property var macrosStore
  required property var shortcutsStore
  required property var ttsStore


  // Command runner injected from App.qml — the test harness has no
  // Quickshell plugin, so KnowledgeSettings takes the runner as a
  // function instead of importing Quickshell. App.qml binds this to
  // Quickshell.execDetached.
  required property var execOpen

  // ---- category list (display order, mirrors SettingsPage.tsx:26-43)
  readonly property var categories: [
    "General",
    "AI / Model",
    "Appearance",
    "Shortcuts",
    "Voice Input",
    "Text-to-Speech",
    "Quick Chat",
    "OpenSCAD",
    "MCP Servers",
    "Allowed Tools",
    "Macros",
    "Knowledge Base",
    "Web Server",
    "Discord",
    "Storage",
    "About"
  ]

  property string activeKey: "General"

  // ---- derived state -------------------------------------------------

  // Backend drives the SETTING_DEFS filter (lib/settingsRows.js).
  function _backend() {
    return settingsStore ? settingsStore.get("ai_sdkBackend", "") : ""
  }

  // Refreshed on every backend change. The page recomputes on demand;
  // the AiModelSettings component also re-evaluates on its own when the
  // dropdown is changed.
  readonly property var visibleDefs: SR.rowsFor(SD.SETTING_DEFS, _backend())

  function _refreshVisibleDefs() {
    // Force-recompute the binding. SR.rowsFor is pure; the page calls
    // this after every backend change so the Repeater re-evaluates.
    return SR.rowsFor(SD.SETTING_DEFS, _backend())
  }

  // ---- layout --------------------------------------------------------

  // A fixed-width category rail beside a filling content pane. Pure anchors,
  // NOT a Row: every child here anchors to the container's edges, and a Row
  // owns its children's `x` — the two fight, which is what made the title and
  // the rail render on top of each other and left the content pane unplaced.
  Item {
    id: layoutRow
    anchors.fill: parent

      Item {
        id: sidebarPane
        anchors.top: layoutRow.top
        anchors.bottom: layoutRow.bottom
        anchors.left: layoutRow.left
        width: 220


        Rectangle {
          anchors.fill: sidebarPane
          color: Color.background
          opacity: 0.6
        }
        S.SettingsSidebar {

          anchors { fill: sidebarPane }
          categories: root.categories
          activeKey: root.activeKey
          onSelected: function (key) { root.activeKey = key }
        }

      }

      Rectangle {
        id: separator
        width: 1
        anchors.top: layoutRow.top
        anchors.bottom: layoutRow.bottom
        anchors.left: sidebarPane.right
        color: Color.muted
        opacity: 0.15
      }

      Item {
        id: contentPane
        anchors.right: layoutRow.right
        anchors.top: layoutRow.top
        anchors.bottom: layoutRow.bottom
        anchors.left: separator.right

        Flickable {
          id: contentFlick
          anchors { fill: contentPane }
          anchors.margins: Style.spacing.md
          contentWidth: contentCol.width
          contentHeight: contentCol.implicitHeight + Style.spacing.md * 2
          clip: true

          // The Flickable's own `anchors.margins` is the ONLY inset. The
          // column previously kept the full inner width AND added `x: md`,
          // so it hung `md` past the right clip edge — every settings row's
          // right border and its toggle were sliced off. `contentWidth` also
          // subtracted the margin a second time, so the overflow could not
          // even be scrolled into view.
          Column {
            id: contentCol
            width: contentFlick.width
            spacing: Style.spacing.md
            Text {
              text: root.activeKey
              color: Color.foreground
              font.family: Style.font.family
              font.pixelSize: Style.font.title
              font.weight: Font.DemiBold
              width: contentCol.width
            }

            // The active category component. Each component is body-only;
            // it does NOT render its own title bar (the page already
            // has one above).
            Loader {
              id: categoryLoader
              width: contentCol.width
              sourceComponent: root._componentForCategory(root.activeKey)
            }
          }
        }
      }
  }

  // ---- category router -----------------------------------------------

  function _componentForCategory(key) {
    if (key === "General") return generalComp
    if (key === "AI / Model") return aiComp
    if (key === "Appearance") return appearanceComp
    if (key === "Shortcuts") return shortcutsComp
    if (key === "Voice Input") return voiceInputComp
    if (key === "Text-to-Speech") return ttsComp
    if (key === "Quick Chat") return quickChatComp
    if (key === "OpenSCAD") return openScadComp
    if (key === "MCP Servers") return mcpComp
    if (key === "Allowed Tools") return toolsComp
    if (key === "Macros") return macrosComp
    if (key === "Knowledge Base") return knowledgeComp
    if (key === "Web Server") return webServerComp
    if (key === "Discord") return discordComp
    if (key === "Storage") return storageComp
    if (key === "About") return aboutComp
    return null
  }

  // Component factory — each call to `_componentForCategory` resolves to
  // one of these. Components are defined inline so the file is self-
  // contained; no other owner touches them.
  Component {
    id: generalComp
    S.GeneralSettings {
      settingsStore: root.settingsStore
      rpc: root.rpc
      notificationsEvents: SD.NOTIFICATION_EVENTS
      defaultNotificationConfig: SD.DEFAULT_NOTIFICATION_CONFIG
    }
  }

  Component {
    id: aiComp
    S.AiModelSettings {
      settingsStore: root.settingsStore
      rpc: root.rpc
      settingDefs: root._refreshVisibleDefs()
      backendDisplayNames: SD.BACKEND_DISPLAY_NAMES
      Component.onCompleted: { refreshModels(); refreshSkills(); refreshPiExtensions(); refreshSkillsOverhead() }
    }
  }

  Component {
    id: appearanceComp
    S.AppearanceSettings {
      settingsStore: root.settingsStore
    }
  }

  Component {
    id: shortcutsComp
    S.ShortcutSettings {
      store: root.shortcutsStore
    }
  }

  Component {
    id: voiceInputComp
    VoiceSettings {
      section: "voiceInput"
      store: root.ttsStore
      settingsStore: root.settingsStore
      rpc: root.rpc
    }
  }

  Component {
    id: ttsComp
    VoiceSettings {
      section: "tts"
      store: root.ttsStore
      settingsStore: root.settingsStore
      rpc: root.rpc
    }
  }

  Component {
    id: quickChatComp
    S.QuickChatSettings {
      settingsStore: root.settingsStore
    }
  }

  Component {
    id: openScadComp
    S.OpenSCADSettings {}
  }

  Component {
    id: mcpComp
    S.McpServerSettings {
      store: root.mcpStore
    }
  }

  Component {
    id: toolsComp
    S.ToolsSettings {
      store: root.toolsStore
    }
  }

  Component {
    id: macrosComp
    S.MacrosSettings {
      store: root.macrosStore
    }
  }

  Component {
    id: knowledgeComp
    S.KnowledgeSettings {
      store: root.knowledgeStore
      exec: root.execOpen
    }
  }

  Component {
    id: webServerComp
    S.WebServerSettings {
      rpc: root.rpc
      settingsStore: root.settingsStore
    }
  }

  Component {
    id: discordComp
    S.DiscordSettings {
      rpc: root.rpc
      settingsStore: root.settingsStore
    }
  }

  Component {
    id: storageComp
    S.StorageSettings {
      rpc: root.rpc
    }
  }

  Component {
    id: aboutComp
    S.AboutSettings {
      settingsStore: root.settingsStore
      manifest: root.manifest
      rpc: root.rpc
    }
  }
}