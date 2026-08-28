pragma ComponentBehavior: Bound

import QtQuick

import qs.Commons

import "../lib/palette.js" as Palette
// Auth gate banner — AuthGuard.tsx parity.
//
// Behaviour:
//   - When the effective ai_sdkBackend is 'pi', this component is NEVER
//     shown (PI has its own auth; the renderer's AuthGuard short-circuits
//     entirely in that case: src/renderer/components/auth/AuthGuard.tsx:11-15).
//   - Otherwise we call auth:getStatus once on Component.onCompleted; when
//     authenticated=false we render a banner with the diagnostics fields
//     and the instruction to run `claude login`. The button RE-CHECKS by
//     calling auth:login (which re-reads the credential file and returns
//     the same AuthStatus) — NOT a sign-in flow.
//
// The parent decides visibility via the `authStatus` property, set by Main
// after the auth:getStatus result lands.
Item {
  id: root

  required property var settingsStore
  property var authStatus: null
  // { authenticated: bool, error?: string, diagnostics?: AuthDiagnostics }

  // PI backend skips the gate entirely.
  property bool _piBackend:
    settingsStore
      ? settingsStore.get("ai_sdkBackend", "") === "pi"
      : false

  signal _recheckRequested()  // bubbles up; Main wires to ChatStore.authRecheck()

  function recheck() {
    _recheckRequested()
  }

  visible: !_piBackend && authStatus !== null && !authStatus.authenticated

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  Rectangle {
    id: bodyRoot
    anchors { left: parent.left; right: parent.right; top: parent.top }
    height: layout.implicitHeight + 2 * Style.spacing.md
    color: Util.alpha(Color.urgent, Palette.tintAlpha())
    border { width: Style.normalBorderWidth; color: Color.urgent }
    radius: Style.cornerRadius

    Column {
      id: layout
      anchors {
        left: parent.left
        right: parent.right
        top: parent.top
        margins: Style.spacing.md
      }
      spacing: Style.spacing.xs

      Text {
        text: "Sign in to start chatting"
        font.family: Style.font.family
        font.pixelSize: Style.font.subtitle
        font.weight: Font.Medium
        color: Color.urgent
      }

      Text {
        text: root.authStatus && root.authStatus.error ? root.authStatus.error : ""
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.foreground
        opacity: 0.9
        wrapMode: Text.Wrap
        anchors { left: parent.left; right: parent.right }
      }

      Text {
        text: "Run `claude login` in your terminal, then click Re-check."
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.muted
        opacity: 0.85
        wrapMode: Text.Wrap
        anchors { left: parent.left; right: parent.right }
      }

      // Diagnostics block — same fields AuthGuard/WelcomeScreen expose.
      Column {
        spacing: 2
        anchors { left: parent.left; right: parent.right }
        // `!!` because this is a `bool` property and the chain's last term is
        // an optional FIELD: with `authStatus` present but no `diagnostics`,
        // `&&` yields undefined and QML refuses it ("Unable to assign
        // [undefined] to bool") — once per auth refresh.
        visible: !!(root.authStatus && root.authStatus.diagnostics)

        Text {
          text: "Diagnostics"
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          font.weight: Font.Medium
          color: Color.muted
          opacity: 0.7
        }

        Text {
          text: {
            var d = root.authStatus && root.authStatus.diagnostics
            if (!d) return ""
            var parts = []
            if (d.credentialsFileExists === false) parts.push("credentials file: not found")
            if (d.configDir) parts.push("config dir: " + d.configDir)
            if (d.home) parts.push("HOME: " + d.home)
            return parts.join("\n")
          }
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          color: Color.muted
          opacity: 0.85
          wrapMode: Text.Wrap
          anchors { left: parent.left; right: parent.right }
        }
      }

      Row {
        spacing: Style.spacing.sm

        Rectangle {
          width: recheckLabel.implicitWidth + 24
          height: Style.bar.sizeHorizontal
          radius: Style.cornerRadius
          color: Color.accent
          Text {
            id: recheckLabel
            anchors.centerIn: parent
            text: "Re-check"
            color: Color.background
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            font.weight: Font.Medium
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.recheck()
          }
        }
      }
    }
  }
}
