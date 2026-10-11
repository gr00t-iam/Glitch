# Added Reliability Task Report

## Scope

- Worktree: `C:/Users/jrmym/.codex/worktrees/glitch-vault-context-github/Ultimate PWA Harness`.
- Starting commit: `f50680b8`. Only this added reliability task was implemented.
- Python: `C:/Users/jrmym/Documents/Ultimate PWA Harness/.venv-glitch/Scripts/python.exe`.
- No push, release, binary build, production Store/history repair, OAuth-token retrieval, proxy modification, delegation, compaction, or GitHub integration.

## Root Cause And Changes

The previous engine stored/emitted the final assistant message and unconditionally accepted `done=true` before checking any workspace artifact evidence. A listing was therefore enough for a worker to claim a nonexistent output. The supervisor always supplied `temperature=0.1`; Test Connection only requested the model catalog.

- Completion verification now precedes final assistant persistence, message events, and completed events. Recognized creation/edit tasks and successful workspace writes require this turn's successful write plus current, workspace-resolved readback matching intended UTF-8 bytes. Host readback records exact path, size, and SHA-256; final answers include proof. Preexisting files, lists, command success, wrong paths, changed files, and fabricated tool-success flags do not suffice.
- Unsupported completion returns concrete local feedback and hybrid audit evidence. It never writes for the model, grants approval, expands shell commands, changes workspace, or bypasses a denial. At most three unsupported completion attempts fit inside the existing max-step budget; cancellation is checked after inference and before readback.
- Ordinary chat and creation explanations need no tool. Quoted filenames containing spaces and Windows case-equivalent file paths are supported.
- Proxy requests omit temperature; native OpenAI reasoning-family requests omit it too. Anthropic keeps its native route, authentication, and sampler. No model/auth fallback was added.
- Test Connection reports catalog and selected-model real generation separately. A catalog-only success is not connected. The UI renders failure/proof, removes automatic catalog-first model selection, and clears stale failure status after a successful retest.
- Chrome refuses a foreign non-HTTP listener before launching a debugging browser. Redaction schemas were extended only for the new proof/connection fields; vault protocol behavior, history watermarks, and voice were not redesigned.

## RED / GREEN

- Initial 17-test reliability run: 13 assertion failures and one missing-field error reproduced unverified completion, missing host readback, catalog-only connection success, and unconditional temperature. Three previously valid behaviors passed.
- Additional RED runs caught foreign non-HTTP port ownership, unsupported binary claims, unwritten final filenames, unsolicited creation claims, quoted-path/case false rejections, and explanatory-prose false rejection. Corresponding GREEN regressions passed.
- Rendered real `app.js` RED: a successful connection retest left the previous HTTP 500 message in main status. GREEN: failure and success both update status while retaining the selected model. API results in this UI fixture are synthetic, not live-generation evidence.
- Final quiet source suite after the last changes: `python.exe -m unittest discover -s glitch/tests -q` -> **176 tests, 175 passed, 1 skipped, 27.129 seconds**. This includes **27 added regression tests** using model/HTTP fakes and real disposable workspace/Store operations. This count is not a native-model inference count. The existing environment-dependent skip remains; no failed tests were hidden.
- `git diff --check` passed (only the existing LF/CRLF conversion warning for `glitch/redaction.py`).

## Live Model And Supervisor Evidence

Evidence root: `C:/Users/jrmym/.codex/worktrees/glitch-vault-context-github/Ultimate PWA Harness/.superpowers/sdd/2026-10-11-vault-context-github/reliability-evidence`.

