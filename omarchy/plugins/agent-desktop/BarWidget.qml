import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

import "lib/surface.js" as Surface

// Bar widget. One glyph whose text and colour track the service's state, and the
// two ways in: left click opens whichever surface `openOnClick` names, middle
// click opens the other one.
//
// It is also the only channel that pushes plugin settings to the service: the
// shell hands a plugin's settings to its bar widget, never to its service, so
// without pushSettings() the service runs on defaults forever
// (shell.qml hands `settings` to the widget only).
BarWidget {
  id: root
  moduleName: "agent-desktop"

  readonly property var service: bar && bar.shell
    ? bar.shell.serviceFor("agent-desktop") : null
  readonly property color foreground: bar ? bar.barForeground : Color.foreground

  function pushSettings() {
    if (service && typeof service.applySettings === "function")
      service.applySettings(settings)
  }
  onSettingsChanged: pushSettings()
  onServiceChanged: pushSettings()
  Component.onCompleted: pushSettings()

  readonly property string statusText: {
    if (!service) return "service unavailable"
    if (!service.bridgeAlive) return "bridge down"
    if (!service.serverUp) return "server down"
    if (!service.connected) return "connecting"
    if (service.busy) return "working"
    return "idle"
  }

  // Left click honours `openOnClick`; middle click takes the other one, so both
  // surfaces are always one click away whichever way it is set. The setting's
  // spelling ("Window" / "QuickChat") is translated in lib/surface.js, which is
  // also where App.qml reads the payload back.
  readonly property string primaryMode: Surface.surfaceForClickSetting(
    settings && settings.openOnClick ? settings.openOnClick : "Window")
  readonly property string secondaryMode: Surface.otherSurface(primaryMode)

  function openMode(mode) {
    if (!bar || !bar.shell || typeof bar.shell.toggle !== "function") return
    bar.shell.toggle("agent-desktop", JSON.stringify({ mode: mode }))
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    active: root.service && root.service.busy
    tooltipText: "Agent Desktop — " + root.statusText

    Item {
      id: iconSlot
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.verticalCenter: parent.verticalCenter
      width: Style.bar.iconSlot
      height: Style.bar.iconCanvas

      OpticalGlyph {
        anchors.fill: parent
        text: "󰚩"
        fontFamily: button.fontFamily
        fontSize: Style.bar.iconFont
        // Dimmed until the bridge is actually authenticated: `serverUp` only
        // means a session file exists, which is true for a whole restart cycle
        // during which nothing works.
        color: button.active && button.useActiveColor
          ? button.activeColor
          : (root.service && root.service.connected
            ? root.foreground
            // Color.muted is the theme's actual de-emphasis token (color8 on most
            // themes), not a derivation of this widget's foreground — so it stays
            // distinguishable from the foreground even on themes whose muted is
            // brighter than the bar's own foreground.
            : Color.muted)
      }
    }

    onPressed: function(b) {
      root.openMode(b === Qt.MiddleButton ? root.secondaryMode : root.primaryMode)
    }
  }
}
