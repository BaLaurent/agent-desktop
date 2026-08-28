pragma ComponentBehavior: Bound

import QtQuick

// OpenSCAD compile / validate / export state.
//
// Channels used (verified against src/core/handlers/openscad.ts:7-27):
//   openscad:validateConfig()                       -> { binaryFound, binaryPath, version }
//   openscad:compile(scadFilePath)                  -> { data: base64 3mf, warnings }
//   openscad:exportStl(scadFilePath, outputPath)    -> outputPath (string)
//
// The pane (components/OpenScadPage.qml) picks the destination path
// itself via Qt.labs.platform FileDialog and hands it to exportStl —
// the handler takes an EXPLICIT destination, so there is no save-dialog
// dependency on Electron / QtWebEngine.
//
// No Quickshell imports.
QtObject {
  id: store

  required property var rpc

  // Validation result of the binary on PATH. Shape:
  //   { binaryFound: bool, binaryPath: string, version: string, error?: string }
  property var validationResult: ({ binaryFound: false, binaryPath: "", version: "" })
  property bool validating: false
  property string validationError: ""

  // Last compile result: { data: base64, warnings: string }.
  property var lastCompileResult: null
  property bool compiling: false
  property string compileError: ""

  // Last export: the destination path returned by openscad:exportStl.
  property string lastExportPath: ""
  property bool exporting: false
  property string exportError: ""

  // Active .scad file path. Owned by the page (it picks a file with a
  // FileDialog) but the store caches it so subsequent compiles don't
  // need it re-passed.
  property string scadPath: ""

  function load() {
    store.validate()
  }

  function validate() {
    store.validating = true
    store.validationError = ""
    store.rpc.invoke("openscad:validateConfig", [], function (result) {
      store.validating = false
      if (result && typeof result === "object") {
        store.validationResult = {
          binaryFound: result.binaryFound === true,
          binaryPath: (typeof result.binaryPath === "string") ? result.binaryPath : "",
          version: (typeof result.version === "string") ? result.version : ""
        }
      } else {
        store.validationResult = ({ binaryFound: false, binaryPath: "", version: "" })
      }
    }, function (err) {
      store.validating = false
      store.validationError = String(err)
    })
  }

  function setScadPath(path) {
    store.scadPath = String(path || "")
  }

  function compile(scadPath) {
    var fp = String(scadPath || store.scadPath || "")
    if (fp.length === 0) {
      store.compileError = "No .scad file selected"
      return
    }
    store.compiling = true
    store.compileError = ""
    store.rpc.invoke("openscad:compile", [fp], function (result) {
      store.compiling = false
      if (result && typeof result === "object") {
        store.lastCompileResult = {
          data: (typeof result.data === "string") ? result.data : "",
          warnings: (typeof result.warnings === "string") ? result.warnings : ""
        }
      } else {
        store.lastCompileResult = null
        store.compileError = "Compile returned no result"
      }
    }, function (err) {
      store.compiling = false
      store.compileError = String(err)
    })
  }

  function exportStl(scadPath, outputPath) {
    var fp = String(scadPath || store.scadPath || "")
    var op = String(outputPath || "")
    if (fp.length === 0) {
      store.exportError = "No .scad file selected"
      return
    }
    if (op.length === 0) {
      store.exportError = "No destination path chosen"
      return
    }
    store.exporting = true
    store.exportError = ""
    store.rpc.invoke("openscad:exportStl", [fp, op], function (returned) {
      store.exporting = false
      store.lastExportPath = (typeof returned === "string") ? returned : op
    }, function (err) {
      store.exporting = false
      store.exportError = String(err)
    })
  }
}
