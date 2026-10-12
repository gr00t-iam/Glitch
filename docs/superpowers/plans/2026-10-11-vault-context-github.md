# Vault, Context, and GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver protected service credentials, manageable project histories, automatic local context checkpoints, and GitHub repository workflows in the standalone Glitch application.

**Architecture:** Retain Python/PyWebView, SQLite, and the shared llama.cpp process. Add separate vault, authenticated service, context, and GitHub modules; route all actions through the existing approval and workspace coordination boundaries. Deliver each subsystem with its tests before packaging the integrated executable.

**Tech Stack:** Python, SQLite, Windows DPAPI, requests, Dulwich, PyWebView, llama.cpp, PyInstaller, unittest.

**Spec:** `docs/superpowers/specs/2026-10-11-vault-context-github-design.md`

## Global Constraints

- No terminal setup is required for these features.
- Preserve the single configured 65,535-token shared budget; never multiply it by the number of agents.
- No raw credentials enter checkpoints or model/supervisor prompts.
- Removing projects never deletes the user's project directory, repository, or project files.
- Full Access retains origin/repository/path restrictions and destructive-operation bans.
- No force pushes, destructive resets, automatic merges, or default-branch publishing.
- Keep existing user data and executable; build into a new versioned output directory.
- Live Proxmox/GitHub verification requires scoped credentials and explicit target authorization.

## Review Focus

- Concurrent agents must not delete each other's history or publish edits changed after approval.
- Cleared displays must stay cleared on restart while new events and pending approvals remain visible.
- Compaction summaries can omit or invent facts; preserve originals and reject invalid/oversized replacements.
- Credentials may reappear in HTTP responses, DOM reads, exceptions, speech, or Discord; redact all boundaries.
- A push can succeed before its response is lost; retries must reconcile remote state rather than duplicate work.

## Delivery Order

Tasks 1-2 deliver vault and service connections; Task 3 delivers history management;
Task 4 delivers compaction; Tasks 5-6 deliver GitHub; Task 7 verifies and packages
the integrated release. Each task is independently testable. Do not implement
multiple tasks without completing their verification and updating these checkboxes.

### Task 1: Encrypted Vault and Redaction

**Files:** Create `glitch/vault.py`, `glitch/tests/test_vault.py`; modify `glitch/storage.py`, `glitch/api.py`, `glitch/ui/index.html`, `glitch/ui/app.js`, `glitch/ui/style.css`.

**Interfaces:** `Vault(store).list() -> list[dict]`, `save(name: str, kind: str, origin: str, payload: dict, identifier: str | None = None) -> dict`, `delete(identifier: str) -> None`, `resolve(identifier: str, origin: str) -> dict`, `redact(value: object) -> object`. Public results contain only metadata. Secret resolution is host-only.

- [ ] Write `test_vault.py`: save a synthetic value, assert SQLite bytes do not contain plaintext, resolve it for its exact origin, reject another origin, update/delete, and assert metadata lacks payload. Exercise production DPAPI on Windows and an injected cipher fixture elsewhere.
- [ ] Run `.venv-glitch/Scripts/python.exe -m unittest glitch.tests.test_vault -v`; confirm failures identify missing vault behavior.
- [ ] Implement additive vault migration and strict type/size/origin validation. Preserve default settings, existing settings secrets, and existing sessions. Include CA trust metadata and scoped service credential types without exposing values through the native bridge.
- [ ] Extend tests: HTTP credentials, URL userinfo/query/fragment, invalid ports, redirect targets, unknown IDs, ciphertext failure, and exact-secret redaction inside nested values/exceptions. Assert active-run mutation refusal through API tests.
- [ ] Add masked Vault settings UI with Add/Update/Delete and saved-state feedback; no reveal/export. Register vault descriptors with agents, never secret retrieval. Apply exact-value redaction to storage/model feedback, supervisor, native UI events, Discord and speech boundaries; inspect screenshot disclosure separately.
- [ ] Run vault/API tests and full unittest discovery. Commit only this task's source/tests.

### Task 2: Scoped Service and Browser Credential Tools

**Files:** Create `glitch/service_tools.py`, `glitch/tests/test_service_tools.py`; modify `glitch/computer.py`, `glitch/engine.py`, `glitch/resources.py`, and Vault connection settings UI.

**Interfaces:** `ServiceTools(vault, approve, emit, cancel).execute(name: str, args: dict) -> dict`; `SERVICE_SCHEMAS` exports `list_connections`, `service_request`, and `browser_fill_credential` JSON schemas. `service_request` accepts credential ID, relative endpoint, allowlisted method and structured body; no caller-defined authorization headers.

