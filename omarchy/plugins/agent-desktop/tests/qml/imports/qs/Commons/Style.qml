pragma Singleton
import QtQuick

// Offscreen stand-in for the Omarchy shell's Commons/Style singleton. The token
// NAMES and nesting mirror /usr/share/omarchy/shell/Commons/Style.qml exactly,
// because that is the whole point: a binding to a token the real Style does not
// have must fail here too, not silently read undefined. Values are the real
// file's fallbacks.
QtObject {
  id: root

  readonly property int cornerRadius: 0
  readonly property int gapsOut: 5

  readonly property int normalBorderWidth: 1
  readonly property int hoverBorderWidth: 1
  readonly property int selectedBorderWidth: 0
  readonly property int focusBorderWidth: 1

  readonly property color normalFill: Qt.rgba(1, 1, 1, 0.04)
  readonly property color hoverFill: Qt.rgba(1, 1, 1, 0.08)
  readonly property color selectedFill: Qt.rgba(1, 1, 1, 0.18)
  readonly property color pressedFill: Qt.rgba(1, 1, 1, 0.22)
  readonly property color focusFillColor: Qt.rgba(1, 1, 1, 0.08)
  readonly property color normalBorderColor: Qt.rgba(1, 1, 1, 0.4)
  readonly property color hoverBorderColor: Qt.rgba(1, 1, 1, 0.25)
  readonly property color selectedBorderColor: Qt.rgba(1, 1, 1, 1.0)
  readonly property color focusBorderColor: Qt.rgba(1, 1, 1, 0.25)
  readonly property color selectionFill: Qt.rgba(1, 1, 1, 0.35)

  function space(px) { return Math.round(Number(px)) }
  function spaceReal(px) { return Number(px) }

  readonly property QtObject spacing: QtObject {
    readonly property real scale: 1.0
    readonly property int hairline: 1
    readonly property int xxs: 2
    readonly property int xs: 3
    readonly property int sm: 4
    readonly property int md: 6
    readonly property int lg: 8
    readonly property int xl: 10
    readonly property int xxl: 12
    readonly property int xxxl: 14
    readonly property int huge: 18
    readonly property int controlGap: 8
    readonly property int controlPaddingX: 10
    readonly property int controlPaddingY: 6
    readonly property int inputPaddingY: 7
    readonly property int controlHeight: 28
    readonly property int popupRowHeight: 28
    readonly property int dropdownWidth: 240
    readonly property int searchableDropdownWidth: 260
    readonly property int numberFieldWidth: 120
    readonly property int searchablePopupMinHeight: 220
    readonly property int rowGap: 8
    readonly property int rowPaddingX: 12
    readonly property int labelGap: 4
    readonly property int panelGap: 14
    readonly property int panelPadding: 18
    readonly property int popupPadding: 14
  }

  readonly property QtObject font: QtObject {
    readonly property string family: "monospace"
    readonly property string resolvedFamily: "monospace"
    readonly property string menuFamily: "monospace"
    readonly property int baseSize: 12
    readonly property int caption: 10
    readonly property int bodySmall: 11
    readonly property int body: 12
    readonly property int subtitle: 13
    readonly property int title: 14
    readonly property int heading: 16
    readonly property int display: 24
    readonly property int displayLarge: 28
    readonly property int iconSmall: 11
    readonly property int icon: 14
    readonly property int iconLarge: 18
  }

  readonly property QtObject bar: QtObject {
    readonly property int sizeHorizontal: 26
    readonly property int sizeVertical: 28
    readonly property int iconSlot: 27
    readonly property int iconCanvas: 16
    readonly property int iconFont: 13
    readonly property int statusSlot: 21
  }

  function normalFillFor(fg, accent, urgent) { return Qt.rgba(1, 1, 1, 0.04) }
  function hoverFillFor(fg, accent, urgent) { return accent }
  function selectedFillFor(fg, accent, urgent) { return accent }
  function pressedFillFor(fg, accent, urgent) { return accent }
  function focusFillFor(fg, accent, urgent) { return accent }
  function selectionFillFor(fg, accent, urgent) { return accent }
  function normalBorderFor(fg, accent, urgent) { return fg }
  function hoverBorderFor(fg, accent, urgent) { return accent }
  function selectedBorderFor(fg, accent, urgent) { return accent }
  function focusBorderFor(fg, accent, urgent) { return accent }
  function controlFill(focused, hot, fg, accent) { return hot ? accent : Qt.rgba(1, 1, 1, 0.04) }
  function controlBorder(focused, hot, fg, accent) { return focused ? accent : fg }
  function controlBorderWidth(focused, hot) { return 1 }
}
