# Glitch for Windows

Glitch is a standalone Python desktop agent with a robotic owl companion, local Ollama reasoning, optional cloud supervision, approved computer control, and one-owner Discord access. The UI is bundled HTML/CSS/JavaScript displayed by PyWebView and Microsoft Edge WebView2. There is no Node.js or npm dependency in this application or its build.

## Launch the application

1. Download `Glitch.exe` from the NexusHarness GitHub release or the **Glitch Windows** workflow artifact. Extract the artifact ZIP if using Actions.
2. Install Microsoft Edge WebView2 Evergreen Runtime if Windows does not already have it. Windows 10/11 x64 and .NET Framework 4.8 are required by the native wrapper.
3. Install and open the Ollama Windows application, then download a local model in Ollama. Choose a vision-capable model for screenshot-based desktop navigation.
4. Double-click `Glitch.exe`. No Python, npm, or terminal is required to run the packaged app.
5. Click **+** next to **Projects** and select a trusted project folder. Open **Settings & connections**, check the Ollama endpoint, click **Find local models**, choose a downloaded model, and save.
6. Send a task. Inspect the execution timeline and approve the exact file diff, command, or computer action when prompted.

The executable contains the app and its Python runtime. Model weights, Ollama, Chrome, and project-specific compilers/interpreters are separate installations. `python_tests`, Git and .NET recipes require their corresponding tools on the host. Glitch does not install them or impersonate a successful execution if they are missing.

## Hybrid supervisor

Select **Hybrid** in Settings, enter an OpenRouter or OpenAI-compatible API endpoint, its model ID, and an API key. The default endpoint is `https://openrouter.ai/api/v1`; choose a model available to your account.

The worker stays local. Glitch sends a bounded audit to the cloud after every five tool actions (configurable), a tool failure, invalid worker output, or three repeated identical actions. The audit contains the task and at most the last 15 redacted action records, including snippets of file contents or command output. Screenshots and complete conversation history are excluded from cloud audits. Redaction reduces accidental credential disclosure but cannot identify every custom secret; use local-only mode for confidential projects.

Cloud directives are saved in SQLite and re-injected into the local worker's system instruction before every subsequent step and future turn in that conversation. Conversation history and verified tool evidence survive restarts. Local-only mode makes no supervisor requests. Cloud failures pause the task visibly rather than silently skipping the audit. Six repeated identical actions stop the loop even if cloud guidance fails to resolve it.

## Discord setup

1. Create an application and bot in the Discord Developer Portal. Enable **Message Content Intent** for the bot.
2. Invite the bot to a private server channel with **View Channel**, **Send Messages**, **Read Message History**, and **Attach Files** permissions. Deny `@everyone` permission to view the channel. Do not grant Administrator.
3. Enable Discord Developer Mode and copy your **User ID** and the private **Channel ID**.
4. Enter the bot token, your User ID and Channel ID in Glitch's **Discord control** settings. Save, then **Connect Discord**. Leave Channel ID blank to allow direct messages from your User ID only.
5. Send `!task <instructions>`, `!status`, or `!stop`. Remote tasks use the project of the most recently created conversation. Choose it in the app before leaving.
6. Approve actions with Discord's **Approve Action** button or deny them with **Abort & Rewrite**. The owner and channel are checked again on every button interaction. Approvals expire after five minutes and cannot be reused. The desktop app can approve the same pending action; stale Discord buttons cannot execute it again.

The listener reconnects through Discord's gateway. Status, tool actions, correction directives, command output, final text and approved screenshots are batched back to the authorized channel. Unauthorized messages are ignored. If sending task updates fails, Glitch stops the remote task. Disconnecting Discord stops its active remote task. Changing saved Discord identity or token disconnects the listener so the old identity cannot remain active.

Glitch must stay open; Windows must remain awake and the desktop unlocked for computer control. This is a desktop app, not a Windows service. Do not use a personal Discord account token.

## Computer use and execution policy

- `list_workspace`, `read_file`, `write_file`: project files only. Resolved paths cannot escape the selected workspace. `.git`, `.env*`, private keys, known credential directories and Glitch's database are protected. Writes require approval, display a diff, detect edits made while waiting for approval, and replace files atomically.
- `run_command`: approved fixed recipes (`git_status`, `git_diff`, `git_log`, `python_tests`, `dotnet_build`, `list_directory`). Uses subprocess argument arrays with `shell=False`; command strings from the model are never passed to a shell. Output streams into the timeline and Discord, is bounded, and commands time out after 120 seconds. Stop terminates the subprocess tree on Windows. Project tests/builds can execute project code; approve them only for trusted workspaces.
- `desktop_screenshot`, `desktop_input`: approved primary-screen capture, move, click, typing, individual keys, hotkeys (e.g. `ctrl+shift+s`) and scrolling. Screenshots include native dimensions and are attached to the next Ollama request. Move the mouse to a screen corner for PyAutoGUI's fail-safe. Unicode typing temporarily uses and restores the clipboard; browser field entry supports Unicode directly. Browser tab IDs are returned by `tabs` and accepted as `tab_id` on subsequent actions.
- `browser_action`: approved Chrome navigation, tab listing, visible text, CSS selector clicks/fills and screenshots. Chrome uses `%LOCALAPPDATA%\Glitch\chrome-profile` and port **9222**, bound to **127.0.0.1**. An existing unrelated debugging session is rejected. No remote Chrome port is published. Install Google Chrome first.

