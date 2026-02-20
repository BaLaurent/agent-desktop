#!/usr/bin/env python3
"""
Jupyter kernel bridge — JSON Lines protocol over stdin/stdout.

Spawns a Jupyter kernel via jupyter_client and relays execution
messages between the parent Node.js process and the kernel.

Protocol:
  stdin  (requests):  {"id":"r1","action":"execute","code":"..."}
  stdout (responses): {"id":"r1","type":"stream","name":"stdout","text":"..."}
                      {"id":"r1","type":"status","state":"idle"}

Kernel name: JUPYTER_KERNEL_NAME env var (default: python3)
"""

import json
import os
import sys
import threading

def main():
    kernel_name = os.environ.get("JUPYTER_KERNEL_NAME", "python3")

    try:
        from jupyter_client import KernelManager
    except ImportError:
        emit({"type": "error", "ename": "ImportError",
              "evalue": "jupyter_client not installed. Run: pip install jupyter ipykernel",
              "traceback": []})
        sys.exit(1)

    # Verify ipykernel is installed (provides the actual python3 kernel)
    try:
        import ipykernel  # noqa: F401
    except ImportError:
        emit({"type": "error", "ename": "ImportError",
              "evalue": "ipykernel not installed. Run: pip install ipykernel",
              "traceback": []})
        sys.exit(1)

    km = KernelManager(kernel_name=kernel_name)
    try:
        km.start_kernel()
    except Exception as e:
        emit({"type": "error", "ename": type(e).__name__,
              "evalue": str(e), "traceback": []})
        sys.exit(1)

    kc = km.client()
    kc.start_channels()
    try:
        kc.wait_for_ready(timeout=30)
    except RuntimeError as e:
        emit({"type": "error", "ename": "KernelTimeout",
              "evalue": str(e), "traceback": []})
        km.shutdown_kernel(now=True)
        sys.exit(1)

    # Announce readiness
    info = kc.kernel_info()
    language = "python"
    try:
        reply = kc.get_shell_msg(timeout=10)
        language = reply.get("content", {}).get("language_info", {}).get("name", "python")
    except Exception:
        pass
    emit({"type": "ready", "language": language})

    # IOPub listener thread — relays kernel output to stdout
    stop_event = threading.Event()
    iopub_thread = threading.Thread(
        target=iopub_listener, args=(kc, stop_event), daemon=True
    )
    iopub_thread.start()

    # Main loop — read JSON lines from stdin
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError:
                continue

            req_id = req.get("id")
            action = req.get("action")

            if action == "execute":
                code = req.get("code", "")
                msg_id = kc.execute(code)
                # Store mapping so iopub_listener can tag outputs with req_id
                register_msg(msg_id, req_id)

            elif action == "interrupt":
                try:
                    km.interrupt_kernel()
                except Exception as e:
                    emit({"id": req_id, "type": "error",
                          "ename": "InterruptError", "evalue": str(e),
                          "traceback": []})

            elif action == "restart":
                try:
                    km.restart_kernel(now=True)
                    kc.wait_for_ready(timeout=30)
                    emit({"id": req_id, "type": "status", "state": "restarted"})
                except Exception as e:
                    emit({"id": req_id, "type": "error",
                          "ename": "RestartError", "evalue": str(e),
                          "traceback": []})

            elif action == "shutdown":
                break

    except (EOFError, KeyboardInterrupt):
        pass
    finally:
        stop_event.set()
        try:
            kc.stop_channels()
            km.shutdown_kernel(now=True)
        except Exception:
            pass


# ── Message ID mapping ────────────────────────────────

_msg_map_lock = threading.Lock()
_msg_map = {}  # kernel msg_id -> request id

def register_msg(msg_id, req_id):
    with _msg_map_lock:
        _msg_map[msg_id] = req_id

def get_req_id(msg):
    """Resolve request id from a kernel message's parent header."""
    parent_id = msg.get("parent_header", {}).get("msg_id")
    if parent_id:
        with _msg_map_lock:
            return _msg_map.get(parent_id)
    return None


# ── IOPub listener ────────────────────────────────────

def iopub_listener(kc, stop_event):
    """Listen for kernel IOPub messages and relay to stdout as JSON lines."""
    while not stop_event.is_set():
        try:
            msg = kc.get_iopub_msg(timeout=0.5)
        except Exception:
            continue

        msg_type = msg.get("msg_type", "")
        content = msg.get("content", {})
        req_id = get_req_id(msg)

        if msg_type == "stream":
            emit({
                "id": req_id,
                "type": "stream",
                "name": content.get("name", "stdout"),
                "text": content.get("text", ""),
            })

        elif msg_type in ("execute_result", "display_data"):
            data = content.get("data", {})
            # Convert any list values to strings
            flat_data = {}
            for k, v in data.items():
                flat_data[k] = "".join(v) if isinstance(v, list) else v
            out = {
                "id": req_id,
                "type": msg_type,
                "data": flat_data,
            }
            if msg_type == "execute_result":
                out["execution_count"] = content.get("execution_count")
            emit(out)

        elif msg_type == "error":
            emit({
                "id": req_id,
                "type": "error",
                "ename": content.get("ename", "Error"),
                "evalue": content.get("evalue", ""),
                "traceback": content.get("traceback", []),
            })

        elif msg_type == "status":
            state = content.get("execution_state", "")
            if state in ("idle", "busy"):
                emit({
                    "id": req_id,
                    "type": "status",
                    "state": state,
                })


# ── Output ────────────────────────────────────────────

_emit_lock = threading.Lock()

def emit(obj):
    """Write a JSON line to stdout (thread-safe)."""
    with _emit_lock:
        print(json.dumps(obj, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
