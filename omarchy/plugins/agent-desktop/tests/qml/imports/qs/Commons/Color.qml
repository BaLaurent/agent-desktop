pragma Singleton
import QtQuick

// Offscreen stand-in for Commons/Color. Group names mirror the real singleton
// (/usr/share/omarchy/shell/Commons/Color.qml:19-133) so a binding to a surface
// group that does not exist fails here too.
QtObject {
  id: root

  property color foreground: "#cacccc"
  property color background: "#101315"
  property color accent: "#cacccc"
  property color urgent: "#a55555"
  property color muted: "#707880"

  readonly property QtObject bar: QtObject {
    property color background: root.background
    property color text: root.foreground
    property color active: root.urgent
  }
  readonly property QtObject popups: QtObject {
    property color background: root.background
    property color text: root.foreground
    property color border: root.accent
  }
  readonly property QtObject tooltip: QtObject {
    property color background: root.background
    property color text: root.foreground
    property color border: root.foreground
  }
  readonly property QtObject notifications: QtObject {
    property color background: root.background
    property color text: root.foreground
    property color border: root.accent
    property color countdown: root.accent
  }
  readonly property QtObject menu: QtObject {
    property color background: root.background
    property color text: root.foreground
    property color border: root.foreground
    property color scrim: Qt.rgba(0, 0, 0, 0.5)
    property color selectedBackground: Qt.rgba(1, 1, 1, 0.08)
    property color selectedText: root.accent
    property color selectedBorder: Qt.rgba(1, 1, 1, 0)
  }
}