Native desktop automation requires the same privilege level as the target window. Glitch does not elevate itself, defeat Windows security prompts, or bypass approval through cloud advice. Shell recipes are a policy boundary, not an OS sandbox. Chrome runs as a separate controlled browser window; approved screenshots appear inside Glitch's timeline. Other installed tabs and browser profiles are untouched.

Every screenshot requires approval, including explicit notice that remote task captures are shared to Discord. Captures stay in `%LOCALAPPDATA%\Glitch\captures`; remove unwanted captures in File Explorer. Ollama must support images for visual reasoning; text-only models still work with file and browser-text tools.

## Optional environment variables

Settings provide the normal setup path; these variables are only needed for managed deployments.

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Bot token; takes precedence over the Windows-encrypted saved token. |
| `DISCORD_USER_ID` | Sole authorized user, imported into settings at startup. |
| `DISCORD_CHANNEL_ID` | Optional private server channel; blank restricts control to owner DMs. |
| `OLLAMA_HOST` | Ollama host or HTTP(S) base URL, e.g. `localhost:11434`. Wildcard server bind addresses such as `0.0.0.0` automatically connect through loopback on port 11434. Invalid optional overrides are ignored with an in-app warning; saved settings remain available. |
| `CLOUD_SUPERVISOR_API_KEY` | OpenAI-compatible cloud key; takes precedence over the saved key. |

Keys are never returned from the Python bridge, saved as plaintext settings, or inserted into model instructions. Saved credentials are encrypted using Windows DPAPI for the current Windows user. Environment-provided keys remain active until removed from the environment; clearing a saved key cannot remove an environment override. Settings and chat data live in `%LOCALAPPDATA%\Glitch`, outside the executable extraction directory.

## Build from source on Windows

Only developers building the executable need Python. Install **Python 3.12 x64** with the `py` launcher, then double-click **Build Glitch.cmd** in the repository root. It creates an isolated environment, installs Python dependencies, runs the tests, and builds `dist\Glitch.exe`.

Equivalent exact commands, run from the repository root:

```powershell
py -3.12 -m venv .venv-glitch
.\.venv-glitch\Scripts\python.exe -m pip install -r glitch\requirements-lock.txt
.\.venv-glitch\Scripts\python.exe -m unittest discover -s glitch\tests -v
.\.venv-glitch\Scripts\python.exe -m PyInstaller --noconfirm --clean glitch\Glitch.spec
```

The checked-in spec creates a single windowed executable containing the Python runtime, native wrapper dependencies, Discord client, computer tools and all UI assets. Build Windows binaries on Windows. A GitHub Actions Windows runner performs the same tests and build and publishes a downloadable artifact for each change.

`requirements-lock.txt` pins the complete tested Windows build environment; `requirements.txt` lists the direct dependencies. The old `Start NexusHarness.cmd` now launches the compiled Glitch app and never invokes npm or a development server.

For source development only:

```powershell
.\.venv-glitch\Scripts\python.exe -m glitch.main
```

Unsigned builds may show Windows SmartScreen warnings. Production distribution should sign the finished executable with your organization's code-signing certificate; no signing identity or certificate is included in this repository.

## Structure

```text
glitch/
  main.py              Native window, startup and shutdown
  launcher.py          PyInstaller entry point
  api.py               Narrow UI-to-Python bridge
  storage.py           SQLite persistence and Windows DPAPI
  models.py            Ollama worker and cloud supervisor HTTP clients
  monitor.py           Step, error and repeated-action triggers
  engine.py            Agent loop, approvals and persistent anchors
  tools.py             Approved file and fixed command tools
  computer.py          Desktop input, screenshots and Chrome CDP
  discord_bot.py       Owner-locked async gateway and remote approvals
  ui/                  Offline HTML, CSS, JavaScript and owl mascot
  tests/               Runtime, transport and security regressions
  requirements.txt     Python dependencies
  Glitch.spec          One-file Windows build
Build Glitch.cmd        Double-click source build helper
```

The previous NexusHarness PWA and Electron sources remain available for migration reference. They are not loaded by `Glitch.exe`.

Implementation references: [PyWebView native bridge](https://pywebview.flowrl.com/guide/usage.html), [PyInstaller spec files](https://pyinstaller.org/en/stable/spec-files.html), [Discord gateway intents](https://discordpy.readthedocs.io/en/stable/intents.html), [PyAutoGUI fail-safe behavior](https://pyautogui.readthedocs.io/en/latest/index.html), and [Chrome's isolated debugging profile requirement](https://developer.chrome.com/blog/remote-debugging-port).
