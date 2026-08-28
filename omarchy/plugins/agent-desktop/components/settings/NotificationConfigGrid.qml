pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// The 7x2 notification toggle grid from GeneralSettings.tsx.
//
// For each NotificationEvent (success / max_tokens / refusal /
// error_max_turns / error_max_budget / error_execution / error_js), two
// checkboxes: "Sound" and "Desktop". The stored value is the JSON
// NotificationConfig (Record<NotificationEvent, { sound, desktop }>).
//
// The grid mutates its own `config` property on every toggle. The
// auto-generated `configChanged` signal then fires for the parent,
// which reads `grid.config` and serialises it to JSON for
// `settings:notificationConfig` (CONTRACTS.md §6c — never declare
// `<propname>Changed` by hand; the QML engine does it).
//
// One authoritative owner for the JSON: the parent. The grid does not
// touch SettingsStore; it just emits the new object via the property
// change.
Item {
  id: root

  // NOTIFICATION_EVENTS shape: [{ key, label }, ...]. Required.
  required property var events

  // DEFAULT_NOTIFICATION_CONFIG shape:
  // Record<NotificationEvent, { sound, desktop }>. Used for the default
  // fallback when a key is missing from the user's config.
  required property var defaults

  // Parsed config (object). The parent reads SettingsStore.get("notificationConfig")
  // and JSON-parses it; the grid reassigns this on every toggle and the
  // auto-generated `configChanged` signal fires.
  property var config: ({})

  // Build the merged config the grid renders: defaults + user overrides.
  function _resolve(key) {
    var user = root.config ? root.config[key] : null
    if (user && typeof user === "object") {
      return {
        sound: user.sound === true,
        desktop: user.desktop === true
      }
    }
    var def = root.defaults ? root.defaults[key] : null
    if (def && typeof def === "object") {
      return {
        sound: def.sound === true,
        desktop: def.desktop === true
      }
    }
    return { sound: true, desktop: true }
  }

  // Mutate `config` in place (reassign) to fire configChanged.
  function _set(key, field, value) {
    var next = {}
    for (var i = 0; i < root.events.length; i++) {
      var ev = root.events[i]
      var resolved = _resolve(ev.key)
      if (ev.key === key) {
        if (field === "sound") resolved = { sound: value, desktop: resolved.desktop }
        else resolved = { sound: resolved.sound, desktop: value }
      }
      next[ev.key] = { sound: resolved.sound, desktop: resolved.desktop }
    }
    root.config = next
  }

  // The page mounts this in a Loader that sets only `width`, so the Loader
  // adopts this item's implicitHeight. Without it the item is zero-high and the
  // entire body is clipped away — which is what made every settings category
  // render blank.
  implicitHeight: bodyCol.implicitHeight

  Column {
    id: bodyCol
    width: parent.width
    spacing: Style.spacing.xs

    // Header row.
    //
    // The three columns are fractions of the space that is left AFTER the Row's
    // own spacing. Taking fractions of `parent.width` instead overflows by
    // 2 x spacing and clips the last column off the pane — which is exactly what
    // hid the "Desktop" toggles.
    Row {
      id: headerRow
      width: parent.width
      spacing: Style.spacing.md
      readonly property real colFree: width - 2 * spacing

      Text {
        width: headerRow.colFree * 0.5
        text: "Event"
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.muted
      }
      Text {
        width: headerRow.colFree * 0.25
        text: "Sound"
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.muted
      }
      Text {
        width: headerRow.colFree * 0.25
        text: "Desktop"
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.muted
      }
    }

    Repeater {
      model: root.events
      delegate: Row {
        id: row
        required property var modelData
        width: parent.width
        spacing: Style.spacing.md
        // Same spacing budget as the header, so the columns line up with it.
        readonly property real colFree: width - 2 * spacing

        Text {
          width: row.colFree * 0.5
          anchors.verticalCenter: parent.verticalCenter
          text: row.modelData ? (row.modelData.label || row.modelData.key) : ""
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.body
        }

        Toggle {
          width: row.colFree * 0.25
          checked: row.modelData ? root._resolve(row.modelData.key).sound : false
          onClicked: {
            if (!row.modelData) return
            root._set(row.modelData.key, "sound", !checked)
          }
        }

        Toggle {
          width: row.colFree * 0.25
          checked: row.modelData ? root._resolve(row.modelData.key).desktop : false
          onClicked: {
            if (!row.modelData) return
            root._set(row.modelData.key, "desktop", !checked)
          }
        }
      }
    }
  }
}