pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls

import qs.Commons
import qs.Ui
import "../lib/palette.js" as Palette

// A pending AskUserQuestion strip.
//
// One control group per question:
//   - multiSelect=true  -> qs.Ui.MultiSelect with the question's options
//   - single            -> one Button per option
//
// The answer map is keyed by the question TEXT (the server also accepts
// index or header — see src/core/services/canUseTool.ts:85-94). The
// parent's store.answer(requestId, answers) takes the map.
Item {
  id: root

  required property var askUser   // { requestId, questions: AskUserQuestion[] }
  required property var store

  property var _answers: ({})
  property bool submitted: false

  function _select(question, value) {
    var next = ({})
    for (var k in root._answers) next[k] = root._answers[k]
    next[question.question] = value
    root._answers = next
  }

  function _toggle(question, value) {
    var next = ({})
    for (var k in root._answers) next[k] = root._answers[k]
    var existing = String(next[question.question] || "")
    var set = new Set(existing.length > 0 ? existing.split("|") : [])
    if (set.has(value)) set.delete(value)
    else set.add(value)
    var arr = []
    set.forEach(function (v) { arr.push(v) })
    next[question.question] = arr.join("|")
    root._answers = next
  }

  function _submit() {
    if (root.submitted) return
    root.submitted = true
    root.store.answer(root.askUser.requestId, root._answers)
  }

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  Rectangle {
    id: bodyRoot
    anchors { left: root.left; right: root.right }
    height: layout.implicitHeight + 2 * Style.spacing.md
    color: Util.alpha(Color.foreground, Palette.surfaceAlpha(2))
    border { width: Style.normalBorderWidth; color: Color.accent }
    radius: Style.cornerRadius

    Column {
      id: layout
      anchors {
        left: parent.left
        right: parent.right
        top: parent.top
        margins: Style.spacing.md
      }
      spacing: Style.spacing.md

      Text {
        text: "User questions requiring answers"
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        font.weight: Font.Medium
        color: Color.accent
      }

      Repeater {
        model: root.askUser && root.askUser.questions ? root.askUser.questions : []

        delegate: Column {
          id: qCol
          required property var modelData
          spacing: Style.spacing.xs
          anchors { left: parent.left; right: parent.right }

          Text {
            text: qCol.modelData.question || ""
            font.family: Style.font.family
            font.pixelSize: Style.font.body
            color: Color.foreground
            wrapMode: Text.Wrap
            anchors { left: parent.left; right: parent.right }
          }

          // qs.Ui.MultiSelect: `options` is the option list, `values` is the
          // current set of strings. The component emits `changed(values)`
          // whenever the selection mutates.
          MultiSelect {
            visible: qCol.modelData.multiSelect && !root.submitted
            width: qCol.width
            options: (qCol.modelData.options || []).map(function (o) {
              return { value: o.label, label: o.label, description: o.description || "" }
            })
            values: {
              var raw = root._answers[qCol.modelData.question] || ""
              if (!raw) return []
              return raw.split("|")
            }
            onChanged: function (vals) {
              if (!vals) return
              var next = ({})
              for (var k in root._answers) next[k] = root._answers[k]
              next[qCol.modelData.question] = vals.join("|")
              root._answers = next
            }
          }

          // Single-select: one Button per option. The renderer's
          // AskUserBlock uses buttons too.
          Flow {
            visible: !qCol.modelData.multiSelect && !root.submitted
            spacing: Style.spacing.sm
            anchors { left: parent.left; right: parent.right }
            Repeater {
              model: qCol.modelData.options || []
              delegate: Button {
                required property var modelData
                text: modelData.label || ""
                onClicked: root._select(qCol.modelData, modelData.label || "")
              }
            }
          }
        }
      }

      Button {
        visible: !root.submitted
        text: "Submit answers"
        enabled: {
          if (!root.askUser || !root.askUser.questions) return false
          for (var i = 0; i < root.askUser.questions.length; i++) {
            if (!root._answers[root.askUser.questions[i].question]) return false
          }
          return true
        }
        onClicked: root._submit()
      }

      Text {
        visible: root.submitted
        text: "Answers submitted"
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.muted
        opacity: 0.7
      }
    }
  }
}
