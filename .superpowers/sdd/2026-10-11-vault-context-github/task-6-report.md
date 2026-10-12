# Task 6 Report

## Scope

- Implemented only approved Task 6 in the specified `glitch-vault-context-github/Ultimate PWA Harness` worktree, starting from clean `17de9351` on `codex/vault-context-github`.
- Read the Task 6 brief, approved GitHub specification, plan Task 6, and repository instructions. Implemented inline as requested: no agents and no controller-ledger changes.
- No live GitHub/user-repository requests or mutations, cloud/GPU inference, executable/build/release, source push, or Task 7 work. Existing data, GGUF files and executables were not altered.

## Implementation

- Seven strictly validated schemas and tools: `github_list_repositories`, `github_clone_repo`, `github_repo_status`, `github_diff`, `github_create_branch`, `github_commit_and_push`, `github_create_pull_request`.
- Parent and child engines register and dispatch the same tools. Status exposes the bound repository/default branch and opaque credential ID; callers cannot override the project binding through tool arguments.
- Additive SQLite connection/publication tables persist project ID, credential ID, encrypted-record version fingerprint, repository/default-branch identity, request hash and retained commit SHA. No secret payload is stored in project metadata. Removing a project also removes these records, not project files or shared credentials.
- Native confirmed binding validates account/repository read access and exact checkout origin. Credential replacement invalidates the binding even with an unchanged display timestamp. Rebinding the same repository preserves retry receipts; changing destination/default-branch identity invalidates them.
- Frozen host-generated reviews capture arguments, connection identity, HEAD/index/config/ref/file-byte and directory identity fingerprints, remote refs, explicit paths, author, commit/PR message and complete protected-source diff. The mutable UI approval payload cannot modify this authority.
- Release leases before approval. Reacquire the identical canonical workspace resource used by file writes and shell recipes; recheck local bytes, HEAD, index, configuration, credentials, remote identity/refs/default branch and branch protection before mutation. Check again in the final push callback, with no override path.
- Full Access does not authorize GitHub mutations automatically. A shared human-review policy marker drains admitted desktop input/commands and refuses new agent input/commands while review is pending, without holding resource mutexes across the human wait. This prevents ordinary sibling automation from manufacturing approval.
- Feature branch creation and native fetch/fast-forward updates require clean tracked/index state. Refuse divergence, untracked overwrite, Windows path collisions, default/protected branches and unsupported configuration. No force/reset/delete/rebase/merge operations are exposed.
- Commit explicit paths only; refuse all preexisting staged ambiguity. Unselected worktree edits remain local. Unknown preexisting unpublished local commits are refused rather than silently included. Matching retained publication retries display the original commit diff/message and reuse its SHA.
- Host scans selected file contents/names and complete bounded commit history, including commit identities and paths, for vault/pattern credentials and protected paths before publication. Reject hooks, filters/attributes, submodules, external object/config stores, symlink/junction escapes and noncanonical remotes. Parser/transport errors do not expose raw credential-bearing data.
- Python-native Dulwich 1.2.17 smart HTTPS push resolves authentication only in host transport headers. Receive-pack is disabled on default read-only clients and enabled only by the publishing path. Fixed GitHub/API hosts, verified TLS, response/request limits and cancellation remain mandatory; no URL/config/helper/log/command-argument token injection.
- Lost push response: query remote SHA instead of blindly sending again. Network failure preserves and reports the local commit; the persisted receipt prevents duplicate commits after restart. An index-write failure also reports the retained commit and withholds push.
- PR creation searches matching repository/head/base before POST and again after an uncertain response; validated canonical PR number/URL only are returned. No blind POST retry.
- Complete bounded source is redacted before line segmentation, diff markers and output truncation, preserving the Task 5 fix. Publishing approval diffs refuse incomplete/oversized review rather than approving truncated changes. Typed results/arguments preserve protocol keys without weakening existing opaque-session contracts.
- Settings adds native project binding and explicit file diff review. GitHub approval shows repository, branch, current/target HEAD, fingerprint, selected paths, author and message/diff. PR branch names and current commit SHA are separate fields. Full Access copy accurately notes the retained GitHub gate.

## RED Then GREEN Evidence

