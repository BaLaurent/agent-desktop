import QtQuick
import Quickshell

// Compile gate for the plugin files `tst_component_load.qml` cannot reach.
//
// Those files import Quickshell, which is statically linked into the
// `quickshell` binary, so `qmltestrunner` can never load them. That exclusion
// left App.qml — the panel entry point, and so the whole front end — with no
// compile check at all, and a duplicated root `Component.onCompleted` shipped:
// "Property value set multiple times", fatal, front end dead, every offscreen
// gate still green.
//
// This probe runs through the real binary, so it sees the real Quickshell, and
// it is the same engine that loads these files in production. Driven by
// tests/compile-quickshell.sh, which passes the plugin directory in
// AGENT_DESKTOP_DIR: Quickshell resolves relative component URLs against its
// own qrc root ("qrc:/qs-blackhole"), never the file's directory, so the paths
// have to be absolute.
ShellRoot {
  Component.onCompleted: {
    var dir = Quickshell.env("AGENT_DESKTOP_DIR") || ""
    if (dir === "") {
      console.log("COMPILE_FAIL <no AGENT_DESKTOP_DIR>")
      Qt.quit()
      return
    }
    var files = [
      "App.qml",
      "Service.qml",
      "BarWidget.qml",
      "components/FilePicker.qml",
      "components/FilesPane.qml",
      "components/FilePreview.qml"
    ]
    var failed = 0
    for (var i = 0; i < files.length; i++) {
      var url = "file://" + dir + "/" + files[i]
      var c = Qt.createComponent(url, Component.PreferSynchronous)
      if (c.status === Component.Ready) {
        console.log("COMPILE_OK " + files[i])
      } else {
        failed++
        console.log("COMPILE_FAIL " + files[i] + " :: " + c.errorString())
      }
    }
    console.log("COMPILE_DONE failed=" + failed)
    Qt.callLater(Qt.quit)
  }
}
