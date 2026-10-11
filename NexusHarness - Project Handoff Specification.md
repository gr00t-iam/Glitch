# NexusHarness — Project Handoff Specification

**Document purpose:** Give the next AI agent 100% of the technical context required to continue building NexusHarness immediately. This reflects the codebase as it stands after the current development cycle (all changes typecheck with `tsc --noEmit` and build with `vite build`, both exit 0).

---

## 1. Project Identity & Architecture Core

**App name:** NexusHarness — a local-first Progressive Web App for self-correcting, multi-agent automation. It presents a chat-driven "AI Control Hub" that can run local/cloud models, drive a real browser (CDP), operate a real shell, browse and edit the host filesystem, and manage skills/personas/memory.

### Stack
- **Frontend:** React 18 + TypeScript, Vite 7, single-page app. Styling is hand-authored CSS in `src/styles.css` driven by CSS custom properties (design tokens) with `[data-theme="dark|light"]` theming. No Tailwind/Chakra — keep additions in the same token-based CSS system.
- **Persistence (client):** Dexie (IndexedDB) in `src/db/nexusDB.ts`.
- **PWA:** `vite-plugin-pwa` (injectManifest strategy) + `src/service-worker.ts` (Workbox precache + runtime cache + offline fallback + webhook routing + push notifications).
- **Local runtime / backend:** Implemented today as a **Vite dev-server plugin** (`nexusLocalRuntime()` inside `vite.config.ts`) that registers REST middleware and a WebSocket terminal. It uses Node `fs`, `child_process`, and `node-pty`. This is the piece that must migrate to a hosted server (see below).
- **Terminal:** `xterm` + `xterm-addon-fit` (frontend) ⇄ `node-pty` (backend).
- **Realtime:** `ws` WebSocket server for the PTY stream.
- **Markdown:** `marked`.
- **Icons:** `lucide-react`.

### Core environment constraint (NEW — drives the next phase)
NexusHarness must run inside a **restricted corporate environment** where local workstations **block terminal commands and local scripts**. The legacy launch path — double-clicking **`Start NexusHarness.cmd`** to run `npm run dev` on `127.0.0.1:5173` — **is not viable** there.

**Target architecture:** a **central, remote corporate host / container** that serves the PWA and the runtime API over **`https://`** and **`wss://`**. Workstations only open the URL; all `fs`/shell/PTY/browser execution happens on the managed host.

**Migration implications (must address):**
1. **Promote the dev-server plugin to a standalone server.** The middleware in `nexusLocalRuntime()` currently only runs under `vite` dev (`configureServer`). Extract the handlers into a real server (Node/Express/Fastify, or a Vite `preview`-compatible plugin that also runs in production) so the API exists in the deployed container, not just in dev.
2. **Transport:** the terminal WS already auto-selects `wss` when `window.location.protocol === "https:"` (see `src/components/CdpCanvas.tsx` → `TerminalTab`). Keep that pattern for any new sockets. REST calls are origin-relative (`/api/...`), so they follow the host automatically — good.
3. **Pin/replace the origin:** today `vite.config.ts` hardcodes `server.port = 5173` and the PWA installs against `127.0.0.1:5173`. For remote, set `start_url`/`scope` and let the PWA install from the corporate URL. Remove or gate `Start NexusHarness.cmd` and `open-when-ready.ps1` (workstation scripts) in the corporate build.
4. **Security:** the filesystem bridge (`/api/fs/*`) and `/api/exec` operate on **absolute host paths with shell access**. On a shared remote host this MUST be hardened: per-user auth (session token on the WS + REST), per-user sandbox/jail (chroot/container/workspace root allow-list), rate limits, and an allow-list for `/api/exec`. The current code assumes a trusted single-user localhost — **do not deploy as-is to a multi-tenant host without these controls.**
5. **CORS / same-origin:** serve PWA and API from the same origin to avoid CORS and to keep cookies/tokens simple.

### High-level layout (UI)
Three-column `app-shell` CSS grid using **named grid areas** `"left center right"`:
- **Left sidebar** (`aside.left`, grid-area `left`): brand, Threads, Cost Tracker, Subtasks, etc.
- **Center canvas** (`main.center-panel`, grid-area `center`): command bar, chat stream, floating composer.
- **Right inspection panel** (`aside.right`, grid-area `right`): `CdpCanvas` with tabbed Live Browser / Terminal / Review / Files, plus Macro recorder, memory, task history.
- **Safe Mode** (`isPowerMode === false`) collapses to a single focused chat column and unmounts both sidebars.

---

## 2. Completed Diagnostics & Technical Fixes