- [ ] Write tests asserting exact-origin authorization, host-constructed Proxmox API token headers, no plaintext in returned results, and approval before mutating requests or credential fills.
- [ ] Run `.venv-glitch/Scripts/python.exe -m unittest glitch.tests.test_service_tools -v`; confirm the tests fail before implementing the tools.
- [ ] Implement HTTPS transport with redirects disabled, bounded response size/timeouts, trusted CA support, and cancellation. Validate relative endpoints including encoded traversal and network-path references. Deny custom shell/environment credential injection.
- [ ] Implement browser filling only after verifying the actual current CDP page origin against the vault record. Recheck after approval/resource acquisition; redact DOM/tool results, return field identifiers rather than values. Serialize desktop actions using existing resources.
- [ ] Test redirect/response-secret leaks, navigation between approval and fill, untrusted CA, HTTP destinations, cancellation, and forbidden methods. Wire schemas/executors into the agent loop and test unknown-tool rejection.
- [ ] Run service/vault tests and full discovery; commit this task. No live VM mutation is part of automated tests.

### Task 3: Projects, Deletion, and Display Clearing

**Files:** Modify `glitch/storage.py`, `glitch/api.py`, `glitch/orchestration.py`, `glitch/ui/index.html`, `glitch/ui/app.js`, `glitch/ui/style.css`; create `glitch/tests/test_history_lifecycle.py`.

**Interfaces:** Store `projects() -> list[dict]`, `delete_session(session: str) -> None`, `remove_project(project: str) -> None`, `clear_view(session: str, kind: str) -> dict`; API mirrors mutations with coordinator active-run checks. Session records retain existing `workspace` for compatibility and add `project_id`.

- [ ] Write tests migrating two conversations from one existing workspace into one project. Assert project removal deletes only associated Glitch records and leaves project files and vault untouched.
- [ ] Run `.venv-glitch/Scripts/python.exe -m unittest glitch.tests.test_history_lifecycle -v`; verify missing functionality causes failure.
- [ ] Add project registrations and message/event display watermarks transactionally. Add stable message IDs to archive reads. `load_conversation`/`poll` respect watermarks for display while engine archive reads remain complete. Keep monotonically increasing IDs and event cursors.
- [ ] Implement coordinator-locked deletion checks covering parent/child runs and pending approvals; transactional session deletion includes checkpoints, messages, anchors, events, and retained run records. Dismiss completed runs without removing active runs.
- [ ] Add grouped Projects above conversations, confirmed delete/remove controls, Clear chat window and Clear timeline controls. Show empty states and safe fallback selection; pending approval controls are not hidden by display clearing.
- [ ] Test clear-then-restart, new event visibility, inactive/active sibling sessions, last conversation removal, missing project directory, and completed-run dismissal. Run lifecycle tests/full discovery and commit.

### Task 4: Token-Aware Local Checkpoint Compaction

**Files:** Create `glitch/context.py`, `glitch/tests/test_context.py`; modify `glitch/shared_runtime.py`, `glitch/models.py`, `glitch/engine.py`, `glitch/storage.py`, and progress UI.

**Interfaces:** runtime `count_prompt(messages: list[dict], cancel) -> int`; ModelClient `summarize(settings: dict, messages: list[dict], schema: dict, cancel) -> dict`; `ContextManager(store, models).prepare(session: str, system: dict, messages: list[dict], settings: dict, cancel, emit) -> list[dict]`; checkpoint records contain source message IDs, validated summary and token count. `retrieve_history(session, start_id, end_id, limit)` is bounded and session-scoped.

- [ ] Write fake-tokenizer/fake-model tests: below 75 percent leaves history intact; threshold compacts; retained constraints/recent evidence and archive IDs survive; supervisor off still works; context length is never multiplied by agents.
- [ ] Run `.venv-glitch/Scripts/python.exe -m unittest glitch.tests.test_context -v`; confirm expected failures.
- [ ] Extract existing apply-template/tokenize logic for reusable counting. Ensure the model is ready before counting. Reserve 1,536 output tokens plus existing 32-token margin when possible; reject irreducible oversized system instructions safely rather than truncating them.
- [ ] Implement bounded chunk summaries with a strict structured checkpoint schema and atomic persistence. Keep originals, validated task facts, unresolved work and source references; keep recent exchanges verbatim within allowance. Bound active correction anchors; archive older anchor references.
- [ ] Apply `prepare` before every engine generation and on session resume. Ensure summary inference completes/releases its reservation before another request, respects cancellation, and never recursively invokes compaction. Provide bounded archive retrieval through an explicit tool. Show Context refreshed events.
- [ ] Test malformed/hallucinated summary claims against source evidence where mechanically checkable, summary exceptions, over-budget replacement, huge single tool results, screenshot contexts, corrupt checkpoints, exact quotation retrieval, and cancellation while four agents contend. Preserve existing step/error/loop limits.
- [ ] Run context tests, full discovery, and existing shared-runtime budget tests. Commit.

### Task 5: GitHub Connection and Local Repository Backend

**Files:** Create `glitch/github_service.py`, `glitch/tests/test_github_service.py`; modify `glitch/requirements.txt`, `glitch/Glitch.spec`, `glitch/api.py`, and settings UI.

