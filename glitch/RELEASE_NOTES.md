# Glitch 1.0.1 for Windows x64

## Startup repair

Fixes the executable failing before the dashboard opens when Windows has `OLLAMA_HOST=0.0.0.0`.

- Converts bare host names, host/port pairs and IPv6 addresses into valid client URLs.
- Converts wildcard bind addresses into reachable loopback addresses without changing your environment.
- Keeps the app available when optional environment settings are invalid, with a safe in-app warning.
- Preserves saved settings, conversations and encrypted credentials.
- Removes misleading WebView2 advice from unrelated startup errors.
- Adds environment-import coverage to the frozen desktop test and three startup regression tests.
- Fixes the .NET `BrowserProcessId` exception when closing an already-disposed WebView2 control; cleanup is guarded and idempotent.

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

24 regression tests cover startup settings, WebView2 shutdown, persistent memory, DPAPI encryption, denial/cancellation gates, path boundaries, actual PowerShell output, HTTP provider transport and simulated Discord owner-only execution with approvals.

The desktop smoke test now imports the machine environment before initializing the real WebView2 UI, testing settings, external navigation blocking, a blocked/approved write, persistent tool evidence and layout bounds. The previous version's Chrome navigation, CSS input/clicks, text retrieval and screenshots were tested against an isolated local test page.

Live Ollama, paid cloud and authenticated Discord account behavior require user configuration and were not exercised with live credentials. The HTTP worker and Discord task tests use fixtures. Native input is approval-gated; automated tests do not type into unrelated applications.
