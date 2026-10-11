# Shared-Model Sub-Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Run up to four independent agents against one bundled GGUF server, with scoped cancellation, approvals and safe shared computer access.

**Architecture:** Replace the default serial EmbeddedWorker with a private llama.cpp server, then wrap independent AgentEngine instances in an AgentCoordinator. Preserve existing storage, native bridge, supervisor and tool validation contracts where possible; add per-run ownership rather than a second execution engine.

**Tech Stack:** Python 3.12, pinned llama.cpp Windows CPU runtime, HTTP/SSE, SQLite, PyWebView, PyInstaller.

**Spec:** `docs/superpowers/specs/2026-10-11-shared-model-subagents-design.md`. Voice extension: `docs/superpowers/plans/2026-10-11-voice-interaction.md`.

## Global Constraints

- One loaded GGUF, 1-4 real batching slots; default one. No hidden serial fallback or four weight copies.
- Context is per agent; preserve 1,024-131,072 settings, including 65,535. Show total cache allocation before load.
- Loopback only, private random per-launch authentication, no unmanaged external server or terminal.
- Full Access stays explicit; validation, protected paths, Discord ownership and cancellation remain enforced.
- Do not stop the user's running Glitch executable or load the user's 30B model without separate authorization.
- Ship only after source, native UI, frozen executable and real-model concurrency checks pass.

## Review Focus

1. Four long contexts exceed RAM: explain loading failure, do not silently reduce context or duplicate weights (Tasks 1-2).
2. Concurrent load/Stop/restart races: one child process, cancellation affects only its request (Task 2).
3. Waiting parents and late approvals: no capacity deadlock or cross-run authorization (Task 3).
4. Windows path aliases and shared desktop: no conflicting writes or interleaved input (Task 4).
5. Discord disconnect and selected-chat changes: cancel/deliver only to the owning run (Task 5).

## File Map

- New `glitch/runtime_assets.py`, `glitch/prepare_runtime.py`: pinned archive manifest and safe build-time extraction.
- New `glitch/shared_runtime.py`: private server lifecycle, request cancellation, slot telemetry.
- New `glitch/orchestration.py`: run registry, delegation, per-run controls and completion subscriptions.
- New `glitch/resources.py`: shared desktop and workspace mutation coordination.
- Modify `glitch/storage.py`, `models.py`, `engine.py`, `tools.py`, `computer.py`, `api.py`, `main.py`, `discord_bot.py` and `glitch/ui/{index.html,app.js,style.css}`.
- Modify packaging, CI, tests and user documentation in the tasks below.

### Task 1: Pin And Bundle The Runtime

**Files:** New `glitch/runtime_assets.py`, `glitch/prepare_runtime.py`, `glitch/tests/test_runtime_assets.py`; modify `glitch/Glitch.spec`, `Build Glitch.cmd`, `.github/workflows/glitch-windows.yml`.

**Interfaces:** `prepare_runtime(destination: Path) -> Path` returns the verified runtime directory; `runtime_directory() -> Path` resolves packaged assets.

- [ ] Write `test_bad_hash_rejected`, `test_zip_traversal_rejected`, `test_symlink_rejected`, `test_missing_server_rejected`; assert no files escape the destination and invalid archives never become ready.
- [ ] Run `.venv-glitch\Scripts\python.exe -m unittest glitch.tests.test_runtime_assets -v`; confirm failures before implementation.
- [ ] Implement pinned b11552 CPU x64 asset URL and SHA256 `c00741179811ff903b515eae28bdeef1f47af6e81c49920c4e68b62954e056d6`. Bound transfer/extraction sizes, reject absolute/parent/link members, publish assets atomically, retain upstream license and required DLLs. Do not use releases/latest.
- [ ] Run the tests, prepare the actual archive, verify `llama-server.exe --version` and frozen asset resolution.
- [ ] Commit only manifest/downloader/packaging/test sources; exclude downloaded binaries.

### Task 2: Shared Inference And Request-Scoped Cancellation

**Files:** New `glitch/shared_runtime.py`, `glitch/tests/test_shared_runtime.py`; modify `glitch/models.py`, `glitch/storage.py`.

**Interfaces:** `SharedModelRuntime.load(path: Path, settings: dict, cancel: Event, projector: Path | None = None) -> None`; `chat(messages: list[dict], schema: dict, cancel: Event) -> dict`; `status() -> dict`; `close() -> None`. Settings adds validated `parallel_streams: int` (1-4, default 1).

- [ ] Write tests for concurrent load producing one PID, correct per-slot context allocation, fifth-request bounded rejection, missing assets, server exit, insufficient memory, and cancelling one request while three remain active.
- [ ] Run `.venv-glitch\Scripts\python.exe -m unittest glitch.tests.test_shared_runtime -v`; confirm failures.
- [ ] Implement one owned child with loopback binding, `LLAMA_API_KEY` child environment, disabled web UI/native agent tools, private clients with proxy/redirects disabled, startup timeout and process identity verification. Validate authenticated model readiness after generic health. Use one connection per generation and close only that connection on cancellation; parse complete schema-validated output before tool execution.
- [ ] Ensure ModelClient does not reload a ready shared model merely because another slot is generating. Changing model/context/slots is blocked while runs are active. Verify pinned context semantics against `/slots`; expose configured/occupied slots and cache allocation.
- [ ] Run unit tests plus actual two-request smoke test against the pinned server; failures in slot isolation or cancellation block migration.
- [ ] Commit runtime, model adapter, settings and tests.

