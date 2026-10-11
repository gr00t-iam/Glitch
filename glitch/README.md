# Glitch for Windows

A standalone Python/PyWebView agent with a robotic owl companion, embedded GGUF reasoning, optional cloud supervision, approval-gated computer control and owner-locked Discord access. The executable includes its Python runtime and llama.cpp CPU inference engine. No Ollama, LM Studio, Node.js, npm or Python installation is needed to run it.

## First launch

1. Download `Glitch.exe` from [the latest release](https://github.com/gr00t-iam/Glitch/releases/latest), or extract the Glitch Windows Actions artifact ZIP.
2. Use Windows 10/11 x64 with Microsoft Edge WebView2 Runtime and .NET Framework 4.8 installed. Install Chrome for browser tasks.
3. Double-click `Glitch.exe`. Use **Projects +** to select a trusted project folder.
4. Open **Settings & connections > Model Manager**. Paste a public Hugging Face GGUF file URL and click **Download model**, or **Import GGUF file** from your PC.
5. Select an instruction-tuned model that fits your RAM and click **Load model**. Wait for **Ready for local tasks**.
6. Send a task. Watch the timeline and approve exact file diffs, command recipes and computer actions before they execute.

Model weights are downloaded separately because of their size and licensing. Chrome, Windows WebView2 and project-specific compilers/interpreters are not bundled. Git, Python tests and .NET recipes require the corresponding tools on the host. Glitch never reports a missing tool as successfully executed.

## Built-in Model Manager

The library lives in `%LOCALAPPDATA%\Glitch\models`. Download/import jobs run in a background thread with byte progress, cancel controls and immediate error feedback. Use a public HTTPS Hugging Face file URL ending in `.gguf`, not a repository page, gated file, signed URL or split model part. Trusted Hugging Face CDN redirects are supported. Transfers above 128 GB are rejected; there is no 10 MB model cap.

Transfers check GGUF headers, expected length and optional publisher SHA256. Canceled, incomplete and checksum-mismatched files are deleted. Atomic publication keeps partial files out of the catalog. Import copies a local GGUF into the library. Refresh, select, load, unload and delete models inside the UI.

The portable build uses CPU inference, not automatic CUDA acceleration. Configure CPU threads, temperature and context before loading. Large contexts use more memory. Unsupported architectures or insufficient RAM produce a visible error. There is no hidden fallback to an external model server. Context overflow pauses rather than silently dropping conversation history or correction anchors.

Inference runs in a persistent isolated child process. Stop interrupts native inference by terminating that process; reload before continuing. Unload and shutdown release it. A model-process crash does not close the dashboard. This isolation protects stability, not the operating system: use trusted model publishers.

Screenshot reasoning requires a compatible **LLaVA 1.5 model and projector GGUF**, both selected in Model Manager. Other vision formats are not automatically supported. Text models cannot pretend to inspect screenshots; they can use browser DOM/text tools. Model quality still determines reasoning and visual accuracy.

## Hybrid supervision

In **Supervision**, choose **Hybrid**, then **Developer API** or **Subscription account - authorized local bridge**. Worker-only mode never needs a cloud key.

### Developer API

Choose OpenRouter, OpenAI, Anthropic or another compatible API. The UI supplies the base URL; configure a model available to your account and its API key. OpenAI-compatible providers use `/chat/completions` with Bearer authentication. Anthropic uses native `/messages`, `x-api-key` and the API version header. **Test connection** lists accessible models; it does not prove generation permission, available credits or unlimited access. Developer API billing is separate from consumer subscriptions.

### Authorized account bridge

Configure a provider-authorized bridge on your PC exposing `GET /v1/models` and `POST /v1/chat/completions`. Enter its loopback API URL, model, optional bridge access key and local sign-in page. **Open bridge sign-in** launches that page in your normal browser. Complete the provider's authorized flow there, then **Test connection** in Glitch.

The bridge owns OAuth, refresh tokens, plan entitlement and usage limits. Glitch stores only the optional bridge access key using Windows DPAPI. Only `127.0.0.1`, `::1` or `localhost` URLs are accepted, without embedded credentials, query strings or redirects. Keep that port private. The bridge must be configured separately; it is not bundled and Glitch does not provide a universal subscription proxy.

Glitch does not collect account passwords, cookies or consumer OAuth tokens, and does not impersonate official OAuth clients. ChatGPT subscription routing requires a supported, authorized integration: see [OpenAI sign-in documentation](https://developers.openai.com/siwc). A Plus plan alone does not make the general API free. [Anthropic's authentication rules](https://code.claude.com/docs/en/legal-and-compliance) prohibit third-party apps offering Claude.ai login or routing through Pro/Max credentials. Use an Anthropic developer API key instead. Unmodified native provider applications are a different integration and are not bundled here.

### Audit and memory contract

The supervisor is consulted after every five tool steps (configurable), a tool failure, invalid worker decision or three repeated identical actions. A bounded audit contains the task and up to 15 recent redacted action records, including file/output snippets. Full conversation history and screenshots are excluded. Redaction cannot recognize every custom secret; keep confidential projects in worker-only mode.

Course Correction Directives persist in SQLite and are injected into the local system instruction before every later step and future turn of that conversation. Conversation history and verified evidence survive restarts. Cloud failures pause visibly instead of skipping the audit. Six identical repeated actions stop the loop. Supervisor advice never approves an action or elevates privileges.

## Discord control

1. Create a bot in the Discord Developer Portal and enable **Message Content Intent**. Never use a personal account token.
2. Invite it to a private channel with **View Channel**, **Send Messages**, **Read Message History** and **Attach Files**. Deny `@everyone` access; do not grant Administrator.
3. Copy your User ID and private Channel ID in Discord Developer Mode.
4. Enter the bot token and IDs in **Discord control**, save and connect. Leaving Channel ID blank allows owner-only direct messages.
5. Use `!task <instructions>`, `!status` or `!stop`. Remote tasks use the most recently created conversation's project. Load the local model and select the project before leaving.
6. Use **Approve Action** or **Abort & Rewrite** on remote approval messages. Ownership/channel checks apply again to every button; approvals expire after five minutes and cannot be reused. The desktop UI can resolve the same pending approval.

The async gateway reconnects automatically. Status, tool actions, corrections, command output, final text and approved screenshots are batched back to the authorized channel. Unauthorized messages are ignored. Failed update delivery stops remote tasks. Disconnecting stops its active remote task; changing credentials/identity disconnects the old listener.

Glitch must remain open and Windows awake. Desktop control needs an unlocked session. This app is not a Windows service. Live account behavior requires your credentials and permissions.

## Computer use and safety

- `list_workspace`, `read_file`, `write_file`: resolved project paths only. Traversal, `.git`, `.env*`, private keys, known credential directories and Glitch's own data are protected. Writes show diffs, require approval, detect intervening edits and replace files atomically.
- `run_command`: fixed recipes (`git_status`, `git_diff`, `git_log`, `python_tests`, `dotnet_build`, `list_directory`) with argument arrays and `shell=False`. No model-generated shell strings. Output streams to the timeline and Discord, is bounded, and times out after 120 seconds. Stop terminates the Windows subprocess tree. Tests/builds execute project code: approve only trusted workspaces.
- `desktop_screenshot`, `desktop_input`: approved primary-screen screenshots, move, click, Unicode typing, keys, hotkeys and scrolling. Screenshots carry native dimensions to the local vision model. Unicode typing temporarily uses and restores the clipboard. Move the pointer to a screen corner to trigger PyAutoGUI's fail-safe.
- `browser_action`: approved navigation, tab listing, visible text, CSS-selector clicks/fills and screenshots. Returned tab IDs select pages. Chrome uses `%LOCALAPPDATA%\Glitch\chrome-profile`, loopback **127.0.0.1:9222** and a separate controlled window. An unrelated existing debugging session is rejected. Your regular browser profile and tabs are untouched.

Every screenshot requires approval and explicitly warns when a remote capture will be sent to Discord. Captures remain in `%LOCALAPPDATA%\Glitch\captures`; remove unwanted captures in File Explorer. Desktop control needs the same privilege level as the target window. Glitch does not defeat Windows prompts, automatically elevate or bypass approvals through supervisor advice. Recipe allowlists and process isolation are not an OS sandbox.

## Configuration and storage

Use Settings for normal setup. Optional managed-deployment variables:

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Bot token; overrides the encrypted saved token. |
| `DISCORD_USER_ID` | Sole authorized owner, imported at startup. |
| `DISCORD_CHANNEL_ID` | Optional private channel; blank allows owner-only DMs. |
| `CLOUD_SUPERVISOR_API_KEY` | Developer API key; overrides the saved API key and is never used by bridge mode. |

Older `OLLAMA_HOST` settings are retained only for migration compatibility, never used for inference. Replace old server-model names with GGUF library entries. Invalid optional overrides are ignored with an in-app warning, not a startup crash.

Saved API, bridge and Discord keys use Windows DPAPI for the current user. Keys are not returned by the native bridge or inserted into model prompts. Clearing a saved key cannot remove an environment override. Conversations, events and anchors use SQLite under `%LOCALAPPDATA%\Glitch`, outside the executable extraction directory. Back up this directory; encrypted secrets remain tied to your Windows identity.

## Build a single executable

Only developers need **Python 3.12 x64**. Double-click **Build Glitch.cmd**, or run these exact commands from the repository root:

```powershell
py -3.12 -m venv .venv-glitch
.\.venv-glitch\Scripts\python.exe -m pip install -r glitch\requirements-lock.txt
.\.venv-glitch\Scripts\python.exe -m unittest discover -s glitch\tests -v
.\.venv-glitch\Scripts\python.exe -m PyInstaller --noconfirm --clean glitch\Glitch.spec
```

Launch `dist\Glitch.exe`. The checked-in spec bundles Python, CPU native DLLs, NumPy, PyWebView, Discord, computer tools and offline UI assets into one windowed file. The lock uses the official llama-cpp-python CPU wheel index and requires a binary wheel, so a C++ compiler is unnecessary. Build Windows binaries on Windows. GitHub Actions runs tests and builds an artifact.

For source development, run `.\.venv-glitch\Scripts\python.exe -m glitch.main`. The optional **Start Glitch.cmd** only launches a compiled executable; it does not start npm or a development server. Unsigned builds may trigger SmartScreen. Signing requires your organization's own code-signing certificate.

### Verification

```powershell
dist\Glitch.exe --inference-test glitch-test-output\inference C:\Models\your-model.gguf
dist\Glitch.exe --smoke-test glitch-test-output\desktop
```

Each writes `result.json` to its output directory. The inference test loads real weights, generates schema-constrained JSON without HTTP and unloads the child process. The native UI test uses deterministic worker decisions for settings, approvals, navigation protection and lifecycle checks. A tiny test model proves packaging, not long-horizon agent quality. Paid/API/subscription and Discord checks with live accounts require your credentials; fixture tests are not live account validation.

## Source structure

```text
glitch/
  main.py              Native window, startup, shutdown and navigation guard
  launcher.py          One-file entry point and freeze_support
  api.py               Narrow trusted UI-to-Python bridge
  storage.py           SQLite history/evidence/anchors and Windows DPAPI
  models.py            Embedded worker facade and lifecycle coordination
  local_inference.py   Isolated llama.cpp process and schema-constrained decisions
  model_manager.py     Background GGUF download/import and local catalog
  supervisor.py        Native/API and authorized loopback bridge transport
  monitor.py           Step, error and loop triggers
  engine.py            Agent loop, approvals and correction injection
  tools.py             Workspace files and fixed command recipes
  computer.py          Desktop automation and isolated Chrome CDP
  discord_bot.py       Owner-locked async control and remote approvals
  desktop_runtime.py   Guarded WebView2 shutdown
  ui/                  Bundled HTML/CSS/JS and owl mascot
  tests/               Regression and native/frozen smoke checks
  requirements-lock.txt
  Glitch.spec          Exact one-file Windows build
Build Glitch.cmd        Double-click build helper
```

The [retained PWA/Electron prototypes](../docs/legacy-development.md) are development references, not features loaded by the executable.

References: [llama-cpp-python and CPU wheels](https://github.com/abetlen/llama-cpp-python), [PyWebView](https://pywebview.flowrl.com/guide/usage.html), [PyInstaller specs](https://pyinstaller.org/en/stable/spec-files.html), [Discord intents](https://discordpy.readthedocs.io/en/stable/intents.html), [PyAutoGUI](https://pyautogui.readthedocs.io/en/latest/index.html), [Chrome debugging profiles](https://developer.chrome.com/blog/remote-debugging-port).
