# Glitch - Maintainer Handoff

## Product intent

Glitch is a local-first Windows desktop agent with a robotic owl companion. It helps a single user work on trusted local projects and perform approved computer tasks through a chat interface. A local Ollama model is the worker; an optional cloud model audits its progress. The product must be usable by double-clicking a packaged executable, without npm or terminal setup.

The supported application is **`glitch/`**, not the retained React/Vite or Electron prototypes. Consumer documentation must describe implemented desktop behavior, not prototype features or planned capabilities.

## Current architecture

| Module | Responsibility |
| --- | --- |
| `main.py`, `launcher.py` | Windows startup, bundled WebView2 window, navigation guard, startup error reporting. |
| `desktop_runtime.py` | Guarded, idempotent cleanup for disposed WebView2 controls. |
| `api.py` | Narrow UI-to-Python bridge; no raw filesystem or shell exposure. |
| `engine.py` | Background worker loop, bounded steps, cancellation, approvals, verified evidence and anchors. |
| `models.py` | Ollama and OpenAI-compatible cloud HTTP clients. |
| `monitor.py` | Audits after configured steps, errors or repeated actions. |
| `storage.py` | SQLite conversations, events and corrections; Windows DPAPI credentials; safe environment import. |
| `tools.py` | Workspace-bounded file actions and fixed command recipes. |
| `computer.py` | Approval-gated desktop input, screenshots and isolated Chrome CDP. |
| `discord_bot.py` | Async owner/channel-restricted control and remote approvals. |
| `ui/` | Offline bundled dashboard and owl asset. |
| `tests/` | Runtime, transport, safety, startup and lifecycle regressions; desktop/Chrome smoke checks. |

Data belongs under `%LOCALAPPDATA%\Glitch`, never the temporary executable extraction directory. Native desktop control requires an awake, unlocked Windows session. Chrome uses an isolated profile and loopback port 9222.

## Invariants

- Require explicit approval for writes, command execution, browser/desktop actions and screenshots.
- Supervisor advice must never grant privileges or bypass approval.
- Reject workspace traversal, protected credential paths, arbitrary shell strings and stale approvals.
- Preserve complete conversation context, verified tool evidence and persistent correction anchors across turns.
- Owner and channel authorization applies to Discord messages and approval buttons.
- Never return tokens through the UI bridge or put them in logs/model instructions.
- Do not present supervision, redaction, or recipe allowlists as an OS sandbox.
- Local-only means no cloud audits; it does not imply that configured remote endpoints or web tasks are offline.
- Keep the desktop bridge available only to the bundled trusted page.

## Release verification

Run the Python regression suite, build with `glitch/Glitch.spec`, then test the frozen UI and an ordinary startup/shutdown. Test with the real inherited environment, including Ollama wildcard bind settings. Exercise the disposed-WebView close case to catch framework lifecycle exceptions.

Desktop smoke tests use a local HTTP model fixture and actual WebView2. Simulated Discord tests do not establish live account integration. Label fixture-based, real transport and live credential verification separately.

Build on Windows with Python 3.12. End users need neither Python nor Node.js. Unsigned builds may trigger SmartScreen; sign release binaries when a signing identity is available.

## Retained prototypes

`src/`, `runtime/`, `self-edit/`, `server/`, `desktop/` and the Node package files belong to earlier experiments. They are not loaded by the executable. See [legacy development](docs/legacy-development.md) before using them. Browser storage and credential derivation identities are deliberately preserved for compatibility; rebranding must not silently erase existing data.

## Primary references

- [User-facing purpose and capabilities](README.md)
- [First-run guide](<START HERE - How to run Glitch.md>)
- [Detailed setup, privacy and packaging](glitch/README.md)
- [Repository](https://github.com/gr00t-iam/Glitch)