### 2.1 Terminal tab — ANSI/VT escape-sequence leakage → real emulator
**Symptom:** the terminal printed raw control codes as literal text (`[K`, `[H`, `[?25h`, `[93m`, etc.) and was unreadable.

**Root cause:** the backend was already a real PTY (`node-pty`), so the stream was correct, but the **frontend rendered the raw PTY output into a plain `<pre>`** — which cannot interpret ANSI/VT.

**Resolution (`src/components/CdpCanvas.tsx` → `TerminalTab`):**
- Replaced the `<pre>`/`<textarea>` renderer with **`xterm.js`** (`Terminal` + `FitAddon`), `import "xterm/css/xterm.css"`.
- PTY → UI: `socket.onmessage` → `term.write(data)` (xterm parses ANSI).
- UI → PTY: `term.onData(d => socket.send({type:"input", data:d}))` (xterm encodes keys, arrows, Ctrl-C, paste).
- `ResizeObserver` + `fitAddon.fit()` → sends `{type:"resize", cols, rows}`; themed to match the app.
- **Backend (`vite.config.ts`):** `resolveShell()` chooses the shell per-OS — `powershell.exe` (`-NoLogo`) on Windows (`NEXUS_USE_CMD=1` → `cmd.exe`), `$SHELL`/`zsh`/`bash` on macOS/Linux/Android; `NEXUS_SHELL` overrides. PTY spawns with `TERM=xterm-256color`, `COLORTERM=truecolor`. Dependencies added: `xterm-addon-fit@^0.8.0`.

### 2.2 Files tab — static source view → cross-platform host file browser
**Decision:** used a **backend `fs` bridge** (not the browser File System Access API) because FSAA is Chromium-only, cannot reach whole drives, and cannot be driven by the agent.

**Backend endpoints added (`vite.config.ts`, absolute-path, localhost-trust today):**
- `GET /api/fs/roots` — drives (Windows A:–Z:), Home, project root, plus `separator`.
- `GET /api/fs/list?path=` — directory entries with absolute child paths (server does `path.join`, so platform separators are handled server-side).
- `GET /api/fs/read?path=` — file contents (≤2 MB), `binary` flag (null-byte detection via `buffer.includes(0)`).
- `POST /api/fs/write` `{path,content}`, `POST /api/fs/mkdir`, `POST /api/fs/delete`, `POST /api/fs/rename`.

**Frontend (`CdpCanvas.tsx` → `FilesTab`):** root chips (drives/Home/project) + typeable path bar + "up" button + refresh; **lazy recursive tree** (children load on expand to avoid freezing); text/binary-aware viewer. Live-refreshes on `workspace-changed` events. Path joining is server-side; the client only round-trips absolute paths.

### 2.3 Rogue overlay / blocked UI → named grid areas
**Symptom:** the entire UI appeared trapped behind a full-screen dark panel; the usable content was crushed into a ~286 px strip on the left.

**Root cause (confirmed, not an actual modal):** the `app-shell` grid used **auto-placement** with fixed tracks `286px minmax(470px,1fr) 420px`. When a sidebar was conditionally **unmounted** (Safe Mode / power toggles), the lone `center-panel` fell into the **first 286 px track**, leaving the rest as empty dark background that read as an "overlay." (All real overlays — `.modal-backdrop`, `.palette-backdrop`, `.admin-overlay`, `.skill-store-overlay` — are correctly state-gated and unmount when closed, so they were not the cause.)

**Resolution (`src/styles.css`):** assigned **named grid areas** so each region is pinned to its track regardless of which sidebars are mounted:
```css
.app-shell { grid-template-areas: "left center right"; }
.app-shell.safe-mode { grid-template-columns: 0 minmax(0,1fr) 0; grid-template-areas: "left center right"; }
.sidebar.left, aside.left { grid-area: left; }
.center-panel       { grid-area: center; min-width: 0; }
.sidebar.right, aside.right { grid-area: right; }
```
Now the center **always** occupies the wide middle column — even if a later CSS rule fails to load — so the failure mode (center stranded at 286 px) is impossible. Added a pointer-events safety net for any `[hidden]` overlay. **Note for next agent:** if a user reports this again, it is almost always a **stale running build** — they must restart the server / hard-reload so the current CSS loads.

### 2.4 Other completed fixes/features this cycle
- **Streaming responses** (`McpRouter.ts` `LLMClient.stream`) for Ollama/OpenAI/Anthropic with a Stop button and typing indicator.
- **Session management:** New chat (⌘J), rename (double-click), delete; previously impossible.
- **PWA hardening:** install prompt, online/offline badge, theme-color sync, manifest `shortcuts`/`display_override`, richer meta.
- **Theme system:** all core colors are CSS variables; working light theme + toggle, persisted pre-paint.

