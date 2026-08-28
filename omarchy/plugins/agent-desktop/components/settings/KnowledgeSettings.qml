pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui


// Knowledge Base category — collections list + file detail.
//
// "Open folder" uses `Quickshell.execDetached(["xdg-open", collection.path])`,
// NOT `kb:openKnowledgesFolder` (CONTRACTS.md §8).
Item {
  id: root

  required property var store

  // Injected command runner (CONTRACTS.md §2 — components that need
  // Quickshell.execDetached take it as a function property so they stay
  // loadable by qmltestrunner). App.qml binds this to
  // Quickshell.execDetached.
  required property var exec
  // The page mounts this in a Loader that sets only `width`, so the Loader
  // adopts this item's implicitHeight. Without it the item is zero-high and the
  // entire body is clipped away — which is what made every settings category
  // render blank.
  implicitHeight: bodyCol.implicitHeight

  Column {
    id: bodyCol
    anchors { left: parent.left; right: parent.right }
    spacing: Style.spacing.md

    PanelSectionHeader { text: "Knowledge collections" }

    Text {
      width: parent.width
      text: "Collections of files made available to the agent via "
          + "ai_knowledgeFolders. Stored under the knowledges directory."
      color: Color.muted
      opacity: 0.85
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    Text {
      visible: !root.store.loaded
      text: "Loading…"
      color: Color.muted
      opacity: 0.6
      font.family: Style.font.family
      font.pixelSize: Style.font.body
    }

    Text {
      visible: root.store.loaded && root.store.collections.length === 0
      text: "No knowledge collections yet. Drop a folder under the knowledges directory."
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.body
    }

    Repeater {
      model: root.store.collections
      delegate: Item {
        id: kbRow
        required property var modelData
        width: parent.width
        height: kbLayout.implicitHeight + Style.spacing.sm

        Column {
          id: kbLayout
          width: parent.width
          spacing: Style.spacing.xs

          Row {
            width: parent.width
            spacing: Style.spacing.md

            Column {
              width: parent.width * 0.7
              spacing: 0

              Text {
                width: parent.width
                text: kbRow.modelData ? (kbRow.modelData.name || "") : ""
                color: Color.foreground
                font.family: Style.font.family
                font.pixelSize: Style.font.body
                font.weight: Font.Medium
              }
              Text {
                width: parent.width
                text: kbRow.modelData
                  ? (kbRow.modelData.path + " · " + kbRow.modelData.fileCount + " files")
                  : ""
                color: Color.muted
                opacity: 0.7
                font.family: Style.font.family
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideMiddle
              }
            }

            Row {
              width: parent.width * 0.3
              spacing: Style.spacing.xs

              Button {
                text: "Files"
                bordered: true
                onClicked: root.store.loadDetail(kbRow.modelData.name)
              }
              Button {
                text: "Open"
                bordered: true
                onClicked: {
                  // Open in file manager via xdg-open (CONTRACTS.md §8).
                  if (kbRow.modelData && kbRow.modelData.path) {
                    root.exec(["xdg-open", kbRow.modelData.path])
                  }
                }
              }
            }
          }

          // Detail pane (file list for the active collection).
          Item {
            visible: root.store.detailName === (kbRow.modelData ? kbRow.modelData.name : "")
            width: parent.width
            height: detailCol.implicitHeight

            Column {
              id: detailCol
              width: parent.width
              spacing: Style.spacing.xs

              Text {
                text: root.store.detailLoading ? "Loading files…" : "Files"
                color: Color.muted
                opacity: 0.7
                font.family: Style.font.family
                font.pixelSize: Style.font.bodySmall
              }

              Repeater {
                model: root.store.detail
                delegate: Row {
                  id: detailRow
                  required property var modelData
                  width: parent.width
                  spacing: Style.spacing.md

                  Text {
                    width: parent.width * 0.7
                    text: detailRow.modelData ? (detailRow.modelData.name || "") : ""
                    color: Color.foreground
                    font.family: Style.font.family
                    font.pixelSize: Style.font.bodySmall
                    elide: Text.ElideMiddle
                  }
                  Text {
                    width: parent.width * 0.3
                    text: detailRow.modelData && detailRow.modelData.size !== undefined
                      ? Math.round(detailRow.modelData.size / 1024) + " KB"
                      : ""
                    color: Color.muted
                    opacity: 0.7
                    font.family: Style.font.family
                    font.pixelSize: Style.font.bodySmall
                  }
                }
              }
            }
          }
        }
        }
      }
    }
}