Interpreter for every run: `C:/Users/jrmym/Documents/Ultimate PWA Harness/.venv-glitch/Scripts/python.exe`; explicit working directory was the specified worktree.

1. Initial `-m unittest glitch.tests.test_github_tools -v`: 15 new tests failed with the expected missing-tools assertion. An initial imported test class also ran 31 existing backend tests successfully; corrected discovery to avoid that duplication.
2. Initial publishing GREEN: 15/15. Integration RED then GREEN covered absent native binding/parent-child dispatch and automatic Full Access authorization; 24/24 passed after implementation.
3. UI review RED: missing binding/review controls; GREEN after implementation. Focused backend/tools run reached 70/70.
4. Additional observed RED cases: secret filename publication, missing fast-forward update, same-timestamp credential replacement, retained-retry diff omission, receipt loss on same-repository rebinding, unknown local commits, casefold path aliases, late branch protection changes, missing author display, index-failure reporting, opaque-session regression, missing bound status identity/PR commit SHA, and missing human-review automation guard. Each was corrected and covering tests passed. Existing Task 5 complete-source redaction regressions remain green.
5. First full run: 302 tests, 2 failures and 1 error, plus the existing skip. Failures were the default read-only client's receive-pack guard and a clone bridge fixture lacking the new validated binding step. Restored the default read-only transport restriction and extended that fixture to assert binding. No failures were concealed as preexisting.
6. Intermediate full run: 311 tests, 310 passed, 1 existing skip.
7. Final full command: `-m unittest discover -s glitch/tests -q`: **325 tests, 324 passed, 1 skipped**, exit 0, 90.191 seconds. Skip: `test_embedded.EmbeddedTests.test_symlink_cannot_escape_model_library`, Windows Developer Mode/administrator symlink permission requirement.
8. Final focused command: `-m unittest glitch.tests.test_github_tools glitch.tests.test_github_service -q`: **91/91 passed**, exit 0, 31.845 seconds; 47 Task 6 cases plus 44 backend/bridge/transport/UI cases.
9. `git diff --check`: exit 0. Git reports only existing LF-to-CRLF normalization warnings, not whitespace defects.

## Native Evidence

- Real temporary repositories exercised Dulwich clone, explicit index/tree/commit construction, branch updates, fast-forward push and remote SHA reconciliation through local transports.
- Real loopback verified-TLS smart HTTP push exercised the production `NativeGitClient` and `HTTPSConnection` protocol with fixed logical `github.com` routing redirected solely by a fixture connection factory. No external product process/global Git config. Verified remote SHA, auth-header-only transport and absence of the synthetic token throughout checkout `.git` files. Fixture OpenSSL creates disposable TLS certificates only; it is not a product runtime dependency.
- Sibling real `WorkspaceTools.write_file` waited during the Git publish lease, then succeeded afterward. Cancellation/resource wait, denial, snapshot races, protection/rate-limit denial, restart retry and lost PR response were exercised without public GitHub access.
- `-m glitch.tests.smoke_github_tools <task-6-ui-evidence>` passed twice using disposable production-DPAPI Store and source WebView2. Four checks passed: persistent confirmed native binding; actual explicit diff; real engine approvals under Full Access; desktop/compact fit and local fixture push with no page errors or model calls.
- Native viewport sizes: 1200x800 and 900x680. Screenshots visually inspected; no review-field/diff/button overlap. This is native source evidence, not a frozen-executable or live-account claim.
- Evidence retained in this task's ignored directory: `task-6-ui-evidence/result.json`, `repository-review-settings.png`, `repository-approval-desktop.png`, `repository-approval-compact.png`. These are not release assets and are not staged.

## Review And Rulings