---

## 3. Feature Enhancements & Outstanding Build Backlog

> Items marked **DONE** were implemented this cycle and are listed for context; **TODO** items are the active backlog.

### 3.1 Review tab + agent tool-calling — partially DONE, finish wiring
**DONE:**
- Color-coded line diff viewer (additions green, deletions red, `+/-` gutter) in `CdpCanvas.tsx` → `ReviewTab`.
- `/api/workspace/diff` now renders **untracked/new files' contents as additions** (fixes the old "No line diff available yet").
- **Stage / Reject** per file: `POST /api/workspace/stage` (`git add`), `POST /api/workspace/reject` (revert tracked / delete untracked).
- **Orchestration bridge** `src/services/WorkspaceBridge.ts`: typed wrappers (`workspace.read/write/makeDir/remove/rename/exec/diff/stage/reject`), a `workspace-changed` event bus that live-refreshes Files/Review tabs, an **LLM tool schema** (`agentTools`) and an `executeAgentTool(name,args)` dispatcher, plus `window.nexusWorkspace` for runtime/manual access. Backend `POST /api/exec` runs a command and captures stdout/stderr.

**TODO (next agent):**
1. **Side-by-side diff** — current viewer is unified/inline; build a true two-pane (before|after) virtualized diff (consider `diff-match-patch` for word-level intra-line highlighting). Keep the existing `DiffFile`/`DiffLine` data shape from `/api/workspace/diff`.
2. **Close the tool-calling loop** — `agentTools` + `executeAgentTool` exist but are **not yet wired into the chat completion loop** in `App.tsx` `sendChatMessage`. Implement provider-native function calling: pass `agentTools` to the model, detect tool calls in the stream, run `executeAgentTool`, feed results back, and loop until final. Each tool mutation already emits `workspace-changed`, so Terminal/Files/Review update simultaneously — that part is done.
3. **Inline agent indicators** — `src/components/AgentActivity.tsx` already renders a sleek chip (terminal/file/skill) from `workspace-changed`; extend `classify()` and emit a skill-invocation event when wiring step 2.

### 3.2 Skill Store — 100-skill library — DONE
- `src/data/skillCatalog.ts` holds **100** `MarketplaceSkill` objects (auto-generated; regenerate from the batch script pattern documented in chat), **20 each** across **System & OS Management, File & Data Operations, Network & Diagnostics, Developer Utilities, Web APIs**.
- `MarketplaceSkill` was extended with a manifest: `osTargets`, typed `parameters[]`, and a `safety[]` array. Every skill's `systemPromptSnippet` bakes in four guardrails (validate inputs; never string-concat shell commands — pass arg arrays; reject `..`/out-of-workspace paths; confirm before destructive actions).
- `SkillStore.tsx` category nav/icons updated to the five categories.
- **TODO:** make skills *executable* manifests (bind `parameters` to `executeAgentTool` calls) once 3.1.2 lands; add install→DB enrichment for the new manifest fields.

### 3.3 Dropdown card UI (Prompts / Persona) — DONE
- Reusable `src/components/Popover.tsx`: trigger + card in one `position:relative` anchor; **outside-click + Escape** dismissal; `align` and `direction` (`up`/`down`) props.
- `src/components/HeaderMenus.tsx`: `HeaderPersonaMenu` + `HeaderPromptsMenu` — compact, anchored under the buttons, **lighter elevated card** (`#1d2a3a` dark / white light), hairline border, strong shadow, high contrast; each has a "Manage…" link to the full modal.
- **TODO (optional):** viewport-edge collision handling (flip/clamp) if buttons move near screen edges.

### 3.4 Safe Mode simplification — DONE
- Driven by a single `isPowerMode` check. Safe Mode unmounts both sidebars and the power-only command-bar buttons; centers an ~820 px focused chat column.
- Composer rebuilt: **microphone dictation icon inside the input** (`src/components/ComposerTools.tsx` `MicButton`, Web Speech API) and a **`+` menu** (`ComposerPlusMenu`) for attach (Photo/PDF/Spreadsheet via filtered file pickers), **Skills & connectors**, and the three frameworks — **Deep Research, Guided Learning, Personal Intelligence** (`FRAMEWORK_SCAFFOLDS` prepend prompt scaffolds).
- **TODO:** real multimodal attachment handling (today text files inject content, binaries inject a labeled reference) — depends on the chosen model's vision/file support.