### Task 3: Independent Runs And Delegation

**Files:** New `glitch/orchestration.py`, `glitch/tests/test_orchestration.py`; modify `glitch/engine.py`, `glitch/storage.py`.

**Interfaces:** `AgentCoordinator.start(session: str, prompt: str, parent_id: str | None = None, role: str = 'Assistant') -> str`; `state() -> dict`; `stop(run_id: str | None = None) -> None`; `resolve_approval(identifier: str, approved: bool) -> bool`; `subscribe_completion(callback: Callable[[dict], None]) -> Callable[[], None]`. None in stop means Stop All. Persist `agent_runs` with run/session/parent/role/task/status/timestamps/result; interrupted runs become interrupted on restart, never silently resume.

- [ ] Write tests asserting separate histories/anchors/monitors, four-run admission including parent, no recursive delegation, a waiting parent releases its inference slot, bounded child waits, cancellation before late approval, and completion callbacks emitted once with parent ownership.
- [ ] Run `.venv-glitch\Scripts\python.exe -m unittest glitch.tests.test_orchestration -v`; confirm failures.
- [ ] Wrap one AgentEngine per run with independent events/approval state. Add validated parent-only `spawn_subagent(role, task)` and `await_subagent(run_id)` tool schemas; reject excess runs visibly rather than unbounded queues. Deliver bounded child results only to their parent. Completion subscriptions receive stored event IDs and final replies, not raw tool payloads.
- [ ] Run tests, including concurrency barriers rather than sleep-based timing assumptions.
- [ ] Commit coordinator, migration, engine hooks and tests.

### Task 4: Shared Resource Safety

**Files:** New `glitch/resources.py`, `glitch/tests/test_parallel_safety.py`; modify `glitch/tools.py`, `glitch/computer.py`.

**Interfaces:** `ResourceCoordinator.desktop(cancel: Event) -> ContextManager`; `workspace_mutation(workspace: Path, cancel: Event) -> ContextManager`; `file_write(path: Path, cancel: Event) -> ContextManager`. Inject one coordinator into every run.

- [ ] Write tests for same-file conflicts, case/alias paths, desktop mutual exclusion, cancelled lock waiters, mutating command/write conflicts, and another run proceeding while approval waits.
- [ ] Run `.venv-glitch\Scripts\python.exe -m unittest glitch.tests.test_parallel_safety -v`; confirm failures.
- [ ] Acquire locks only after approval, canonicalize paths using existing confinement rules, recheck content after acquisition, preserve atomic replacements, and serialize potentially mutating command recipes against writes using a consistent workspace-before-path lock order. Serialize complete desktop/browser operations and release in finally.
- [ ] Run safety tests and existing protected-path/Full Access tests; no lock held during inference, supervision or approval.
- [ ] Commit resource coordination and tests.

### Task 5: Native UI And Discord Routing

**Files:** Modify `glitch/api.py`, `main.py`, `discord_bot.py`, `glitch/ui/index.html`, `glitch/ui/app.js`, `glitch/ui/style.css`; new `glitch/tests/test_run_api.py`; update `glitch/tests/test_discord.py`, `glitch/tests/smoke_desktop.py`.

**Interfaces:** Bootstrap/poll expose coordinator runs, per-conversation active run and aggregate slot status; `stop(run_id=None)` routes to coordinator. Native model operations remain blocked while any run is active.

- [ ] Write tests for per-run Stop/approval, chat selection during sibling execution, creating a new conversation within capacity, owner/channel isolation and Discord delivery failure stopping only its run.
- [ ] Run targeted unit tests and native smoke before implementation; confirm missing controls/contracts fail.
- [ ] Add 1-4 stream selector/cache warning and Sub-agents deck with role/task/state/Open/Stop. Keep each conversation's cursor/draft/timeline separate. Scope Discord status, outputs, approval responses and !stop to channel-owned runs; expose explicit Stop All locally. Wire orderly app shutdown without touching unrelated processes.
- [ ] Run tests and native WebView smoke across compact/wide windows, including four cards, switching histories and saving settings closing only on success.
- [ ] Commit native/Discord integration and tests.

### Task 6: Frozen Concurrency Evidence And Delivery

**Files:** New `glitch/tests/smoke_parallel.py`; modify CI, `glitch/README.md`, `glitch/RELEASE_NOTES.md`, root documentation as relevant.

- [ ] Write a real-model smoke harness asserting four overlapping requests with one PID/one GGUF load, observed occupied slots, one cancellation with three successes, slot reuse, fifth admission rejection and owned-process shutdown. Use the existing pinned tiny GGUF fixture, not the user's loaded model.
- [ ] Run the smoke against source before packaging; a serialized backend must fail its overlap assertion.
- [ ] Package to a new versioned output directory; do not overwrite the running executable. Run the full unittest suite, native UI tests and frozen concurrency smoke, and retain evidence/checksum.
- [ ] Document CPU-only baseline, per-agent cache memory, stream controls and hardware limits. Do not describe tiny-model success as proof four 65,535-context 30B streams fit this host.
- [ ] Review complete diff and scan for credentials; commit/push verified changes and publish the new executable only after all release gates pass.

## Self-Review

All spec sections map to Tasks 1-6. Cancellation, cache semantics, approval isolation, shared resources and remote routing each have explicit tests. Voice remains separately reviewed and planned; no product capability is claimed from this document alone.
