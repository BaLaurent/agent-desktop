.PHONY: test test-js test-qml qml-check compile-quickshell validate

test: test-js test-qml qml-check compile-quickshell

# lib/ and generated/ are QML JS resources — plain scripts with `.pragma library`
# and top-level var/function declarations. tests/load.js runs the exact file the
# shell loads in a vm context, so these tests need no compositor and hold no copy
# of the logic.
test-js:
	node tests/gen-stubs.js --check
	node tests/gen-component-load.js --check
	node tests/test_setting_defs.js
	node tests/test_stream_parts.js
	node tests/test_markdown.js
	node tests/test_highlight.js
	node tests/test_tool_summary.js
	node tests/test_notify.js
	node tests/test_diff.js
	node tests/test_surface.js
	node tests/test_border_spec.js
	node tests/test_stub_shape.js
	node tests/test_reachable.js
	node tests/test_channels.js
	node tests/test_setting_defs_sync.js
	node tests/test_store_init.js
	node tests/test_no_platform_dialogs.js
	node tests/test_schedule.js
	node tests/test_pi_ui.js
	node tests/test_notebook.js
	node tests/test_conversation_sort.js
	node tests/test_quick_chat.js
	node tests/test_settings_rows.js
	node tests/test_file_preview.js
	node tests/test_csv.js
	node tests/test_git_graph.js
	node tests/test_palette.js

# Window lifecycle, focus ownership and key routing cannot be tested without a
# QML engine. Offscreen, so no compositor: the bugs this catches — a window that
# never becomes visible, a payload that routes to the wrong surface, a Repeater
# that builds nothing — are invisible to any test that cannot instantiate one.
#
# tests/qml/tst_component_load.qml is the load-bearing one: it COMPILES every
# component the engine can see and asserts no error. That is the only gate that
# catches a syntax error or an assignment to a non-existent property, both of
# which qmllint reports as a mere warning and both of which make the shell refuse
# the file — and because components nest, one bad file silently takes out
# everything above it. Regenerate its path list when a component is added.
#
# Found rather than hard-coded: the binary is at /usr/lib/qt6/bin on Arch and on
# PATH as qmltestrunner6 on Debian and Ubuntu, and pinning one makes the suite
# unrunnable on the other.
QMLTESTRUNNER := $(shell command -v qmltestrunner6 2>/dev/null \
	|| ls /usr/lib/qt6/bin/qmltestrunner 2>/dev/null \
	|| command -v qmltestrunner 2>/dev/null)

test-qml:
	@test -n "$(QMLTESTRUNNER)" || { \
		echo "qmltestrunner not found: install Qt 6 QML test tooling" >&2; \
		echo "  Arch:   qt6-declarative" >&2; \
		echo "  Ubuntu: qt6-declarative-dev-tools qml6-module-qttest" >&2; \
		exit 1; }
	QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software \
		$(QMLTESTRUNNER) -import $(CURDIR)/tests/qml/imports -input tests/qml

# qmllint against the real qs.Commons / qs.Ui. See tests/qml-check.sh for why the
# import root is a symlink rather than the shell directory, and which warning
# classes are suppressed. This is the check that catches a binding to a Style
# token the shell does not have — the bug that made every Style.gapsIn and
# Style.bar.height binding in the old Overlay.qml silently evaluate to undefined.
qml-check:
	bash tests/qml-check.sh

# Compile the files the qmltestrunner gate CANNOT reach: those importing
# Quickshell, which is statically linked into the `quickshell` binary. That set
# includes App.qml — the panel entry point, hence the whole front end — which
# is how a duplicated root `Component.onCompleted` shipped and killed the UI
# while all 424 offscreen tests stayed green. Skips cleanly with no compositor.
compile-quickshell:
	bash tests/compile-quickshell.sh

validate: test
	omarchy plugin validate .
