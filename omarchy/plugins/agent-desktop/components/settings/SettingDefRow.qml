pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

import "../../lib/settingsRows.js" as SR

// One row generated from a SETTING_DEFS entry. The page instantiates one
// of these per def in the rowsFor() output. The kind of control
// (dropdown / number / textarea / fallback text) is decided by
// lib/settingsRows.js::controlKindFor and passed through `kind`.
//
// CLI-pinned rows (`settings:getLocked`) render DISABLED with a "locked
// by …" hint — something the React UI never did. The page passes
// `locked` and `lockReason`.
//
// Defs whose current value is not in their `options` list render an
// explicit "unknown value" hint in place of the dropdown's selected
// option, with the current value shown verbatim. optionIndexFor returns
// -1; the page passes that through `unknownValue`.
Item {
  id: root

  // The SettingDef this row renders. `def` is the raw object from
  // SETTING_DEFS; the page does not mutate it.
  required property var def

  // The control kind from lib/settingsRows.js::controlKindFor.
  required property string kind

  // The current stored value (always a string).
  required property string currentValue

  // Locked state from SettingsStore. When true the row renders disabled.
  required property bool locked
  required property string lockReason

  // When `kind === "dropdown"` and the value is not in `def.options`,
  // the page passes true so the row renders an explicit "unknown value"
  // hint instead of silently picking the wrong option.
  required property bool unknownValue

  // Emit only on user-driven change. The page passes the writes through
  // SettingsStore.set() so the optimistic-revert contract is preserved.
  signal valueChanged(string newValue)

  // The page mounts this in a Loader that sets only `width`, so the Loader
  // adopts this item's implicitHeight. Without it the item is zero-high and the
  // entire body is clipped away — which is what made every settings category
  // render blank.
  implicitHeight: bodyCol.implicitHeight

  Column {
    id: bodyCol
    anchors { left: parent.left; right: parent.right }
    spacing: Style.spacing.xs

    // Label + locked hint
    Row {
      width: parent.width
      spacing: Style.spacing.sm

      Text {
        text: root.def && root.def.label ? root.def.label : (root.def && root.def.key ? root.def.key : "")
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
        font.weight: Font.Medium
      }

      Text {
        visible: root.locked
        text: root.locked ? ("locked: " + (root.lockReason || "pinned by CLI override")) : ""
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
      }
    }

    // The control, branched by kind.
    Loader {
      id: controlLoader
      width: parent.width
      sourceComponent: root.kind === "dropdown" ? dropdownComp
        : root.kind === "number" ? numberComp
        : root.kind === "textarea" ? textareaComp
        : textComp
    }

    // Unknown-value hint shown only for dropdowns whose current value is
    // absent from the option list. The row stays editable so the user
    // can pick a valid option; the dropdown will show the unknown value
    // text instead of a silently-wrong one.
    Text {
      visible: root.kind === "dropdown" && root.unknownValue
      text: "Stored value '" + root.currentValue + "' is not in the option list — pick a value to clear it."
      color: Color.urgent
      opacity: 0.85
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
      width: parent.width
    }

    // Help text from def.description, when present.
    Text {
      visible: root.def && root.def.description && root.def.description.length > 0
      text: root.def ? (root.def.description || "") : ""
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
      width: parent.width
    }
  }

  // ---- control components -------------------------------------------

  Component {
    id: dropdownComp

    Column {
      // `SR.optionsOf`, NOT `Array.isArray(root.def.options)`: `def` arrives
      // here through a Repeater's `modelData`, which is a marshalled copy
      // whose options list is a QML variant list rather than a JS Array. The
      // isArray test that used to be here answered false for every def and
      // handed the Dropdown an empty option list — a select row that could
      // not show, or offer, any of its own values.
      property var optionsVal: SR.optionsOf(root.def)
      Dropdown {
        width: parent.width
        options: parent.optionsVal
        value: root.unknownValue ? "" : root.currentValue
        enabled: !root.locked
        onChanged: function (v) {
          if (v === undefined || v === null) return
          root.valueChanged(String(v))
        }
      }
    }
  }

  Component {
    id: numberComp

    NumberField {
      width: parent.width
      // Read the current stored value as a number; QML coerces "" to 0
      // which is fine — the def's min is 0 for the cases where this
      // matters and the page clamps on write anyway.
      value: root.currentValue === "" || root.currentValue === undefined
        ? 0
        : Number(root.currentValue)
      from: root.def && root.def.min !== undefined ? Number(root.def.min) : 0
      to: root.def && root.def.max !== undefined ? Number(root.def.max) : 1000000
      stepSize: root.def && root.def.step !== undefined ? Number(root.def.step) : 1
      enabled: !root.locked
      onModified: function (v) { root.valueChanged(String(v)) }
    }
  }


  Component {
    id: textareaComp

    TextField {
      width: parent.width
      text: root.currentValue
      enabled: !root.locked
      // Multi-line edit. The qmldir stub provides a single-line
      // TextField; the page lives with that limitation rather than
      // picking a different control.
      onEditingFinished: { root.valueChanged(text) }
    }
  }

  Component {
    id: textComp

    TextField {
      width: parent.width
      text: root.currentValue
      enabled: !root.locked
      onEditingFinished: { root.valueChanged(text) }
    }
  }
}