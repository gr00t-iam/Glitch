# Glitch: protected credentials, durable context, and GitHub workspaces

## Intent and approval status

Glitch is a standalone Windows desktop agent. Users must be able to supply
credentials safely, work in local or GitHub projects, publish completed work,
manage conversation history, and continue lengthy tasks with bounded local
model context. No terminal setup is required for these features.

The user approved the conversational design for the vault, history controls,
and automatic compaction. GitHub support is an additional requested subsystem.
This document proposes its integration and records concrete defaults for review.
Approval of this written specification precedes the implementation plan; this
document does not claim that any feature below has been implemented.

## Architecture and alternatives

Keep the existing Python/PyWebView shell, SQLite store, coordinated agent runs,
and shared llama.cpp runtime. Add focused services for credentials, context
checkpoints, project registration, and repository operations.

Recommended: Windows DPAPI plus a host-side credential broker, local context
checkpoints, and Python-native Git through Dulwich with HTTPS GitHub API calls.
This preserves standalone packaging and avoids model-visible secret values.

Alternatives: system Git and Git Credential Manager are mature but introduce an
external installation dependency; GitHub REST-only file publishing avoids Git
but does not provide faithful local checkout/index/diff semantics. Neither is
the selected initial design. Browser OAuth login is deferred because it needs
a registered GitHub application and an explicit account-authorization flow.

## Protected credential vault

Add a migrated SQLite vault containing opaque credential IDs, display names,
credential type, allowed HTTPS origin, encrypted payload, and timestamps.
Encrypt payloads using the existing Windows DPAPI primitive before persistence.
Credentials are local to the signed-in Windows account, not portable plaintext.

Settings exposes add, update, and confirmed delete actions. The UI receives
metadata and a saved/masked indicator, never stored secret values. Updating a
secret requires entering its replacement; no reveal/export control is provided.
Vault mutations are disabled while agents run in this initial version, avoiding
credential changes during an approved operation.

The model may list credential descriptors and reference a credential ID. Only
host-side tools resolve its payload. There is no read-secret tool and no general
secret-to-environment injection into arbitrary commands. Do not include secrets
in prompts, summaries, anchors, exceptions, telemetry, speech, or Discord.

Authenticated service requests accept a registered credential, relative endpoint,
allowlisted method, and structured data. Bind the connection to an exact origin;
reject credential-bearing URLs, redirects, traversal, and arbitrary destinations.
Use TLS verification. Private servers may use a user-supplied trusted CA rather
than globally disabling certificate checks. Mutating service operations follow
the existing approval policy and destination restrictions remain in Full Access.

Provide a Proxmox connection type with server URL, token identifier, and secret.
Host code constructs the authorization header. Start with bounded API requests;
do not promise a universal VM workflow. Browser credential filling resolves a
vault reference only on its configured HTTPS origin and never returns the filled
value as a tool result. Block credential entry over HTTP.

Apply exact-value redaction at every output boundary in addition to existing
pattern redaction. API responses and later DOM reads can contain secrets too.
Screenshots can expose unrelated private information: preserve screenshot
approval warnings and do not claim encryption prevents screen disclosure.
Never import the credential exposed in the user's screenshot; advise rotation.

## Projects and conversation lifecycle

Introduce registered projects with canonical directory paths and optional
GitHub connection metadata. Migrate existing session workspaces into project
registrations without changing their directories or losing conversations.

The sidebar groups conversations beneath projects and supplies explicit removal
and conversation-delete controls. Removing a project removes its registration
and associated Glitch conversation/checkpoint/run history after confirmation.
It never deletes the user's project directory, repository, or project files.
Deleting a conversation removes its associated persisted records transactionally.
Shared vault credentials are not deleted with a project or conversation.

Reject deletion when a target conversation or project has an active parent or
child run, pending approval, or resource lease. Choose a remaining conversation
or show a new-chat state afterward. Completed agent cards can be dismissed;
active agents must be stopped and joined before their records can be removed.

Clear timeline and Clear chat window are separate confirmed presentation actions.
Persist per-conversation display watermarks; new events and messages appear
normally afterward. Clearing the display does not remove model history, approvals,
checkpoints, or reset database IDs. Permanent removal uses Delete conversation.

## Automatic context checkpoints

Count tokens using the loaded model's actual template/tokenizer before every
generation, including system instructions, tool schemas, anchors, and reserved
output. Preserve the single configured 65,535-token shared budget; never multiply
it by the number of agents. Each agent retains separate working history.

At 75 percent of the configured prompt allowance, compact older exchanges into
a structured local checkpoint. Retain task intent, user constraints, approved
destinations, decisions, correction anchors, modified paths, verified results,
unresolved failures, pending work, and references to archived messages. Keep
recent exchanges verbatim when they fit. No raw credentials enter checkpoints.

Use bounded older-history chunks for summarization so the summarization request
itself fits. Persist a candidate checkpoint atomically only after validating its
structure and recounting the resulting working prompt. Preserve original messages
and allow bounded retrieval by conversation/message range for exact quotations.
Do not silently truncate critical rules, pending approvals, or tool evidence.