**Interfaces:** `GitHubService(vault).validate(credential_id: str, owner: str, repo: str, cancel) -> dict`, `repositories(credential_id, cancel) -> list[dict]`, `clone(credential_id, owner, repo, parent: Path, folder: str, cancel) -> dict`, `status(workspace: Path) -> dict`, `diff(workspace: Path, paths: list[str]) -> dict`. Use injected HTTP/Git transports for tests.

- [ ] Write tests for identity/repository validation, denied scopes, bounded pagination/rate limits, HTTPS github.com-only remotes, and temporary-fixture clone/status/diff with no external git process.
- [ ] Run `.venv-glitch/Scripts/python.exe -m unittest glitch.tests.test_github_service -v`; verify failures before backend implementation.
- [ ] Select and pin a verified compatible Dulwich version; include it and its licensing in packaging. Implement Python-native transport using vault credentials without token-bearing URLs/config/logs. Suppress hooks/external filters/submodule recursion. Validate resolved destination ancestors and refuse nonempty destinations.
- [ ] Add GitHub Connections settings with masked credential entry/selector, Validate, account identity, repository selection and native clone destination picker. Report permission uncertainty accurately; a successful read does not establish write access.
- [ ] Test path/junction escapes, hostile repository config, CA/redirect errors, expired token, cancellation, unavailable repo and partial clone cleanup limited to owned destinations. Run full tests and commit.

### Task 6: Branch, Commit, Push, and Pull Request Tools

**Files:** Extend `glitch/github_service.py`; create `glitch/github_tools.py`, `glitch/tests/test_github_tools.py`; modify `glitch/engine.py`, `glitch/resources.py`, and repository review UI.

**Interfaces:** `GitHubTools(service, workspace, approve, emit, cancel).execute(name: str, args: dict) -> dict`; `GITHUB_SCHEMAS` exposes the seven tools named in the spec. Commit/push args use explicit paths, structured commit title/body and branch, not shell strings. PR args use title/body/base/head, with validated repository metadata bound to the project.

- [ ] Write tests asserting branch validation, explicit staging, no default-branch/force publishing, protected file refusal, remote match, dirty/staged ambiguity refusal, and exact approved diff/HEAD fingerprints.
- [ ] Run `.venv-glitch/Scripts/python.exe -m unittest glitch.tests.test_github_tools -v`; confirm failures.
- [ ] Implement validated branch creation and fast-forward-only update. Build immutable approval previews and reacquire/recheck workspace state immediately before mutation. Never hold resource locks during approval/model calls. Serialize sibling Git/file mutations consistently.
- [ ] Implement staged-path commit and secure push; on lost response query remote commit before retrying. Preserve successful local commits after network failure. PR creation searches matching head/base before retrying. Disable merge/reset/delete/force operations even in Full Access.
- [ ] Register schemas/tool dispatch with parent and child agents. Test model-visible result redaction, secrets in staged content, remote/index/file changes after approval, concurrent writes, cancellation, and lost push/PR response retries.
- [ ] Run GitHub/full tests; review generated diffs and commit. Live user-repo pushes require separate target authorization, not this test step.

### Task 7: Integrated Native/Frozen Verification and Release

**Files:** Extend `glitch/tests/smoke_desktop.py` and frozen fixture harnesses; update `glitch/README.md`, `glitch/RELEASE_NOTES.md`, root consumer guides, version metadata and launcher only after selecting the next release version.

- [ ] Add native UI assertions for vault masking, project grouping, delete guards, persisted clears, compaction feedback and GitHub error states. Run them with fixtures without user credentials, live microphone input, or user-repo mutations.
- [ ] Run `.venv-glitch/Scripts/python.exe -m unittest discover -s glitch/tests -q`; require no new skips or failures beyond the documented Windows symlink permission limitation.
- [ ] Obtain a fresh independent whole-change security/correctness review; resolve findings and rerun affected tests before packaging.
- [ ] Build with PyInstaller into a new versioned dist/work directory. Verify bundled Dulwich and DPAPI round trip from the frozen application, temporary Git fixture operations, and local-only checkpoint compaction.
- [ ] Re-run existing frozen CPU four-stream cancellation/reuse, native UI, synthetic voice, and actual Muse Glimmer CUDA/shared 65,535-token acceptance. Record measured VRAM and distinguish inference from long-horizon task quality.
- [ ] Update consumer documentation with credential rotation, project removal semantics, token permissions, context limitations, CA trust and recovery instructions. Check git diff whitespace and staged secret leakage, excluding all user databases/model files.
- [ ] Commit verified source, run Windows CI, and publish a new executable/checksum only after success. Do not replace a running executable. Record untested live GitHub/Proxmox paths honestly and request target-scoped authorization before any live mutation.

## Handoff

Plan is ready for user review. Recommend subagent-driven execution with sequential
implementation and a fresh review per task because credential transport, concurrent
mutations, and compaction boundaries have substantial security/data-loss risk.
Do not begin product implementation until the user reviews this plan and selects
the execution method.