- Final review: self-review, as explicitly requested with no agents. Weaker than a fresh independent reviewer; not represented as one.
- Reviewed new files plus scoped changes against the approved brief/spec, transport boundaries, destructive-operation bans, sibling resource identity, persistent binding/receipts, approval fingerprints, complete-source redaction and typed parent/child feedback.
- Fixed observed final-review issues with RED/GREEN coverage: retry evidence/receipt preservation, unreviewed history refusal, final protection recheck, Windows alias refusal, author/PR SHA display, index-failure reporting, result-schema compatibility and sibling self-approval prevention. No remaining known blocking finding in this scope.
- Ruling: retain explicit human approval for all four GitHub mutations even in Full Access. The specification permits stronger approval gating; broad project/computer permission does not establish destination-specific publication authorization. Cost: extra human prompts.
- Ruling: `github_create_branch` also fetches/fast-forwards an existing clean feature branch, keeping the required seven-tool registry. Cost: branch tool may perform a reviewed local checkout update, never reset/rebase/merge.
- Ruling: unknown unpublished local history is refused rather than bundled into an explicit-path publication. Cost: externally created pending commits require separate human Git review/recovery; they are not silently pushed by this tool.

## Limits And Unverified Paths

- No live PAT permissions, organization/ruleset behavior, public GitHub push/PR or executable packaging were tested. Successful repository reads still do not prove Contents write/Pull requests write. Remote policy rejection is not overridden.
- No inference/runtime/GPU claims; no Task 7 integration or release certification. Existing executable capability has not changed until a separately authorized build/release.
- Existing initial commit and registered checkout are required for branch/publishing tools. Empty-repository initial commit creation, repository creation, OAuth, fork PRs, multiple remotes and non-GitHub hosts are not provided here.
- Publishing/branch review supports bounded UTF-8 text, not arbitrary binary review. Limits include 1-100 explicit paths, 2 MiB per file, 256 MiB bounded scans, 1000 history commits, 65,536-byte complete approval diff, 256 KiB/2000-line diff work, API/page/ref/pack/time limits. Large or ambiguous cases refuse, without Full Access bypass.
- Secret scanning is conservative and can refuse benign credential-like source/history. It cannot identify every arbitrary/encoded unknown secret. Scans include history, so deleting a protected/secret file from the current tree does not make historical transmission safe.
- Cancellation or disk failure during a multi-file fast-forward can leave an approved partial local working state. Index failure after commit retains the commit and requires index inspection before retry. No destructive automatic rollback/reset or false completion claim.
- Shared policy/leases coordinate admitted Glitch tools, not every external process or hostile code that survives a prior approved project test/build. Resource fingerprints provide rechecks, not an OS sandbox or a guarantee against arbitrary external filesystem tampering after the final check.
- Review UI was verified at native desktop/compact dimensions only, not mobile browsers or a newly frozen executable.

## Commit Boundary

Stage only Task 6 source/tests/UI and this report. Leave controller ledger and other task artifacts unchanged. Local commit only; no push, merge, release or build. Final commit identity and clean working-tree status are reported in the completion response.

## Fix Round 1 (2026-10-12)

Base: `791ddbac36e1a6a184d7e477290831111d69162a`. Addressed the four Important findings and Minor safe-diagnostics finding in `task-6-review.md`; no additional feature or review expansion.

- PR creation rechecks approved HEAD, remote head/base refs, default/protected branch policy, credential/project binding and local/index fingerprints after lookup and immediately before POST. Final refs/binding checks follow the permission network interval. Uncertain-response lookup also rechecks before reuse; no blind second POST.
- Success requires a canonical open PR with exact approved head/base SHAs, repository and branch identities. Closed/stale/noncanonical responses cannot report success. Known response identity must match reconciliation identity.
- Ancestor/descendant workspace scopes conflict across admitted file/shell/Git mutations and pending human review. Disjoint siblings remain independent; nested leases restore outer ownership, waiters clean up on cancellation, and overlapping queue fairness is preserved. Human review holds policy intent, not a workspace lease.
- Clone ruling: do not automatically adopt a new root. Clone stays inside the exact approved parent destination, registers a bound child conversation atomically, and pauses the current run before another model/tool call. The user explicitly selects the child for a new task. Parent/sibling sessions retain their workspace; restarted child tasks use the child root for file/Git/browser paths and system context. Parent inspection excludes nested checkout contents and refuses staging/diff of child paths. Registration failure retains the clone with an honest recovery result rather than claiming adoption.
- Typed host refusals retain safe recovery guidance. Arbitrary remote/parser exception strings remain suppressed; synthetic secret-bearing diagnostics are not echoed.

### Focused RED/GREEN Evidence