### 3.5 Settings & Memory Hub — DONE
- `src/components/AdminHub.tsx` rebuilt into a **card-grid dashboard** with a left tab rail: Model Manager, **Persistent Memory**, Cloud API Keys, Chat Integrations, Runtime Logs.
- **Persistent Memory Manager:** split-pane Markdown editor + live `marked` preview + **Save Memory**, backed by **`GET/POST /api/memory`** which reads/writes **`Persistent Memory.MD`** in the project root.
- Model grid shows **Active/Idle** status tags; key cards have **show/hide** toggles and **color-coded verification badges**; tooltips on the forms.
- **TODO:** load `Persistent Memory.MD` into the assistant's system context on each chat so edits actually change behavior; reconcile the file-based memory with the existing IndexedDB `MEMORY.md` skill card.

---

## 4. Development Constraints

- **CRITICAL FORMATTING RULE:** When delivering a code fix or feature, output the **entire, unified file in a single continuous markdown code block** (no fractured snippets), so it can be copied and run directly. Do not hand back partial diffs that require manual assembly.
- **Keep the token-based CSS system** (`src/styles.css` + CSS variables + `[data-theme]`). Do not introduce a CSS framework.
- **Same-origin, relative API paths** (`/api/...`) and protocol-aware sockets (`wss` when `https`). Never hardcode `127.0.0.1` in new client code.
- **Type-safety gate:** every change must pass `npx tsc --noEmit` and `npx vite build` before it's considered done.
- **Security-first for host execution:** any new `fs`/shell/PTY surface must add input validation, path-traversal rejection, and (for remote multi-tenant) auth + sandboxing before deployment.

---

## Appendix A — Source map (key files)

| File | Responsibility |
|---|---|
| `vite.config.ts` | Dev-server plugin = the **backend runtime**: all `/api/*` REST + the PTY WebSocket. **Promote to a standalone hosted server for remote deploy.** |
| `src/App.tsx` | Root layout, chat loop, sessions, modes, command bar, composer wiring. |
| `src/db/nexusDB.ts` | Dexie schema + helpers (sessions, trajectories, skills, integrations, vault, staticRules, episodicMemory, runtimePointers, **prompts**, **presets**); export/import workspace. |
| `src/services/McpRouter.ts` | `LLMClient` (Ollama/OpenAI/Anthropic, streaming + buffered) and `McpRouter` (MCP tool routing). |
| `src/services/WorkspaceBridge.ts` | Unified fs/terminal/review bridge + agent tool schema + `workspace-changed` event bus. |
| `src/components/CdpCanvas.tsx` | Right panel: Live Browser (CDP), **Terminal (xterm)**, **Review (diff)**, **Files (fs browser)**. |
| `src/components/AdminHub.tsx` | Settings dashboard + Persistent Memory Manager. |
| `src/components/SkillStore.tsx` + `src/data/skillCatalog.ts` | Skill marketplace UI + 100-skill catalog. |
| `src/components/Popover.tsx`, `HeaderMenus.tsx`, `ComposerTools.tsx`, `AgentActivity.tsx`, `CommandPalette.tsx`, `PromptLibrary.tsx`, `PresetPicker.tsx`, `Toast.tsx` | UI subsystems (anchored menus, composer mic/+, agent chips, palette, prompt/persona managers, toasts). |
| `src/service-worker.ts` | PWA precache/runtime cache, offline fallback, webhook routing, push. |
| `src/workers/gapaWorker.ts` | Self-correction / persistence-intent worker. |

## Appendix B — Backend endpoint inventory (current)
```
POST /api/agent/message        POST /api/agent/confirm
POST /api/browser/launch       GET  /api/browser/status
GET  /api/workspace/tree       GET  /api/workspace/file
GET  /api/workspace/diff       POST /api/workspace/stage     POST /api/workspace/reject
WS   /api/workspace/terminal   (node-pty; auto ws/wss)
GET  /api/fs/roots             GET  /api/fs/list     GET  /api/fs/read
POST /api/fs/write             POST /api/fs/mkdir    POST /api/fs/delete   POST /api/fs/rename
POST /api/exec                 GET/POST /api/memory   (Persistent Memory.MD)
/ollama/*  -> proxy 127.0.0.1:11434      /cdp/*  -> proxy 127.0.0.1:9222
```

## Appendix C — Build & run (current local; replace for remote)
```
npm install
npm run dev      # Vite dev server on 127.0.0.1:5173 (hosts the runtime API)
npm run build    # tsc + vite build -> dist/
```
For the corporate remote target: containerize a Node server that serves `dist/` **and** mounts the `nexusLocalRuntime` handlers + PTY WS, behind TLS (`https`/`wss`) with auth. Retire `Start NexusHarness.cmd` / `open-when-ready.ps1` for that environment.
