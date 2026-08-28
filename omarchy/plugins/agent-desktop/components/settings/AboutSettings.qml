pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// About category — minimal: plugin version from `manifest.version` and
// the server's model/backend from `settings:get`. No `system:getInfo`
// call (CONTRACTS.md §8: "system info — read it locally; there is no
// channel").
//
// No bug-report section either, and this is measured rather than assumed:
// `bug:getMainErrors` / `bug:scrub` / `bug:send` ARE defined in
// src/core/handlers/bugReport.ts, but `registerCoreHandlers`
// (src/core/handlers/index.ts) imports the registrar and never invokes it —
// so the headless server answers `Unknown channel: bug:getMainErrors`,
// probed live over the bridge. The providers those handlers require (error
// buffer, metadata, webhook sender, scrubber) live under src/main/, i.e.
// Electron-only. Closing this needs backend work plus a decision about an
// outbound webhook in the headless server, so it is tracked as an issue
// rather than shipped as a Submit button that can only ever fail.
Item {
  id: root

  required property var settingsStore
  required property var manifest
  required property var rpc

  // Signed-in identity, read from `auth:getStatus`. Probed live over the
  // bridge: -> { authenticated: true, user: { email, name } }.
  //
  // Read-only ON PURPOSE, and there is no Sign out button, because there is
  // nothing behind one. `auth:logout` is registered and reachable, but its
  // implementation (src/core/handlers/auth.ts:63) is a stub that deletes
  // nothing:
  //
  //     function logout(): AuthStatus {
  //       return { authenticated: false, user: null }
  //     }
  //
  // Auth is derived from the credentials file `claude login` writes, so
  // `auth:getStatus` re-reads it and immediately reports `authenticated:
  // true` again. Measured: calling auth:logout then auth:getStatus returns
  // false then true. A button here would look like it worked, change
  // nothing, and flip its own label back. The Electron front ships exactly
  // that button (renderer/components/auth/UserProfile.tsx:69), so this is a
  // defect inherited from the old front rather than a gap against it.
  property var authStatus: null
  property bool authBusy: false

  function refreshAuth() {
    if (!rpc) return
    root.authBusy = true
    rpc.invoke("auth:getStatus", [], function (r) {
      root.authBusy = false
      root.authStatus = r
    }, function () {
      root.authBusy = false
      // Leave `authStatus` null: "unknown" must not render as "signed out".
      root.authStatus = null
    })
  }

  Component.onCompleted: root.refreshAuth()

  function get(key, fallback) {
    return settingsStore ? settingsStore.get(key, fallback === undefined ? "" : fallback) : (fallback || "")
  }

  // The page mounts this in a Loader that sets only `width`, so the Loader
  // adopts this item's implicitHeight. Without it the item is zero-high and the
  // entire body is clipped away — which is what made every settings category
  // render blank.
  implicitHeight: bodyCol.implicitHeight

  Column {
    id: bodyCol
    anchors { left: parent.left; right: parent.right }
    spacing: Style.spacing.md

    PanelSectionHeader { text: "About" }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Text {
        width: parent.width * 0.4
        anchors.verticalCenter: parent.verticalCenter
        text: "Plugin version"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: root.manifest && root.manifest.version ? String(root.manifest.version) : "unknown"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
    }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Text {
        width: parent.width * 0.4
        anchors.verticalCenter: parent.verticalCenter
        text: "AI backend"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: root.get("ai_sdkBackend", "")
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
    }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Text {
        width: parent.width * 0.4
        anchors.verticalCenter: parent.verticalCenter
        text: "Default model"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: root.get("ai_model", "")
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
    }

    PanelSectionHeader { text: "Account" }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Text {
        width: parent.width * 0.4
        anchors.verticalCenter: parent.verticalCenter
        text: "Signed in as"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        // Three distinct states, because collapsing "unknown" into "signed
        // out" would offer a sign-out button that cannot do anything.
        text: {
          if (root.authBusy) return "checking…"
          if (!root.authStatus) return "unknown"
          if (root.authStatus.authenticated !== true) return "not signed in"
          var u = root.authStatus.user
          if (!u) return "signed in"
          return String(u.email || u.name || "signed in")
        }
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
    }

    Text {
      width: parent.width
      text: "The plugin connects to the headless server at wss://127.0.0.1:<port>/ws. "
          + "All settings live in the agent.db; no separate plugin-local store."
      color: Color.muted
      opacity: 0.85
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }
  }
}