Compaction is local and works with supervision disabled. Use normal shared-runtime
reservations and cancellation; release an inference reservation before requesting
another. Stop remains responsive. A failed or oversized checkpoint pauses safely
with a useful error rather than losing task state or pretending completion.

Show a compact "Context refreshed" timeline event. Replace unbounded anchor
injection with bounded active anchors plus archived references. Restart resumes
from a validated checkpoint and recent history. Existing task step/error/loop
limits remain safety boundaries; context refresh does not create an endless
unattended loop or guarantee lossless infinite memory.

## GitHub connections and repository tools

Settings adds GitHub Connections: vault credential selector or masked token entry,
Validate connection, account identity, repository picker, clone destination,
and author name/email. Support github.com HTTPS in the first release.

Use fine-grained PATs restricted to selected repositories. Contents read/write
is needed for publishing; Pull requests write is needed to create PRs. Validation
checks identity and repository access, reports denied operations clearly, and
does not claim one read request proves all write permissions. Respect token expiry,
organization approval, rate limits, and repository branch protections.

Expose input-validated tools: github_list_repositories, github_clone_repo,
github_repo_status, github_diff, github_create_branch, github_commit_and_push,
and github_create_pull_request. Register them through the existing JSON decision
tool registry so local workers and sub-agents use the same authorization path.

Clone creates a new, explicitly selected child directory and refuses overwrite.
Existing checkouts must match the chosen repository before publication. Fetch
and fast-forward updates only; report divergence without automatic reset/rebase.
Reject workspace escapes, junction/symlink escapes, option-shaped refs, external
remotes, submodule recursion, repository hooks, and configured external filters.
Use Python-native Git operations without model-generated shell commands.

Stage explicit reviewed paths, not blanket git add. Include already-staged changes
in the review or refuse ambiguous ownership. Show destination repository, branch,
file diff, and commit message before approval. Recheck file/index/HEAD fingerprints
under the workspace lease immediately before mutation. Never publish vault data,
protected credential files, or detected credential content. Scanning reduces risk
but cannot prove every arbitrary secret is detected.

Default to feature branches. Disable force pushes, branch deletion, destructive
resets, automatic merges, and silent pushes to the default branch. Full Access
may skip ordinary action approval but must retain repository/path restrictions,
credential checks, protected-branch refusal, and all destructive-operation bans.
Push failures retain the local commit and explain recovery without duplicated
commits on retry. PR creation checks for an existing matching PR before retrying.

Tokens are never stored in remote URLs, Git config, command arguments, project
files, or Git logs. Resolve authentication inside host transport code and prohibit
redirects to another origin. Serialize Git mutations across agents in one workspace;
do not hold workspace locks while waiting for a human approval or model response.

## Components and integration boundaries

- storage.py: schema migrations and transactional project/history operations.
- New vault service: DPAPI persistence, connection scopes, secret broker/redaction.
- New service tools: authenticated API and origin-bound credential filling.
- New context service: token-aware checkpointing and archived-history retrieval.
- New GitHub service: HTTPS API, Python-native Git, repository validation.
- engine.py/models.py/shared_runtime.py: pre-generation compaction, schemas,
  reservations, cancellation, and bounded active anchors.
- api.py: narrow native bridge methods, never plaintext secret retrieval.
- ui/: vault/GitHub settings, project grouping, delete/clear actions, live feedback.
- orchestration.py/resources.py: active-run checks and serialized workspace mutations.

No old React/PWA subsystem migration, generic shell expansion, OAuth proxy changes,
or unrelated runtime redesign is included. Bundle new dependencies in the existing
PyInstaller executable and retain the current CPU/CUDA model loading behavior.

## Acceptance and verification

Unit tests cover migrations, account-protected vault round trips, scope/redirect
rejection, output redaction, deletion transactions, active-run refusals, display
watermarks, checkpoint failure recovery, tokenizer budgets, and retrieval.

Repository tests use temporary local fixtures and mocked GitHub HTTP responses:
clone, branches, explicit staging, dirty/staged conflict refusal, cancellation,
safe push retry, PR retry, path escapes, hooks, remote changes, and credential
non-disclosure. Do not push test changes to the user's repositories implicitly.

Native UI tests exercise masked settings, project/conversation controls, clearing
views, and connection feedback. Frozen executable tests verify DPAPI, bundled Git
operations, and compaction without supervision. Re-run actual Muse Glimmer CUDA
and four-stream shared-budget checks to catch inference regressions.

Live Proxmox and GitHub verification requires newly supplied scoped credentials
and explicit target authorization. Distinguish mocked/source/native/frozen evidence
from live account success. Build into a new versioned output directory, preserve
the existing executable and user data, and publish only after verification.

## Primary references

- GitHub fine-grained permissions:
  https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
- GitHub OAuth device authorization (deferred alternative):
  https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
