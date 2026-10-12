# Glitch 1.3.0 - Protected credentials, durable context and GitHub projects

- Windows DPAPI credential vault with masked settings and origin-bound host tools; known credentials are removed before capped file/readback/diff/Chrome previews and across command chunks. Actual written bytes and readback SHA-256 remain unchanged. Screenshots are not automatically pixel-redacted.
- Project-grouped conversation history, guarded deletion, persisted presentation clears, and project removal that leaves all project files and shared vault credentials intact.
- Automatic local checkpoints with bounded archived-history retrieval, persistent correction anchors and finite working context. One configured 65,535-token pool still serves all streams; no external model application is required.
- Fine-grained PAT repository access, clone, status/diff, local-only current-branch fast-forward pull, explicit-path commit/push and PR creation. Read validation is not proof of write permissions; publishing still requires destination approval in Full Access. Default/protected-branch pushes, force, reset and merge remain refused.
- Frozen CLI integration gate for disposable DPAPI, bundled Dulwich 1.2.17, Git and context fixtures, plus native vault/history/GitHub helper entrypoints. CPU inference, parallel and synthetic voice gates remain in Windows CI; no CI GPU or user credentials required.

Source integration is prepared for 1.3.0. A fresh independent final review, new Windows executable build, frozen acceptance and CI/publication are controller gates, not claimed complete here. Live GitHub/Proxmox permissions, unknown-secret detection, microphone/noisy-room and screenshot privacy remain user/target-specific checks.

## Glitch 1.2.1 - Shared context, NVIDIA GPU and chat controls

- All 1-4 streams share a single configured context pool. A 65,535 setting no longer allocates 196,605 or 262,140 tokens for sub-agents. Independent histories borrow available cache space; over-budget combined requests wait without silently truncating history.
- Bundled NVIDIA CUDA 12.4 runtime with automatic GPU detection and layer fitting, plus CPU fallback. No external model server or CUDA toolkit installation is required.
- Enables native GGUF Jinja templates, fixing Muse Glimmer's custom-template generation failure.
- Repairs a saved vision projector pointing at the language model itself and prevents saving that invalid configuration again.
- Chat composer uses a microphone icon, circular arrow Send button and inline Full Access control with confirmation. Removes Read reply; automatic spoken completion reports remain available.
- Real Muse Glimmer / RTX 4090 acceptance: one 65,535-token pool, four simultaneously occupied CUDA slots, three sibling completions after cancelling one, roughly 18.5 GB total GPU usage. This is not a guarantee of arbitrary task quality or all model/hardware combinations.

## Glitch 1.2.0 - Parallel agents and offline voice

- One bundled, private shared-weight llama.cpp runtime with 1-4 real inference slots and per-agent context validation.
- Independent agents, parent delegation, isolated approvals/histories and individual Stop controls; shared computer/workspace mutations are coordinated.
- Offline English dictation with live preview, draft preservation, Cancel and no automatic task submission.
- Optional local Hey Glitch listening, default off, with visible state and global mute.
- Optional Windows-voice completion announcements, voice/rate/volume controls, Test/Read/Stop, known-secret redaction and microphone/playback exclusion.
- Existing settings/models/conversations retained. Single Windows executable; no external inference server or terminal needed.

Hardware caveats: CPU-only release. Shared weights do not eliminate per-agent cache memory. Synthetic voice fixtures do not prove human/noisy-room accuracy or audible speaker playback. Custom Jinja-only chat templates are not supported by this release's schema parser.

## Glitch 1.1.2 - Context and action permissions

- Context settings now accept 1,024-131,072 tokens, including 65,535. Actual model support and available RAM still determine what can load.
- Adds an explicit Full Access switch under Computer & safety. It is off by default and saved locally. When enabled, supported tool actions run without individual approval prompts, including authorized Discord tasks.
- Full Access is visible in the header. Cancellation, protected paths, fixed command recipes, file-conflict detection and Discord ownership checks remain enforced. It does not grant administrator privileges or arbitrary shell execution.
- Save settings closes the dialog only on success. Loading and testing connections keep it open; failed saves stay visible.
- Six new backend regression tests; native WebView2 tests cover the larger context, invalid form values, save-and-close, and a second task without approval prompts. Tests do not load the user's 30B model or allocate a 65,535-token native cache.

