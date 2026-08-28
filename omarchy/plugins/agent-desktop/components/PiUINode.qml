pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// Recursive renderer for a PiUINode tree (lib/piUi.js:normalizeNode).
//
// Covers all eight node types from src/core/types/piUITypes.ts:3-12:
//   text, button, input, select, progress, divider, hstack/vstack, badge.
//
// hstack / vstack recurse through `children` via Loader indirection
// (NOT by naming `delegate: PiUINode` directly — that creates a
// compile-time cycle the QML engine refuses, taking out every
// consumer). The Loader's `source` is a runtime URL; the cycle
// becomes a runtime resolution, and the tree terminates because
// lib/piUi.js clamps nesting at MAX_DEPTH (32).
//
// Buttons carry an `action` string. The renderer does not interpret it:
// that is the extension's contract with its own backend, and the chrome
// is a renderer, not a handler. We only fire the signal upward.
Item {
  id: root

  required property var node

  // Recursion depth. Defaults to 0 on the root instance; the parent
  // sets it to depth+1 when loading the child via the Loader in
  // hstackComp / vstackComp. The runtime guard refuses to load past
  // MAX_DEPTH (mirrors lib/piUi.js:32) so a malformed extension tree
  // cannot spin up unbounded Loaders.
  property int depth: 0

  // Optional: when set, fired when a button in this tree is clicked.
  // Carries the button's `action` string verbatim.
  signal buttonClicked(string action)

  // Width/height for the implicit sizing chain. Children render their
  // own layout; the outer Item is just a box.
  implicitWidth: content.implicitWidth
  implicitHeight: content.implicitHeight

  Loader {
    id: content
    anchors { left: parent.left; right: parent.right }
    sourceComponent: root._selectComponent()
    onLoaded: {
      // Wire button-clicked upward through the loader's root.
      if (item && item.buttonClicked) {
        item.buttonClicked.connect(function(a) { root.buttonClicked(a) })
      }
    }
  }

  function _selectComponent() {
    if (!root.node || typeof root.node !== "object") return textComp
    switch (root.node.type) {
      case "button":  return buttonComp
      case "input":   return inputComp
      case "select":  return selectComp
      case "progress": return progressComp
      case "divider": return dividerComp
      case "hstack":  return hstackComp
      case "vstack":  return vstackComp
      case "badge":   return badgeComp
      case "text":
      default:        return textComp
    }
  }

  // ---- text ----

  // The Item wrapper carries `n` as an explicit property so the inner
  // Text reads it through textWrap.n (a fully-qualified reach), which
  // the linter accepts where bare `n` was a warning.
  Component {
    id: textComp
    Item {
      id: textWrap
      property var n: root.node
      implicitWidth: textInner.implicitWidth
      implicitHeight: textInner.implicitHeight
      Text {
        id: textInner
        text: textWrap.n && typeof textWrap.n.content === "string" ? textWrap.n.content : ""
        font.family: Style.font.family
        font.pixelSize: Style.font.body
        color: {
          if (!textWrap.n) return Color.foreground
          switch (textWrap.n.style) {
            case "bold":   return Color.foreground
            case "muted":  return Color.muted
            case "error":  return Color.urgent
            case "accent": return Color.accent
            default:       return Color.foreground
          }
        }
        font.bold: textWrap.n && textWrap.n.style === "bold"
        wrapMode: Text.WordWrap
      }
    }
  }

  // ---- button ----

  Component {
    id: buttonComp
    Item {
      id: buttonWrap
      property var n: root.node
      implicitWidth: buttonInner.implicitWidth
      implicitHeight: buttonInner.implicitHeight
      Button {
        id: buttonInner
        text: buttonWrap.n && typeof buttonWrap.n.label === "string" ? buttonWrap.n.label : ""
        onClicked: root.buttonClicked(buttonWrap.n && typeof buttonWrap.n.action === "string" ? buttonWrap.n.action : "")
      }
    }
  }

  // ---- input ----

  Component {
    id: inputComp
    Item {
      id: inputWrap
      property var n: root.node
      implicitWidth: inputInner.implicitWidth
      implicitHeight: inputInner.implicitHeight
      TextField {
        id: inputInner
        placeholderText: inputWrap.n && typeof inputWrap.n.placeholder === "string" ? inputWrap.n.placeholder : ""
      }
    }
  }

  // ---- select ----

  Component {
    id: selectComp
    Item {
      id: selectWrap
      property var n: root.node
      implicitWidth: selectInner.implicitWidth
      implicitHeight: selectInner.implicitHeight
      Dropdown {
        id: selectInner
        options: selectWrap.n && Array.isArray(selectWrap.n.options) ? selectWrap.n.options : []
      }
    }
  }

  // ---- progress ----

  Component {
    id: progressComp
    Item {
      id: progressWrap
      property var n: root.node
      implicitWidth: progressInner.implicitWidth
      implicitHeight: progressInner.implicitHeight
      ProgressBar {
        id: progressInner
        from: 0
        to: {
          if (!progressWrap.n) return 1
          if (typeof progressWrap.n.max === "number" && isFinite(progressWrap.n.max) && progressWrap.n.max > 0) return progressWrap.n.max
          return 1
        }
        value: {
          if (!progressWrap.n) return 0
          if (typeof progressWrap.n.value === "number" && isFinite(progressWrap.n.value)) return progressWrap.n.value
          return 0
        }
      }
    }
  }

  // ---- divider ----

  Component {
    id: dividerComp
    Rectangle {
      height: Style.spacing.hairline
      color: Color.muted
      opacity: 0.4
    }
  }

  // ---- hstack / vstack ----
  //
  // Children come from the NORMALIZED tree (root.node.children), so the
  // recursion is already bounded by lib/piUi.js's MAX_DEPTH clamp. The
  // Loader is also guarded by root.depth: when a child sees root.depth
  // >= MAX_DEPTH (32) it sets source to "" and refuses to load. Both
  // layers refuse to spawn unbounded Loadable children.

  Component {
    id: hstackComp
    Row {
      spacing: {
        if (root.node && typeof root.node.gap === "number" && isFinite(root.node.gap))
          return root.node.gap
        return Style.spacing.sm
      }
      Repeater {
        model: root.node && Array.isArray(root.node.children) ? root.node.children : []
        delegate: Loader {
          id: hstackChild
          required property var modelData
          // Empty source at the depth cap: the Loader stays inert and
          // does not instantiate another PiUINode.
          source: root.depth < 32 ? "PiUINode.qml" : ""
          onLoaded: {
            if (!hstackChild.item) return
            hstackChild.item.node = hstackChild.modelData
            hstackChild.item.depth = root.depth + 1
            hstackChild.item.buttonClicked.connect(function(a) { root.buttonClicked(a) })
          }
        }
      }
    }
  }

  Component {
    id: vstackComp
    Column {
      spacing: {
        if (root.node && typeof root.node.gap === "number" && isFinite(root.node.gap))
          return root.node.gap
        return Style.spacing.sm
      }
      Repeater {
        model: root.node && Array.isArray(root.node.children) ? root.node.children : []
        delegate: Loader {
          id: vstackChild
          required property var modelData
          source: root.depth < 32 ? "PiUINode.qml" : ""
          onLoaded: {
            if (!vstackChild.item) return
            vstackChild.item.node = vstackChild.modelData
            vstackChild.item.depth = root.depth + 1
            vstackChild.item.buttonClicked.connect(function(a) { root.buttonClicked(a) })
          }
        }
      }
    }
  }

  // ---- badge ----

  Component {
    id: badgeComp
    Rectangle {
      id: badgeBox
      property var bn: root.node
      radius: Style.cornerRadius
      color: Qt.rgba(0, 0, 0, 0)
      border.width: 1
      border.color: {
        if (badgeBox.bn && typeof badgeBox.bn.color === "string") return badgeBox.bn.color
        return Color.accent
      }
      implicitWidth: badgeTextItem.implicitWidth + Style.spacing.md * 2
      implicitHeight: badgeTextItem.implicitHeight + Style.spacing.xs * 2

      Text {
        id: badgeTextItem
        anchors.centerIn: parent
        text: badgeBox.bn && typeof badgeBox.bn.text === "string" ? badgeBox.bn.text : ""
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        color: {
          if (badgeBox.bn && typeof badgeBox.bn.color === "string") return badgeBox.bn.color
          return Color.foreground
        }
      }
    }
  }
}
