# Glitch 1.0.0 for Windows x64

A standalone Python/PyWebView desktop agent with a robotic owl companion. No npm, Node.js or Python installation is required to run the executable.

- Local Ollama worker and conditional OpenAI-compatible cloud supervision.
- Persistent conversations, verified tool evidence and correction anchors.
- Workspace selection, live execution timeline, approved file diffs and streamed command output.
- Windows-encrypted credentials and owner-locked private-channel/DM Discord control.
- Discord task updates, approval buttons and approved screenshot attachments.
- Approved native mouse/keyboard input, screenshots, and isolated Chrome control on localhost port 9222.
- Fixed command recipes, traversal checks, cancellation, approval expiration and desktop input fail-safe.

## Download and launch

Download `Glitch.exe`, then double-click it. Install the Ollama Windows app and a downloaded model. Microsoft Edge WebView2 Runtime is required; Chrome is required for browser automation. Open Settings to configure the worker, optional cloud supervisor and Discord bot.

The complete setup and build instructions are in `glitch/README.md`. `glitch/Glitch.spec` is the exact one-file PyInstaller specification. Windows builds are unsigned and may trigger SmartScreen.

## Verification

18 regression tests passed locally, including persistent memory, DPAPI encryption, denial/cancellation gates, path boundaries, actual PowerShell output, HTTP provider transport and simulated Discord owner-only execution with approvals.

The packaged executable passed a real WebView2 smoke test covering initialization, settings, external navigation blocking, a blocked/approved write, persistent tool evidence and layout bounds. Real Chrome navigation, CSS input/clicks, text retrieval and screenshots passed against an isolated local test page.

Live Ollama, paid cloud and authenticated Discord account behavior require user configuration and were not exercised with live credentials. The HTTP worker and Discord task tests use fixtures. Native input is approval-gated; automated tests do not type into unrelated applications.