1. `run-1/model-acceptance.json`: original actual Muse/ChatGPT acceptance passed. The controlled synthetic temperature probe returned HTTP 500; no-temperature selected-model generation and audit succeeded.
2. **Preserved failure** `final/summary.json` and `final/model-acceptance.json`: Chrome passed; model harness reported `Live directive was not in the next local system prompt`. Captured real prompts contain the exact directives in JSON-encoded anchor lists. A multiline directive with quotes/newlines cannot be tested by raw substring against that serialization. The harness now parses the host anchor list as JSON and checks exact directive membership at the next generation index after each audit, not generic keywords. This failure was not overwritten or silently changed to pass.
3. **Preserved distinct failure** `verified/model-acceptance.json`: the selected-model connection probe succeeded, but the subsequent live audit returned HTTP 500 without temperature. The engine paused with no persisted correction or completion. This is not claimed as a passed model run; no inference/auth/model fallback was used. The provider's exact cause is not known from the HTTP status alone.
4. **Passing bounded model-only retry** `model-retry/model-acceptance.json`: no Chrome rerun and no temperature probe. Actual read-only Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf on **RTX 4090 / CUDA**, one **65,535-token shared budget**, one slot (llama.cpp's physical alignment reports 65,536). No four-stream concurrency rerun or multiplied pool.

The passing retry contains five actual Muse decisions: list `.`, write (one injected harmless missing-file failure), retry write after the live correction, read file, then verified done. The synthetic failure did not write anything. The successful write went through the normal pending approval, resolved only for disposable `wiki.html`; Full Access remained off.

The real selected supervisor was `http://127.0.0.1:10531/v1`, model `gpt-6.1-sol`. Its exact persisted directive in the passing retry:

> Course Correction Directive: The write failed; `wiki.html` was not created. Retry `write_file` with relative path `wiki.html` and exact content `<h1>Reliability fixture</h1>`, as permitted by the tool error. Then verify readback matches exactly before claiming creation. Do not delegate or use computer tools.

`reviews[0].next_prompt_index` is **2** (zero-based). `correction_injections[0].directive_present` is true after JSON parsing of that exact system prompt. Muse's next actual generation selected the explicit retry write; a later actual generation selected `read_file`. The correction survived reopening the disposable Store. Original synthetic archive rows remained unchanged. No production archive was opened or modified.

- Exact verified output: `C:\Users\jrmym\AppData\Local\Temp\glitch-reliability-0ud_mm_p\workspace\wiki.html`.
- Content: `<h1>Reliability fixture</h1>` (28 bytes).
- SHA-256: `740dc3345d60d2b0141e0813503c0b6acac839220badbb0bb3814a01a3e7ab67`.
- The path existed and was read/hash-verified at acceptance time; the disposable workspace was subsequently cleaned. It is not a retained user deliverable.
- Both model preflight checks found no existing Glitch/llama-server. Owned runtime closed and task thread stopped. No user process was killed.

## Native Chrome And UI Evidence

`verified/chrome-acceptance.json` passed with its own headless Chrome profile and disposable loopback HTML fixture: tabs, navigation, DOM read, fill, click, DOM confirmation, and nonblank PNG capture. `verified/chrome-fixture.png` records the browser result; its SHA-256 is in the JSON. `verified/supervisor-ui.png` is settings viewport context; the exact connection-result/status assertions are in `ui_fixture`, not inferred from that screenshot. The bundled UI used synthetic API results for failure/success checks. The browser processes and loopback fixture server were cleaned. Native desktop input/mouse movement, user pages, credential forms, and production WebView2 were **not tested** and are not claimed tested.

The `final` and `verified` Chrome checks passed before continuation; unchanged native checks were not repeated during the final model-only retry. `ui-red/chrome-acceptance.json` retains the stale-status RED result.

## Reproduction And Limits

Acceptance entry point: `glitch/tests/accept_reliability.py`. Invoke its module with `--model` pointing to the read-only GGUF and `--output` pointing to a new worktree evidence directory. The known failing temperature probe is now opt-in with `--temperature-probe`, off by default. For model-only acceptance, call `model_acceptance(output, model, bridge, selected_model)`; it does not run Chrome. All loads/tasks/network requests have bounded deadlines and cleanup targets only owned resources.

Artifact intent detection is conservative English matching, not universal semantic validation for every wording, source input/output relationship, or binary format. Unsupported binary generation is not implemented. Proof is a readback-time snapshot, not a promise against later external edits. Provider HTTP 500 failures can still occur independently of optional sampler compatibility and pause visibly. Executable packaging/deployment and general native desktop actions remain unverified by this task.

## Review Fix Round 1 Of 5

Base: `f8d7f3a2f9d560554cba1ad040514d7c474049e3`. Addressed only the two P2 findings in `task-reliability-review.md`, in the same explicit worktree and with the same external Python. No changes to supervisor, native computer, UI, runtime/model interfaces, retained live evidence, production data, or earlier tasks. No GPU, ChatGPT, native Chrome, release, push, or subagent run.

- **Historical reference:** `What did we create yesterday?` -> `We created wiki.html yesterday.` now completes without tools, rewrite, or fresh artifact-proof claims when the same conversation has a prior completed turn with a successful workspace write and matching-size host readback evidence carrying the resolved workspace path and a valid SHA-256. This is a narrow past-question/past-answer exception, not blanket permission for creation claims. Prior events are read lazily, paginated, and bounded strictly before this turn's started event, with cancellation checks; persisted evidence survives a Store reopen. Old assistant assertions, files merely existing, unfinished writes, other conversations, different filenames, current execution claims, and writes in the current turn cannot fabricate the required past evidence. Historical facts are not presented as a new current disk/hash snapshot; broader semantic/date validation is not added.
- **UTF-8 preview:** mandatory readback hashes the complete bounded bytes as before, then decodes the complete verified UTF-8 and truncates the text preview by characters. The exact approved content `'a' * 119999 + chr(0xe9) + 'tail'` completes with all 120,005 bytes and the full intended SHA-256 preserved. The 1 MB read/write limit and strict UTF-8 validation remain unchanged. The separate preexisting `read_file` preview behavior was not expanded in this fix.
- Added **11 source regressions** using scripted model decisions, real disposable Store/workspace writes, and approval fixtures. They cover the two findings plus persisted grounding, event pagination, missing/unverified/unfinished/cross-conversation evidence, each named artifact, and current-turn false claims. These are not new live-model/native acceptance results.

Commands were run from `C:/Users/jrmym/.codex/worktrees/glitch-vault-context-github/Ultimate PWA Harness`; `python.exe` below is exactly `C:/Users/jrmym/Documents/Ultimate PWA Harness/.venv-glitch/Scripts/python.exe`.

1. **RED:** `python.exe -m unittest glitch.tests.test_reliability.CompletionTests -q` -> `Ran 26 tests in 7.258s`, `FAILED (failures=2)`. Failures were `test_verified_historical_reference_needs_no_new_tool_or_rewrite` and `test_utf8_crossing_preview_byte_boundary_can_complete`, both because completed events were withheld.
2. **First GREEN:** same command after the fixes -> `Ran 26 tests in 7.287s`, `OK`.
3. **Final focused GREEN:** `python.exe -m unittest glitch.tests.test_reliability -q` -> `Ran 38 tests in 13.662s`, `OK`.
4. **Final full GREEN:** `python.exe -m unittest discover -s glitch/tests -q` -> `Ran 187 tests in 35.389s`, `OK (skipped=1)`; **186 passed, 1 existing environment-dependent skip**.
5. `git diff --check` -> exit 0, no whitespace errors; Git reported LF/CRLF conversion notices for the edited artifact/test files.

The earlier failed and passing live/native evidence remains unchanged and is not reclassified by this round. This scoped fix is ready for the controller's fresh review; no independent review approval is claimed here.
