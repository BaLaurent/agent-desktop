pragma ComponentBehavior: Bound

import QtQuick

import qs.Commons

import "../lib/markdown.js" as Markdown

// Render one assistant text message.
//
// We split the message at fenced-code boundaries (lib/markdown.js) and
// route the two kinds of block to two different delegates. Non-code blocks
// go through Qt 6.11's Text.MarkdownText, which handles CommonMark + the
// GFM extensions (tables, task lists, strikethrough, autolinks). Code
// blocks go through CodeBlock.qml, which adds syntax colouring via
// lib/highlight.js.
Item {
  id: root

  required property string text

  property var _blocks: []

  Component.onCompleted: root._resplit()
  onTextChanged: root._resplit()

  function _resplit() {
    if (typeof text !== "string" || text.length === 0) {
      _blocks = []
      return
    }
    _blocks = Markdown.split(text)
  }

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: layout.implicitHeight

  Column {
    id: layout
    anchors { left: parent.left; right: parent.right }
    spacing: Style.spacing.md

    Repeater {
      model: root._blocks
      delegate: Loader {
        id: blockLoader
        required property var modelData
        required property int index

        anchors { left: parent.left; right: parent.right }

        sourceComponent: blockLoader.modelData
          ? (blockLoader.modelData.kind === "code" ? codeComp : mdComp)
          : mdComp

        Component {
          id: mdComp
          Text {
            text: blockLoader.modelData ? (blockLoader.modelData.text || "") : ""
            textFormat: Text.MarkdownText
            wrapMode: Text.Wrap
            color: Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
            width: blockLoader.width
          }
        }

        Component {
          id: codeComp
          CodeBlock {
            code: blockLoader.modelData ? (blockLoader.modelData.text || "") : ""
            lang: blockLoader.modelData && blockLoader.modelData.lang ? blockLoader.modelData.lang : ""
            width: blockLoader.width
          }
        }
      }
    }
  }
}
