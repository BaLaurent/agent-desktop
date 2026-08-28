pragma ComponentBehavior: Bound

import QtQuick

import qs.Commons

import "../lib/toolSummary.js" as ToolSummary
import "../lib/diff.js" as Diff
import "../lib/palette.js" as Palette

// A tool invocation rendered as a card. Renders inside MessageList for the
// live stream and inside a persisted assistant message's tool_calls
// section after rehydration.
//
// The store's reducer only flips status to "done" when a `tool_result`
// chunk arrives — and for some tools (e.g. Write behind a permission gate)
// the server never emits one, so a tool part can end the turn still at
// status:"running". The UI is responsible for not showing an eternal
// spinner in that case: when turnActive=false (the turn has been
// committed) and the tool is still "running", render a settled state.
//
// One component, two visual states:
//   - turnActive && status==="running" -> spinner
//   - turnActive && status==="done"    -> output panel, default expanded
//   - !turnActive && status==="running" -> settled (dimmed, no spinner)
//   - !turnActive && status==="done"   -> output panel, default expanded
Item {
  id: root

  // tool part
  required property string name
  // The tool_use_id from the SDK. `id` is a QML reserved keyword for
  // declaring object ids, so we use `partId` for the property name —
  // the MessageList passes `modelData.id` as `partId`.
  required property string partId
  required property string status  // "running" | "done"
  property var input
  property string output
  property string summary

  // Live-stream context: passed in by the message list so the card can
  // distinguish "still running" (show spinner) from "settled without a
  // result chunk" (no spinner, dim).
  property bool turnActive: false

  // Auto-expand finished tools that produced something worth reading —
  // output, a summary, OR a diff. Rehydrated edit parts carry neither output
  // nor summary (the server stores `output: ""` on a successful Edit), so a
  // reloaded transcript's edit card stayed collapsed and hid the diff behind
  // the expand toggle.
  property bool expanded: root.status === "done"
    && (!!root.output || !!root.summary || outputCol.editDiff !== null)
  property bool hover: false

  // One-line summary (file path, command, etc.) via lib/toolSummary.
  function _summary() {
    return ToolSummary.summarize(root.name, root.input)
  }

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) reads the item's implicitHeight — so it must be REAL.
  // `bodyRoot.implicitHeight` is 0: a Rectangle does NOT aggregate its
  // children into its implicit size, so the old expression measured nothing
  // and the card rendered zero-high — tool calls were invisible in every
  // live transcript while the store held them (measured: root.ih=0 while
  // body.h=28).
  //
  // The total height is the header card plus the output panel when shown —
  // outputCol sits BELOW bodyRoot's border by design, so both count.
  implicitHeight: bodyRoot.height + (outputCol.visible ? outputCol.implicitHeight : 0)
  height: implicitHeight


  Rectangle {
    id: bodyRoot
    anchors { left: parent.left; right: parent.right }
    height: layout.implicitHeight + 2 * Style.spacing.sm
    color: Util.alpha(Color.foreground, Palette.surfaceAlpha(2))
    border { width: Style.normalBorderWidth; color: Color.muted }
    radius: Style.cornerRadius

    Column {
      id: layout
      anchors {
        left: parent.left
        right: parent.right
        top: parent.top
        margins: Style.spacing.sm
      }
      spacing: Style.spacing.xs

      Row {
        spacing: Style.spacing.sm
        anchors { left: parent.left; right: parent.right }

        // Status indicator — spinner when running live, checkmark when done,
        // a dim dot when settled without a result chunk.
        Rectangle {
          width: Style.spacing.sm
          height: width
          radius: width / 2
          anchors.verticalCenter: parent.verticalCenter
          color: root.status === "done"
            ? Color.accent
            : (root.turnActive ? Color.urgent : Color.muted)
        }

        Text {
          text: root.name + (root.input ? ": " + root._summary() : "")
          elide: Text.ElideRight
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          color: root.status === "done" || root.turnActive
            ? Color.foreground
            : Color.muted
          opacity: root.status === "done" || root.turnActive ? 1.0 : 0.7
          anchors.verticalCenter: parent.verticalCenter
        }

        Item { width: 1; height: 1 }

        // Expand / collapse toggle.
        MouseArea {
          visible: !!(root.output || root.summary)
          anchors.right: parent.right
          width: chevronText.implicitWidth + 2 * Style.spacing.xs
          height: Style.bar.sizeHorizontal
          cursorShape: Qt.PointingHandCursor
          onClicked: root.expanded = !root.expanded
          Text {
            id: chevronText
            anchors.centerIn: parent
            text: root.expanded ? "▼" : "▶"
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            color: Color.muted
          }
        }
      }

      // Output panel.
      Column {
        id: outputCol
        // Same widening as the expanded property: a rehydrated Edit carries
        // neither output nor summary, so the panel hid even when a diff was
        // available — the whole point of the card.
        visible: root.expanded
          && (!!root.output || !!root.summary || editDiff !== null)
        spacing: Style.spacing.xs
        anchors { left: parent.left; right: parent.right }

        // An EDIT tool's input is the old and new text in full. Rendering it
        // as `JSON.stringify(input)` produced one unreadable blob of exactly
        // the thing the user wants to compare, so an edit card showed the
        // payload instead of the change. Diff when we can, JSON otherwise.
        readonly property var editPair: ToolSummary.editStrings(root.input)
        readonly property var editDiff: editPair
          ? Diff.lineDiff(editPair.oldStr, editPair.newStr)
          : null

        // Input as a one-line readout (matches the renderer's ToolUseShell).
        // Only when there is no diff to show instead.
        Text {
          visible: root.input !== undefined && root.input !== null
                   && outputCol.editDiff === null
          text: root.input !== undefined
            ? JSON.stringify(root.input)
            : ""
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          color: Color.muted
          wrapMode: Text.Wrap
          anchors { left: parent.left; right: parent.right }
        }

        // Diff header: the counts, and the file the edit lands in.
        Text {
          visible: outputCol.editDiff !== null
          text: {
            var d = outputCol.editDiff
            if (!d) return ""
            if (d.truncated) return "diff too large to display"
            var path = root.input && (root.input.file_path || root.input.path)
            return "+" + d.added + " −" + d.removed
              + (path ? "  " + String(path) : "")
          }
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          color: Color.muted
          elide: Text.ElideLeft
          anchors { left: parent.left; right: parent.right }
        }

        // The diff itself. Monospace, one row per line, coloured by op.
        Rectangle {
          visible: outputCol.editDiff !== null && !outputCol.editDiff.truncated
          anchors { left: parent.left; right: parent.right }
          height: diffCol.implicitHeight + 2 * Style.spacing.xs
          color: Util.alpha(Color.foreground, Palette.surfaceAlpha(3))
          radius: Style.cornerRadius

          Column {
            id: diffCol
            anchors {
              left: parent.left
              right: parent.right
              top: parent.top
              margins: Style.spacing.xs
            }
            spacing: 0

            Repeater {
              model: outputCol.editDiff
                ? outputCol.editDiff.rows
                : []
              delegate: Text {
                required property var modelData
                width: diffCol.width
                text: String(modelData.op) + String(modelData.text)
                font.family: Style.font.family
                font.pixelSize: Style.font.caption
                // Removed and added carry the meaning; context stays muted so
                // the eye lands on the change.
                color: modelData.op === "-" ? Color.urgent
                  : (modelData.op === "+" ? Color.accent : Color.muted)
                wrapMode: Text.NoWrap
                elide: Text.ElideRight
              }
            }
          }
        }

        // Output / summary — use the same monospace block as CodeBlock.
        Rectangle {
          visible: !!(root.output || root.summary)
          anchors { left: parent.left; right: parent.right }
          height: outputText.implicitHeight + 2 * Style.spacing.xs
          color: Util.alpha(Color.foreground, Palette.surfaceAlpha(3))
          radius: Style.cornerRadius
          Text {
            id: outputText
            anchors {
              left: parent.left
              right: parent.right
              top: parent.top
              margins: Style.spacing.xs
            }
            text: root.output || root.summary || ""
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            color: Color.foreground
            wrapMode: Text.Wrap
          }
        }
      }
    }
  }
}
