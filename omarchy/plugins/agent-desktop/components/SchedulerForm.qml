pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// Create-or-edit form for one ScheduledTask. Receives `store` and a `task`:
// - task === null/empty: form is in create mode, "Save" calls store.create
// - task present:        form is in edit mode,  "Save" calls store.update
//
// The store does the invoke; the form does not. A form that reaches for the
// service singleton would not be Quickshell-free, and CONTRACTS.md §2 keeps
// every component off Quickshell for the same reason.
//
// `conversation_id` is OPTIONAL — omitting it auto-creates a new conversation
// (CreateScheduledTask field). The form renders an explicit "Create a new
// conversation" checkbox rather than a blank field, because a blank field
// would be ambiguous between "unset" and "explicitly set to 0".
Item {
  id: form

  required property var store
  property var task: null

  signal cancelled()
  signal saved()

  readonly property var sourceTask: form.task || ({})
  readonly property bool hasTask: form.task && form.task.id !== undefined

  // Local mirrors of the CreateScheduledTask fields. Two reasons we do not
  // bind straight to store.tasks[id]:
  //   1. cancel() must restore prior state without touching the list
  //   2. the user edits in real time; we do not want every keystroke to push
  //      a server roundtrip.
  property string name: sourceTask.name || ""
  property string prompt: sourceTask.prompt || ""
  property bool newConversation: !form.task || form.task.conversation_id === undefined
  property string conversationId: sourceTask.conversation_id !== undefined
    ? String(sourceTask.conversation_id) : ""
  property int intervalValue: sourceTask.interval_value
    ? Number(sourceTask.interval_value) : 15
  // Dropdown's real contract is `value: string`, not `currentIndex`. Keeping
  // it as a string lets one property drive both Dropdown and the form
  // serialisation.
  property string intervalUnit: sourceTask.interval_unit || "minutes"
  property string scheduleTime: sourceTask.schedule_time || ""
  property int maxRuns: (sourceTask.max_runs !== null && sourceTask.max_runs !== undefined)
    ? Number(sourceTask.max_runs) : 0
  property bool catchUp: sourceTask.catch_up !== false
  property bool notifyDesktop: sourceTask.notify_desktop !== false
  property bool notifyVoice: sourceTask.notify_voice === true
  property string preRunAction: sourceTask.pre_run_action || "none"

  // Read once per render. Dropdown.options is a `var` array; defining it on
  // the form (not as a property) keeps the named constants local to this file.
  readonly property var intervalUnitOptions: [
    { label: "minutes", value: "minutes" },
    { label: "hours",   value: "hours"   },
    { label: "days",    value: "days"    }
  ]
  readonly property var preRunActionOptions: [
    { label: "none",    value: "none"    },
    { label: "clear",   value: "clear"   },
    { label: "compact", value: "compact" }
  ]

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  Column {
    id: bodyRoot
    anchors { fill: parent }
    spacing: Style.spacing.md
    // Page-section heading. The compile gate's PanelHero stub exposes only
    // `text`; using a styled Text matches what `PanelHero` actually renders
    // for a single-line title.
    Text {
      text: form.hasTask ? ("Edit task — " + form.name) : "New scheduled task"
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: Style.font.title
      font.bold: true
    }
    Text { text: "Name"; color: Color.foreground; font.family: Style.font.family; font.pixelSize: Style.font.bodySmall }
    TextField {
      text: form.name
      onTextChanged: form.name = text
      width: parent.width
      placeholderText: "summarise logs every hour"
    }

    Text { text: "Prompt"; color: Color.foreground; font.family: Style.font.family; font.pixelSize: Style.font.bodySmall }
    TextField {
      text: form.prompt
      onTextChanged: form.prompt = text
      width: parent.width
      topPadding: Style.spacing.sm
      bottomPadding: Style.spacing.sm
      placeholderText: "the instruction given to the model on every run"
    }

    Text {
      text: form.newConversation
        ? "A new conversation will be created when this task fires."
        : "Each run will continue the existing conversation below."
      color: Color.foreground
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
      width: parent.width
    }

    Row {
      spacing: Style.spacing.md
      Switch {
        checked: form.newConversation
        onToggled: form.newConversation = checked
      }
      Text {
        text: "Create a new conversation for this task"
        color: Color.foreground
        anchors.verticalCenter: parent.verticalCenter
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
    }

    // Plain TextField rather than NumberField because conversation ids can
    // exist in the DB only and the user may be hand-typing — the server
    // validates whatever reaches it.
    TextField {
      visible: !form.newConversation
      text: form.conversationId
      onTextChanged: form.conversationId = text
      placeholderText: "conversation id"
      width: parent.width
    }

    Text { text: "Interval"; color: Color.foreground; font.family: Style.font.family; font.pixelSize: Style.font.bodySmall }
    Row {
      spacing: Style.spacing.md
      NumberField {
        value: form.intervalValue
        from: 1
        to: 1000
        stepSize: 1
        onModified: function(v) { form.intervalValue = v }
      }
      Dropdown {
        options: form.intervalUnitOptions
        value: form.intervalUnit
        onChanged: function(v) { form.intervalUnit = v }
      }
    }

    Text { text: "Schedule time (HH:MM, optional)"; color: Color.foreground; font.family: Style.font.family; font.pixelSize: Style.font.bodySmall }
    TextField {
      text: form.scheduleTime
      onTextChanged: form.scheduleTime = text
      placeholderText: "leave blank for plain intervals"
      width: parent.width
    }

    Text { text: "Max runs (0 = unlimited)"; color: Color.foreground; font.family: Style.font.family; font.pixelSize: Style.font.bodySmall }
    NumberField {
      value: form.maxRuns
      from: 0
      to: 10000
      stepSize: 1
      onModified: function(v) { form.maxRuns = v }
      width: 200
    }

    Row {
      spacing: Style.spacing.md
      Switch { checked: form.catchUp; onToggled: form.catchUp = checked }
      Text { text: "Catch up missed runs"; color: Color.foreground; anchors.verticalCenter: parent.verticalCenter; font.family: Style.font.family; font.pixelSize: Style.font.body }
    }
    Row {
      spacing: Style.spacing.md
      Switch { checked: form.notifyDesktop; onToggled: form.notifyDesktop = checked }
      Text { text: "Notify on desktop"; color: Color.foreground; anchors.verticalCenter: parent.verticalCenter; font.family: Style.font.family; font.pixelSize: Style.font.body }
    }
    Row {
      spacing: Style.spacing.md
      Switch { checked: form.notifyVoice; onToggled: form.notifyVoice = checked }
      Text { text: "Notify by voice"; color: Color.foreground; anchors.verticalCenter: parent.verticalCenter; font.family: Style.font.family; font.pixelSize: Style.font.body }
    }

    Text { text: "Action before each run"; color: Color.foreground; font.family: Style.font.family; font.pixelSize: Style.font.bodySmall }
    Dropdown {
      options: form.preRunActionOptions
      value: form.preRunAction
      onChanged: function(v) { form.preRunAction = v }
    }

    Row {
      spacing: Style.spacing.md
      Button {
        text: "Cancel"
        onClicked: form.cancelled()
      }
      Button {
        text: form.hasTask ? "Save" : "Create"
        onClicked: form.commit()
      }
    }
  }

  function commit() {
    var data = {
      name: form.name,
      prompt: form.prompt,
      interval_value: form.intervalValue,
      interval_unit: form.intervalUnit,
      catch_up: form.catchUp,
      notify_desktop: form.notifyDesktop,
      notify_voice: form.notifyVoice,
      pre_run_action: form.preRunAction
    }
    if (form.scheduleTime.length > 0) data.schedule_time = form.scheduleTime
    if (form.maxRuns > 0) data.max_runs = form.maxRuns
    if (!form.newConversation) data.conversation_id = Number(form.conversationId)

    if (form.hasTask) {
      form.store.update(form.task.id, data, function() { form.saved() })
    } else {
      form.store.create(data, function() { form.saved() })
    }
  }
}
