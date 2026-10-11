# Glitch: One Shared Model, Up To Four Sub-Agents

Status: Design proposed for user review. Not implemented in Glitch 1.1.2.

## Intent

The user selected **Share one model across up to four agents**. Glitch must remain a double-click Windows application with no user-managed server, terminal, Ollama or LM Studio dependency. Independent agent histories must not become four copies of the model weights. Parallel generation must be real, not four UI panels backed by a serial queue.

## Runtime

- Bundle a pinned Windows CPU build of llama.cpp's `llama-server` and required DLLs in the executable. Verify the upstream archive checksum in local and CI builds and retain its license. Glitch starts and stops its private child automatically.
- Load the selected GGUF once. Configure 1-4 continuous-batching inference slots. Each slot has independent request state; all slots use the same weights. Default to one slot to preserve current memory requirements.
- Keep configured context length **per agent**, not divided silently by the slot count. Allocate the appropriate total context pool for the pinned server version. Show the total token-cache allocation before loading. Four 65,535-token slots require a much larger cache than one; shared weights do not eliminate cache memory.
- Bind only to loopback, authenticate every request with a random per-launch secret, disable public UI access and proxy/environment redirects, and expose no endpoint to Discord clients. The frontend communicates only through the existing native bridge.
- Reject startup if the binary, GGUF, context allocation or endpoint health check fails. Never silently fall back to sequential generation and label it parallel.

The upstream implementation documents parallel slots and shared batching in [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/tree/master/tools/server). Pin and test a specific version; do not build against changing `master` behavior.

## Agent Orchestration

- Replace the single global `running_session` with a registry of at most four active runs. Each run owns its task, conversation ID, timeline cursor, cancellation state, pending approval and supervisor trigger monitor.
- Settings provide **Parallel streams: 1 / 2 / 3 / 4**. Model settings cannot change while any run is active. Changing stream capacity requires unloading/reloading the shared model.
- Provide a **Sub-agents** deck with role/name, task, live state, last action, Open conversation and Stop controls. A parent agent can delegate using a validated `spawn_subagent` tool. Children return verified results to their parent without leaking sibling histories.
- Count the parent against the four-run limit. Do not permit recursive spawning. Queue or reject excess delegation visibly. A waiting parent must not deadlock with occupied slots; completed child results release capacity before the parent resumes inference.
- Cancel one run by closing its generation request and releasing its slot, without terminating the server or other agents. Application-wide Stop cancels all runs and pending approvals. Shutdown terminates the owned child process tree.

## Execution Safety

- Full Access remains an explicit user setting, independent of model or supervisor mode. All existing tool argument validation, protected paths and command allowlists stay enforced.
- Computer-use tools share one host desktop. Serialize complete mouse/keyboard/browser operations with a cancellation-aware resource lock. Never allow two agents to type or click concurrently.
- Serialize writes by resolved destination path, recheck file contents after acquiring the lock and retain atomic replacement/conflict checks. Do not hold write or desktop locks while waiting for approval.
- Pending approvals are identified by run and action, not a single global pending value. An approval cannot authorize a different run. Stop/denial wins over auto-approval or late callbacks.
- Preserve Discord owner/channel checks and route commands, screenshots and approval responses to the correct run. Remote task admission obeys the same four-run limit.

## UI

- Model Manager shows loaded model, available/occupied streams, per-agent context and total cache allocation. Keep the selected model visible without truncating critical controls.
- Sub-agents show live independent timelines and readable waiting/loading/running/needs-approval/completed/error states. Parent and child relationships remain visible.
- Existing primary chat, model library, larger-context settings, save-and-close and permission controls remain functional. No new terminal window or manual launch command.

## Required Evidence Before Shipping

1. Four overlapping generation requests against one server PID and one GGUF load; server slot telemetry proves concurrent activity.
2. A fifth request is bounded and cannot create a fifth agent. A parent waiting on children cannot deadlock.
3. Cancel one stream while three continue, then reuse its slot.
4. Distinct prompt histories and supervisor anchors remain isolated after restart.
5. Conflicting writes are detected; desktop input cannot overlap; approvals remain correctly scoped.
6. Native UI tests exercise creation, selection, streaming, Stop and settings behavior.
7. Frozen executable repeats the real-model concurrency and shutdown tests. User's 30B model is an optional, separately authorized hardware-capacity test, not replaced by tiny-model proof.

## Delivery Boundary

The existing llama-cpp-python worker is serial. A small worker-pool patch would either serialize inference or load separate model instances and would not meet the requested shared-weight parallel behavior. Implement this as a dedicated runtime migration after design approval, then package and publish a new release. Do not advertise sub-agents in the current release until the evidence above passes.
