pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import qs.Commons
import qs.Ui

// Multi-line chat input.
//
// Mirrors MessageInput.tsx:120 — at-mentions resolve to markdown links on
// send (`@name` -> `[name](path)`); slash at position 0 opens a command
// popup; Enter sends when sendOnEnter is "true", else Ctrl+Enter sends;
// Escape stops the running turn when streaming, otherwise asks the parent
// to dismiss (the component must NOT call shell.hide itself).
//
// Attachments: a "+" button in the bottom row emits `attachRequested`.
// The parent (App.qml) opens a FileDialog and pushes chosen files back
// through `addAttachment()`. Above the textarea, a chips row shows the
// queued attachments — name + human-readable size + a × to remove one.
// `send()` forwards them to ChatStore and clears the list; an
// attachment-only message (no text but at least one chip) is allowed.
Item {
  id: root

  // Content-driven height, so a parent can size to the input instead of
  // guessing. `inputBox` is the only sized child and already derives its own
  // implicitHeight from the composer line — the textarea and the + / mic /
  // Send buttons on ONE row — plus the attachment chips above it; before
  // this, ChatView allotted a hardcoded 80 px in the quick overlay and the
  // input rendered straight through the bottom of the overlay card.
  //
  // Safe against a binding loop: inputBox.implicitHeight depends on the
  // textarea's own implicit size, never on root.height.
  implicitHeight: inputBox.implicitHeight

  // Put the caret in the textarea. The surface that owns the window calls this
  // after mapping: a layer-shell PanelWindow can hold Wayland keyboard focus
  // while no QML item inside has focus, and then every keystroke — including
  // Escape — is delivered to the surface and dropped. That is what made the
  // quick overlay look inert: it mapped, it had the keyboard, and typing did
  // nothing because `Keys.onPressed` lives on this TextArea.
  function focusInput() { inputArea.forceActiveFocus() }

  // Observable proof that focusInput() actually took. The owning surface
  // retries until this reads true, because the compositor decides when the
  // window can accept focus and nothing in QML can order it earlier.
  readonly property bool inputHasFocus: inputArea.activeFocus

  required property var store
  required property var settingsStore

  // Emit when the user asks for a file picker. ChatInput is a leaf
  // (CONTRACTS.md §2): it cannot open a host dialog, so App.qml runs the
  // out-of-process picker (components/FilePicker.qml — the Qt.labs.platform
  // dialog it replaced SEGFAULTED the whole shell) and pushes each chosen
  // file back through `addAttachment()`.
  signal attachRequested()

  // NO drag-and-drop signal, deliberately.
  //
  // Electron wraps the composer in a FileDropZone
  // (src/renderer/components/file-attach/FileDropZone.tsx:10). A QML DropArea
  // here never fires: MEASURED with the key filter removed and a probe on
  // `onEntered`, dragging a file from Nautilus onto this surface produced no
  // event at all, because Quickshell's Wayland surfaces are not
  // wl_data_device drop destinations. Shipping the DropArea anyway would add
  // exactly the defect this plugin keeps fixing — a control that cannot act.
  // Use the "+" button (attachRequested) instead.

  // Append a single attachment, deduplicating by `path`. A user can pick the
  // same file twice across two dialog opens — the second push is silently
  // dropped, matching the mention-popup's behaviour for the same display.
  function addAttachment(att) {
    if (!att || !att.path) return
    var self = root
    for (var i = 0; i < self.attachments.length; i++) {
      if (self.attachments[i].path === att.path) return
    }
    var next = self.attachments.slice()
    next.push({
      name: String(att.name || ""),
      path: String(att.path || ""),
      type: String(att.type || ""),
      size: Number(att.size || 0)
    })
    self.attachments = next
  }

  function clearAttachments() {
    root.attachments = []
  }

  // Drop a single attachment by index. The chip × button calls this; the
  // chips re-render because `root.attachments` is replaced.
  function _removeAttachment(index) {
    var self = root
    var i = Number(index)
    if (i < 0 || i >= self.attachments.length) return
    var next = self.attachments.slice()
    next.splice(i, 1)
    self.attachments = next
  }

  // Render a byte count as "1.2 KB" / "4.5 MB". The chips show this after
  // the file name; a zero or unknown size stays out of the label entirely.
  function _humanSize(bytes) {
    var n = Number(bytes)
    if (!isFinite(n) || n <= 0) return ""
    var units = ["B", "KB", "MB", "GB"]
    var i = 0
    while (n >= 1024 && i < units.length - 1) {
      n = n / 1024
      i += 1
    }
    return (i === 0 ? Math.round(n) : n.toFixed(1)) + " " + units[i]
  }

  // VoiceStore — optional. When present, the input mounts a MicButton
  // (press-and-hold on the mouse, toggle on the keyboard shortcut), shows
  // the voice state on its status row, and refuses to send on Enter while
  // a recording is in flight (it would otherwise send an empty prompt
  // after the dictation started but before the user pressed stop).
  property var voiceStore: null
  // Optional helpers from Main:
  //   - onDismiss: function() -> called when Escape fires and the store
  //     is NOT streaming. The overlay uses this to close the panel.
  property var onDismiss: null

  // ---- input state ----
  property string content: ""
  // External text from voice transcription lands here.
  property var externalText: null  // { text: string, id: number }

  // ---- popup state ----
  property bool slashOpen: false
  property string slashFilter: ""
  property int slashIndex: 0
  property var slashCommands: []
  property var _slashCwdRef: null

  property bool mentionOpen: false
  property string mentionFilter: ""
  property int mentionIndex: 0
  property var mentionFiles: []
  property var _mentionCwdRef: null
  property string _excludeKey: ""

  // Resolved mentions: displayText -> absolute path, used at send time.
  property var resolvedMentions: []

  // Pending attachments queued for the next send. Each entry is the shape
  // the backend expects on `messages:send` (see src/core/types/types.ts:354):
  // { name, path, type, size }. The chips row reads from this; `send()`
  // forwards it to ChatStore.send() and clears it. Path is the dedup key —
  // picking the same file twice must not produce two chips.
  property var attachments: []
  // External text consumption guard.
  property int _consumedExternalId: 0

  // Effective sendOnEnter
  property string _sendOnEnter:
    settingsStore ? settingsStore.get("sendOnEnter", "true") : "true"

  // cwd and excludePatterns from the active conversation.
  property string _cwd: ""
  property var _excludePatterns: []

  // Disabled flag — bound externally when auth or server is not ready.
  property bool disabled: false

  function setCwd(cwd, excludePatterns) {
    root._cwd = cwd || ""
    root._excludePatterns = excludePatterns || []
    root._excludeKey = root._excludePatterns.join(",")
    if (root._cwd !== root._mentionCwdRef || root._excludeKey !== root._excludeKey) {
      root._mentionCwdRef = root._cwd
      root._loadFiles()
    }
  }

  // ---- slash / mention loading ----

  function _loadCommands() {
    if (!root.store || !root.store.rpc) return
    var cwd = root._cwd
    var skillsMode = settingsStore.get("ai_skills", "off")
    var disabledSkills = []
    try {
      var raw = settingsStore.get("ai_disabledSkills", "")
      disabledSkills = raw ? JSON.parse(raw) : []
    } catch (e) { disabledSkills = [] }
    var key = (cwd || "") + "|" + skillsMode + "|" + JSON.stringify(disabledSkills)
    if (root._slashCwdRef === key && root.slashCommands.length > 0) return
    root.store.rpc.invoke("commands:list", [cwd || undefined, skillsMode],
      function (result) {
        var cmds = Array.isArray(result) ? result : []
        var filtered = []
        for (var i = 0; i < cmds.length; i++) {
          if (cmds[i].source === "skill" && disabledSkills.indexOf(cmds[i].name) >= 0) continue
          filtered.push(cmds[i])
        }
        root.slashCommands = filtered
        root._slashCwdRef = key
      }, function () { root.slashCommands = [] })
  }

  function _loadFiles() {
    if (!root.store || !root.store.rpc) return
    if (!root._cwd) return
    var cwd = root._cwd
    var exclude = root._excludePatterns
    var key = cwd + "|" + root._excludeKey
    if (root._mentionCwdRef === cwd
        && root._excludeKey === root._excludeKey
        && root.mentionFiles.length > 0) return
    root.store.rpc.invoke("files:listTree", [cwd, exclude],
      function (result) {
        var flat = []
        function walk(node, prefix) {
          if (!node) return
          var rel = prefix ? (prefix + "/" + node.name) : node.name
          flat.push({ path: node.path, name: node.name, relativePath: rel })
          if (node.children && node.children.length) {
            for (var i = 0; i < node.children.length; i++) walk(node.children[i], rel)
          }
        }
        if (Array.isArray(result)) {
          for (var i = 0; i < result.length; i++) walk(result[i], "")
        }
        root.mentionFiles = flat
        root._mentionCwdRef = cwd
      }, function () { root.mentionFiles = [] })
  }

  // ---- send ----

  function _resolveMentions(text) {
    var out = text
    for (var i = 0; i < root.resolvedMentions.length; i++) {
      var m = root.resolvedMentions[i]
      // Replace "@relativePath" with the markdown link.
      var pat = "@" + m.display.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      out = out.replace(new RegExp(pat, "g"), "[" + m.name + "](" + m.path + ")")
    }
    return out
  }

  // Message being edited, 0 when composing a new one. Set by
  // ChatView.onEdit via beginEdit(); cleared on send or cancel.
  property int editingMessageId: 0

  function beginEdit(messageId, content) {
    var self = root
    self.editingMessageId = Number(messageId) || 0
    self.content = String(content || "")
    // Attachments belong to the ORIGINAL message and cannot be re-derived
    // from it, so an edit starts with none rather than silently re-sending
    // whatever happened to be pending.
    self.attachments = []
    self.resolvedMentions = []
    self.focusInput()
  }

  function cancelEdit() {
    var self = root
    self.editingMessageId = 0
    self.content = ""
    self.attachments = []
    self.resolvedMentions = []
  }

  function send() {
    // The body uses `root.<prop>` so qmllint validates names against the
    // component scope. Under `pragma ComponentBehavior: Bound`, an inline JS
    // function called from external JavaScript (qmltestrunner) loses access
    // to that scope — `root` evaluates to undefined and any access throws.
    // The fix is to capture the instance into a local before any reference
    // and use it everywhere below; bindings elsewhere still use `root.<prop>`
    // since they evaluate through QML's binder, not the JS engine.
    var self = root
    var trimmed = self.content.trim()
    var atts = self.attachments.slice()
    // An attachment-only message is legitimate: the user can drop a file
    // without typing a word and ask the agent to summarise it. The trimmed
    // check alone would silently drop that send.
    if ((!trimmed && atts.length === 0) || self.disabled) return
    var resolved = trimmed ? self._resolveMentions(trimmed) : ""
    var editing = self.editingMessageId
    self.content = ""
    self.resolvedMentions = []
    self.attachments = []
    self.editingMessageId = 0
    if (self.slashOpen) self.slashOpen = false
    if (self.mentionOpen) self.mentionOpen = false
    if (editing > 0) {
      // Editing replaces the stored message and re-runs from there; it is
      // NOT a new turn, so it must not go through send()'s queue path.
      self.store.editMessage(editing, resolved)
      return
    }
    // ChatStore.send queues when streaming, dispatches when idle.
    self.store.send(resolved, atts)
  }

  // ---- keystroke handling ----

  function _onKey(event) {
    var self = root
    if (self.slashOpen && self.slashCommands.length > 0) {
      if (event.key === Qt.Key_Down) {
        self.slashIndex = Math.min(self.slashIndex + 1, self.slashCommands.length - 1)
        event.accepted = true
        return
      }
      if (event.key === Qt.Key_Up) {
        self.slashIndex = Math.max(self.slashIndex - 1, 0)
        event.accepted = true
        return
      }
      if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) || event.key === Qt.Key_Tab) {
        event.accepted = true
        self._selectSlash(self.slashCommands[self.slashIndex])
        return
      }
    }
    if (self.slashOpen && event.key === Qt.Key_Escape) {
      self.slashOpen = false
      event.accepted = true
      return
    }
    if (self.mentionOpen && self.mentionFiles.length > 0) {
      if (event.key === Qt.Key_Down) {
        self.mentionIndex = Math.min(self.mentionIndex + 1, self.mentionFiles.length - 1)
        event.accepted = true
        return
      }
      if (event.key === Qt.Key_Up) {
        self.mentionIndex = Math.max(self.mentionIndex - 1, 0)
        event.accepted = true
        return
      }
      if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) || event.key === Qt.Key_Tab) {
        event.accepted = true
        self._selectMention(self.mentionFiles[self.mentionIndex])
        return
      }
    }
    if (self.mentionOpen && event.key === Qt.Key_Escape) {
      self.mentionOpen = false
      event.accepted = true
      return
    }

    // Enter while a voice recording is in flight must stop the recording,
    // not send an empty prompt. Without this, the very press that the
    // user thinks ended the dictation actually fired `send()` because
    // the textarea was empty.
    if (self.voiceStore
        && (self.voiceStore.recording || self.voiceStore.starting)
        && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
        && !(event.modifiers & Qt.ShiftModifier)) {
      event.accepted = true
      self.voiceStore.stop()
      return
    }

    // Escape unwinds one level at a time: an in-progress edit first, then a
    // running turn, then (overlay only) dismissal. Cancelling the edit has to
    // come first — otherwise Escape closes the overlay and the composer keeps
    // a hidden edit target, so the NEXT message silently overwrites an old
    // one instead of being sent.
    if (event.key === Qt.Key_Escape) {
      if (self.editingMessageId > 0) {
        self.cancelEdit()
        event.accepted = true
        return
      }
      if (self.store && self.store.streaming) {
        self.store.stop()
        event.accepted = true
        return
      }
      if (self.onDismiss) {
        self.onDismiss()
        event.accepted = true
        return
      }
    }

    if (self._sendOnEnter === "false") {
      if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && (event.modifiers & Qt.ControlModifier)) {
        event.accepted = true
        self.send()
      }
    } else {
      if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && !(event.modifiers & Qt.ShiftModifier)) {
        event.accepted = true
        self.send()
      }
    }
  }

  function _selectSlash(cmd) {
    if (!cmd) return
    var self = root
    self.content = "/" + cmd.name + " "
    self.slashOpen = false
    self.slashFilter = ""
    self.slashIndex = 0
  }

  function _selectMention(file) {
    if (!file) return
    var self = root
    var display = file.relativePath
    // Track for resolution at send time.
    var exists = false
    for (var i = 0; i < self.resolvedMentions.length; i++) {
      if (self.resolvedMentions[i].display === display) { exists = true; break }
    }
    if (!exists) {
      var next = self.resolvedMentions.slice()
      next.push({ display: display, name: file.name, path: file.path })
      self.resolvedMentions = next
    }
    self.content = self.content + (self.content.length > 0 && !self.content.endsWith(" ") && !self.content.endsWith("\n") ? " " : "") + "@" + display
    self.mentionOpen = false
    self.mentionFilter = ""
    self.mentionIndex = 0
  }

  function _onChange(value) {
    var self = root
    self.content = value
    // Detect / and @ at position 0 of the current word.
    var lastWord = ""
    for (var i = value.length - 1; i >= 0; i--) {
      var ch = value[i]
      if (ch === " " || ch === "\n") break
      lastWord = ch + lastWord
    }
    // Mention: a word containing @ starting with @ triggers mention popup.
    var atIdx = lastWord.indexOf("@")
    if (atIdx === 0 && self._cwd) {
      self.mentionOpen = true
      self.mentionFilter = lastWord.slice(1)
      self.mentionIndex = 0
      self._loadFiles()
    } else {
      self.mentionOpen = false
    }
    // Slash: word starting with / at the start of content or after space.
    if (lastWord.charAt(0) === "/" && (atIdx < 0)) {
      var slashIdx = -1
      for (var j = value.length - lastWord.length - 1; j >= 0; j--) {
        var cj = value[j]
        if (cj === " " || cj === "\n") { slashIdx = j; break }
        if (cj !== "/") { slashIdx = -2; break }
      }
      if (slashIdx === -1 || (value.length - lastWord.length === 0)) {
        self.slashOpen = true
        self.slashFilter = lastWord.slice(1)
        self.slashIndex = 0
        self._loadCommands()
      } else {
        self.slashOpen = false
      }
    } else {
      self.slashOpen = false
    }
  }

  // External text (voice) lands here. The integration owner calls this via
  // a function reference exposed on ChatView (root.chatInput.appendExternalText).
  function appendExternalText(text) {
    if (!text) return
    var self = root
    var separator = (self.content.length > 0
      && !self.content.endsWith(" ")
      && !self.content.endsWith("\n")) ? " " : ""
    self.content = self.content + separator + text
  }

  // ---- scrims + popups ----
  //
  // The scrim is a transparent MouseArea that fills the chat surface and
  // sits BEHIND the popup (z: -1). It catches clicks anywhere outside
  // the popup and dismisses it. The popup itself is a BorderSurface that
  // is anchored above the textarea, inside the chat surface.

  // Scrim behind the slash-command popup.
  MouseArea {
    visible: root.slashOpen
    anchors.fill: parent
    z: -1
    enabled: visible
    onClicked: root.slashOpen = false
  }

  // Slash command list.
  BorderSurface {
    id: slashPopup
    visible: root.slashOpen
    z: 1
    width: 280
    color: Color.popups.background
    borderSpec: Border.flat(Color.popups.border, 1)
    radius: Style.cornerRadius
    height: {
      var cmds = root.slashCommands.filter(function (c) {
        return !root.slashFilter || c.name.indexOf(root.slashFilter) >= 0
      })
      return Math.min(240, cmds.length * Style.bar.sizeVertical + 2 * Style.spacing.sm)
    }
    anchors {
      bottom: inputBox.top
      left: inputBox.left
      bottomMargin: Style.spacing.xs
    }
    Repeater {
      model: root.slashOpen
        ? root.slashCommands.filter(function (c) {
            return !root.slashFilter || c.name.indexOf(root.slashFilter) >= 0
          })
        : []
      delegate: Item {
        id: slashRow
        required property var modelData
        required property int index
        anchors { left: slashRow.parent ? slashRow.parent.left : undefined; right: slashRow.parent ? slashRow.parent.right : undefined }
        height: Style.bar.sizeVertical
        Text {
          anchors { left: parent.left; verticalCenter: parent.verticalCenter; margins: Style.spacing.sm }
          text: "/" + slashRow.modelData.name
            + (slashRow.modelData.description ? " — " + slashRow.modelData.description : "")
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          color: slashRow.index === root.slashIndex ? Color.accent : Color.foreground
        }
        MouseArea {
          anchors.fill: parent
          onClicked: root._selectSlash(slashRow.modelData)
        }
      }
    }
  }

  // Scrim behind the @-mention popup.
  MouseArea {
    visible: root.mentionOpen
    anchors.fill: parent
    z: -1
    enabled: visible
    onClicked: root.mentionOpen = false
  }

  // @-file mention list.
  BorderSurface {
    id: mentionPopup
    visible: root.mentionOpen
    z: 1
    width: 360
    color: Color.popups.background
    borderSpec: Border.flat(Color.popups.border, 1)
    radius: Style.cornerRadius
    height: {
      var files = root.mentionFiles.filter(function (f) {
        return !root.mentionFilter || f.relativePath.indexOf(root.mentionFilter) >= 0
      })
      return Math.min(280, files.length * Style.bar.sizeVertical + 2 * Style.spacing.sm)
    }
    anchors {
      bottom: inputBox.top
      left: inputBox.left
      bottomMargin: Style.spacing.xs
    }
    Repeater {
      model: root.mentionOpen
        ? root.mentionFiles.filter(function (f) {
            return !root.mentionFilter || f.relativePath.indexOf(root.mentionFilter) >= 0
          })
        : []
      delegate: Item {
        id: mentionRow
        required property var modelData
        required property int index
        anchors { left: mentionRow.parent ? mentionRow.parent.left : undefined; right: mentionRow.parent ? mentionRow.parent.right : undefined }
        height: Style.bar.sizeVertical
        Text {
          anchors { left: parent.left; verticalCenter: parent.verticalCenter; margins: Style.spacing.sm }
          text: mentionRow.modelData.relativePath
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          color: mentionRow.index === root.mentionIndex ? Color.accent : Color.foreground
        }
        MouseArea {
          anchors.fill: parent
          onClicked: root._selectMention(mentionRow.modelData)
        }
      }
    }
  }

  // ---- input box ----

  Rectangle {
    id: inputBox
    anchors { left: root.left; right: root.right }
    color: Color.background
    border { width: Style.normalBorderWidth; color: Color.muted }
    radius: Style.cornerRadius

    implicitHeight: inputLayout.implicitHeight + 2 * Style.spacing.md

    Column {
      id: inputLayout
      anchors {
        left: parent.left
        right: parent.right
        top: parent.top
        margins: Style.spacing.md
      }
      spacing: Style.spacing.xs

      // Pending-attachment chips, ABOVE the textarea. Hidden when empty:
      // a Column gives its invisible children zero height, so the chips
      // row costs nothing when nothing is queued. This MUST live inside
      // `inputLayout` (not next to it) — `inputBox.implicitHeight` is
      // derived from `inputLayout.implicitHeight`, and any sibling added
      // beside the Column would not contribute.
      //
      // Row (not RowLayout) — the chips just sit side-by-side; each chip
      // owns its own width via implicitWidth. Long file names are ellipsised
      // inside the chip, not pushing siblings off the right edge.
      Row {
        id: attachmentChips
        anchors { left: parent.left; right: parent.right }
        visible: root.attachments.length > 0
        spacing: Style.spacing.xs
        Repeater {
          model: root.attachments
          delegate: BorderSurface {
            id: chip
            required property var modelData
            required property int index
            // Chip body height matches the bottom row.
            implicitHeight: Style.bar.sizeVertical
            // Width fits the label + × button. A fixed cap (180) stops a
            // single very long file name from stretching the chip past the
            // input box; the inner Text elides the middle so the extension
            // stays visible.
            implicitWidth: Math.min(240, chipRow.implicitWidth + 2 * Style.spacing.sm)
            color: Color.background
            borderSpec: Border.flat(Color.muted, 1)
            radius: Style.cornerRadius
            Row {
              id: chipRow
              anchors {
                left: parent.left
                right: parent.right
                verticalCenter: parent.verticalCenter
                leftMargin: Style.spacing.sm
                rightMargin: Style.spacing.xs
              }
              spacing: Style.spacing.xs
              Text {
                text: chip.modelData.name
                  + (chip.modelData.size > 0 ? "  ·  " + root._humanSize(chip.modelData.size) : "")
                elide: Text.ElideMiddle
                font.family: Style.font.family
                font.pixelSize: Style.font.caption
                color: Color.foreground
                verticalAlignment: Text.AlignVCenter
                width: Math.max(40, chip.width - 2 * Style.spacing.sm - removeButton.width - Style.spacing.xs)
              }
              // × button. Pressing it removes just this chip; send()
              // clears them all in one go.
              Button {
                id: removeButton
                text: "×"
                tooltipText: "Remove attachment"
                onClicked: root._removeAttachment(chip.index)
              }
            }
          }
        }
      }

      // Status + edit strip, ABOVE the composer. It used to share the bottom
      // row with the buttons; the composer is now a single line, so the strip
      // stands on its own — and a Column skips invisible children, so with no
      // edit in flight and nothing to report it costs zero height.
      RowLayout {
        anchors { left: parent.left; right: parent.right }
        spacing: Style.spacing.sm
        visible: root.editingMessageId > 0 || statusText.visible

        // Editing must be unmistakable: without it, Enter silently replaces
        // an older message instead of sending a new one, and the user has no
        // way to tell which is about to happen or to back out.
        Row {
          visible: root.editingMessageId > 0
          spacing: Style.spacing.sm
          Layout.alignment: Qt.AlignVCenter
          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "editing message"
            color: Color.accent
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
          Button {
            text: "Cancel"
            tooltipText: "Discard the edit and clear the composer"
            onClicked: root.cancelEdit()
          }
        }
        Text {
          id: statusText
          // Precedence, worst first: an ERROR outranks everything, because a
          // message that went nowhere is the only state the user cannot infer
          // from the screen. Then dictation (the mic is hot and they need to
          // know), then the turn in flight.
          //
          // Two error sources share this row on purpose. Both answer the same
          // question — "why did nothing happen?" — and both used to answer it
          // nowhere: `voiceStore.error` was set and never read, and
          // `store.error` had no renderer at all, so a send with no
          // conversation selected discarded the text in silence.
          // A dropped connection outranks the rest, because it invalidates
          // everything the user is about to do — Send will queue or fail, and
          // the header's small "connecting…" chip is easy to miss mid-turn.
          // The Electron front put this in the chat body for the same reason
          // (`ChatReconnectingBanner`, src/renderer/pages/ChatView.tsx:376).
          readonly property bool offline: !!(root.store && root.store.rpc
                                             && root.store.rpc.connected === false)

          readonly property string problem: {
            if (offline) return "disconnected — reconnecting; your work is saved"
            if (root.store && root.store.error && root.store.error.length > 0)
              return root.store.error
            if (root.voiceStore && root.voiceStore.error && root.voiceStore.error.length > 0)
              return "voix : " + root.voiceStore.error
            return ""
          }
          visible: problem.length > 0
                  || (root.voiceStore
                      && (root.voiceStore.recording || root.voiceStore.transcribing))
                  || (root.store && root.store.streaming)
          text: {
            if (problem.length > 0) return problem
            if (root.voiceStore && root.voiceStore.recording) return "listening…"
            if (root.voiceStore && root.voiceStore.transcribing) return "transcribing…"
            if (root.store && root.store.queue && root.store.queue.length > 0)
              return "queued: " + root.store.queue.length
            return "streaming…"
          }
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          color: problem.length > 0 ? Color.urgent : Color.muted
          opacity: 0.7
          Layout.alignment: Qt.AlignVCenter
        }

        Item { Layout.fillWidth: true }
      }

      // The composer: the textarea and the + / mic / Send buttons on ONE
      // line, like the Electron front (MessageInput.tsx:428 — `flex
      // items-end`). The textarea takes all remaining width and the row
      // grows with the draft; the buttons bottom-align so they don't drift
      // as the draft wraps. The status / edit strip lives above (see there).
      //
      // A RowLayout, not a Row: the textarea needs `Layout.fillWidth` to
      // stretch, and a `Row` child may not use a horizontal anchor at all —
      // `anchors.right: parent.right` on a button once made Qt disable the
      // Row outright ("Row will not function"), which a QML test surfaced.
      // Attach lives left of mic by request: the order is "attach, then
      // dictate, then send" — the most destructive action sits at the far
      // right, where a stray click is least likely to hit it.
      RowLayout {
        anchors { left: parent.left; right: parent.right }
        spacing: Style.spacing.sm

        TextArea {
          id: inputArea
          Layout.fillWidth: true
          // Declarative focus, matching the shell's own layer-surface pattern
          // (plugins/menu/Menu.qml keyCatcher). An imperative
          // forceActiveFocus() after map is refused on a layer surface — Qt
          // never marks the window active — so the caret only ever landed when
          // the user clicked. `focus: true` claims focus inside the window's
          // root focus scope instead, which is what actually sticks.
          focus: true
          placeholderText: root.disabled
            ? "Sign in to start chatting..."
            : "Message the agent… (@ to mention files, / for commands)"
          text: root.content
          onTextChanged: if (text !== root.content) root._onChange(text)
          Keys.onPressed: function (event) { root._onKey(event) }
          wrapMode: TextArea.Wrap
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          color: Color.foreground
        }

        // Attach affordance — a small button left of the mic. Pressing
        // it emits `attachRequested`; the parent (App.qml) opens the
        // FileDialog and pushes each picked file back through
        // `addAttachment()`. ChatInput is a leaf and CANNOT import
        // Qt.labs.platform to open the dialog itself (CONTRACTS.md §2).
        Button {
          Layout.alignment: Qt.AlignBottom
          Layout.preferredWidth: Style.bar.sizeHorizontal
          text: "+"
          tooltipText: "Attach a file or image"
          enabled: !root.disabled
          onClicked: root.attachRequested()
        }

        // Voice capture affordance — only when the parent actually wired a
        // VoiceStore. MicButton already does the right thing in both modes
        // (press-and-hold on the mouse, toggle from the keyboard shortcut);
        // ChatInput never decides between them.
        MicButton {
          Layout.alignment: Qt.AlignBottom
          visible: !!root.voiceStore
          store: root.voiceStore
        }
        Rectangle {
          Layout.alignment: Qt.AlignBottom
          // implicitWidth/Height, not width/height: a RowLayout owns its
          // children's geometry and overwriting it is undefined behaviour.
          implicitWidth: sendLabel.implicitWidth + 2 * Style.spacing.md
          implicitHeight: Style.bar.sizeVertical
          radius: Style.cornerRadius
          color: root.disabled ? Color.muted : Color.accent
          Text {
            id: sendLabel
            anchors.centerIn: parent
            text: root.store && root.store.streaming ? "Queue" : "Send"
            color: Color.background
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
            font.weight: Font.Medium
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            enabled: !root.disabled
            onClicked: root.send()
          }
        }
      }
    }
  }

}