## Glitch 1.1.1 - Chat without setup blockers

- Fixes the disabled Send button when no project/conversation has been selected.
- First message automatically creates a persistent conversation with an isolated chat workspace. Project selection is optional for ordinary chat.
- New conversation no longer opens a mandatory folder picker on a fresh install.
- Saved local models load automatically on the first message, including after restart or canceled inference. No supervisor/API key is required in worker-only mode.
- Loading status is visible; double submissions remain blocked, and all existing approval gates remain on.
- Adds three regression tests and a native fresh-install UI test for this exact failure.
- Fix verification: 40 tests, 39 passed and one symlink-permission test skipped locally. Real WebView2 confirms Send works with zero conversations, creates a workspace, auto-loads the saved model and still blocks file writes for approval. The user's 30B model was not loaded during testing; UI tests use deterministic model decisions.

## Glitch 1.1.0 - Built-in local models

## Run without a model server

- Bundles llama.cpp CPU inference through llama-cpp-python. Ollama and LM Studio are no longer required.
- Model Manager downloads public Hugging Face GGUF files with byte progress, cancellation, integrity checks and optional publisher SHA256.
- Import, select, load, unload and delete local GGUF files inside the desktop UI.
- Configure context size, CPU threads, temperature and an optional compatible LLaVA 1.5 projector.
- Persistent isolated inference process protects the dashboard from model crashes. Stop interrupts generation; reload the model to continue.
- Preserves conversations, verified tool evidence, persistent corrections, approval gates and owner-locked Discord access.

## Supervisor choices

- Developer API mode supports OpenRouter, OpenAI, other OpenAI-compatible providers and Anthropic's native Messages API.
- Authorized account-bridge mode connects to a loopback OpenAI-compatible endpoint, opens its own sign-in page and lists models. Optional bridge access keys use Windows DPAPI independently from cloud API keys.
- No spoofed OAuth identity, browser-cookie extraction or consumer subscription-token collection. A separately configured, provider-authorized bridge is required. Glitch does not bundle a universal subscription proxy.
- ChatGPT plan access depends on supported integration and entitlement. Claude Pro/Max credentials are not a third-party API authentication option; use Anthropic API keys. Subscription and API billing are not interchangeable.

## Launch

Download `Glitch.exe` and double-click. In **Settings & connections > Model Manager**, download or import a trusted instruction-tuned GGUF, select it and click **Load model**. Choose a project and send a task.

Model weights are not included. CPU inference is the portable default; GPU acceleration is not promised. Windows 10/11 x64, WebView2 and .NET 4.8 are required. Chrome and project toolchains are separate. Builds are unsigned and may show SmartScreen warnings.

## Verification

- 37 regression tests: 36 passed and one Windows symlink-permission test skipped locally. Includes actual PowerShell output, DPAPI round trips, memory/anchor persistence, approval denials, downloader integrity/cancellation, API transport and simulated owner-locked Discord.
- Real Hugging Face GGUF download verified against SHA256.
- Source and frozen inference checks load real GGUF weights, generate schema-constrained JSON without an HTTP server, then unload the child process. A tiny test model verifies packaging, not autonomous task quality.
- Real WebView2 UI checks cover library controls, supervisor mode switching, Discord settings, navigation protection, approval-gated file writes, persistence, layout and disposed-control shutdown.
- Windows CI also builds the executable and verifies frozen inference with the checksum-pinned GGUF fixture.

Live Discord, paid API and subscription-bridge account checks require your credentials and were not validated against live accounts. Screenshot reasoning requires a compatible vision model/projector and was not validated with downloaded vision weights.

See `glitch/README.md` for the complete setup, environment variables, safety boundaries, source structure and exact PyInstaller commands.