All Python commands used `C:/Users/jrmym/Documents/Ultimate PWA Harness/.venv-glitch/Scripts/python.exe`, `-B`, and explicit workdir `C:/Users/jrmym/.codex/worktrees/glitch-vault-context-github/Ultimate PWA Harness`.

Incremental RED then GREEN runs: diagnostics 2 failures -> 2 pass; PR suite 10 cases with 12 failing subtests -> 10 pass; hierarchical scope regressions 8 cases with 10 failing subtests -> 10 affected cases pass; clone flow 1 failure/2 errors -> 3 pass. A Windows drive-case assertion was normalized without changing authority checks. Existing wait fixtures were changed to hold leases from another thread because same-thread acquisition is now intentionally reentrant. A timer-boundary cancellation classification failure was fixed using explicit expiry state. Human-review diagnostics/own-claim guards failed first, then the 26-case module passed. Unrelated-owned-scope fairness failed first, then all 9 scope cases passed. Final permission-network binding/ref drift failed in 2 subtests before the last recheck fix. One transient indentation error during editing was repaired before verification.

Final exact focused regression command:

```powershell
& 'C:/Users/jrmym/Documents/Ultimate PWA Harness/.venv-glitch/Scripts/python.exe' -B -m unittest glitch.tests.test_github_task6_review -q
```

Output: `Ran 28 tests in 14.052s` / `OK`; exit 0.

Final exact affected compatibility command:

```powershell
& 'C:/Users/jrmym/Documents/Ultimate PWA Harness/.venv-glitch/Scripts/python.exe' -B -m unittest glitch.tests.test_resources glitch.tests.test_github_tools.PublishingTests.test_pr_lost_response_searches_matching_head_base glitch.tests.test_github_tools.PublishingTests.test_clone_tool_and_persistent_child_binding glitch.tests.test_github_tools.PublishingTests.test_cancel_during_approval_and_resource_wait glitch.tests.test_github_service.GitHubTests.test_status_lease_wait_is_bounded glitch.tests.test_github_tools.PublishingTests.test_full_access_still_requires_genuine_publishing_approval glitch.tests.test_github_tools.PublishingTests.test_human_review_rejects_agent_input_and_commands_without_holding_leases glitch.tests.test_github_tools.PublishingTests.test_git_human_review_waits_for_existing_automation_then_releases_policy glitch.tests.test_history_lifecycle.HistoryLifecycleTests.test_resource_lease_blocks_delete glitch.tests.test_github_tools.PublishingTests.test_failed_push_retains_local_commit_and_retry_does_not_duplicate glitch.tests.test_github_tools.PublishingTests.test_approval_rechecks_index_head_remote_and_binding glitch.tests.test_github_tools.PublishingTests.test_sibling_file_write_waits_until_publish_lease_is_released -q
```

Output: `Ran 13 tests in 7.318s` / `OK`; exit 0. Fixtures used bounded temporary repositories, mock HTTP/local native Dulwich transports, fake model responses and mocked browser/computer integration. Engine-level clone pause and restarted child scope were tested, not only GitHubTools units.

Final `git diff --cached --check`: exit 0, no output. `git diff --cached --stat` confirmed exactly 13 scoped source/test/UI/report files; no executable, data, model or controller ledger. Initial explicit `git add` emitted ignored-directory advice despite staging the already-tracked report; the report-only update was then staged explicitly with `-f`.

### Remaining Limits And Handoff

Remote PR checks are point-in-time; GitHub's ref-based POST is not an atomic compare-and-swap. Uncertain results remain explicitly uncertain when identity/current state cannot be established. Exact base-SHA matching conservatively refuses stale PRs. Shared leases govern admitted Glitch tools, not external processes or an OS sandbox. A retained clone after metadata failure needs explicit native recovery/selection.

No broad suite, fresh native UI/frozen executable run, live account/user-repository call, GPU/cloud inference, build, push or release occurred in this fix round. Earlier report evidence is historical, not rerun evidence. Existing workspace/source proof/executable and controller ledger remain untouched. Fresh controller scoped review and minimal Task 7 packaging/release remain pending; controller handles publication. This round ends with the scoped report and local commit only.
