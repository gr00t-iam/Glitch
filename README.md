# NexusHarness

NexusHarness is a local-first UI for running local LLM harnesses and guarded autonomous agent workflows.

## Desktop Agent Runtime

NexusHarness now ships as a Windows desktop shell backed by Electron and the existing Vite/React UI. The browser renderer never receives raw Node.js access; local filesystem and shell work are routed through `desktop/main.cjs`, `desktop/preload.cjs`, and the guarded runtime modules under `desktop/runtime`.

### Architecture

```text
desktop/main.cjs
  Creates the Windows desktop shell and owns all IPC handlers.

desktop/preload.cjs
  Exposes a small, typed `window.nexusDesktop` API to the React renderer.

desktop/runtime/agentLoop.cjs
  Runs the hybrid supervisor-worker loop. Ollama is the local worker. Hybrid mode injects cloud supervisor directives when configured.

desktop/runtime/tools.cjs
  Provides guarded workspace tools: list files, read files, write files, PowerShell command execution, and git diff.

desktop/runtime/triggerMonitor.cjs
  Triggers supervisor audits on tool errors, repeated actions, and every configured number of tool steps.

desktop/runtime/supervisorBridge.cjs
  Calls an OpenRouter-compatible chat-completions endpoint and returns a Course Correction Directive.
```

### Run Locally On Windows

1. Install dependencies:

```powershell
npm install
```

2. Start Ollama and make sure the configured local model is available:

```powershell
ollama pull llama3
ollama serve
```

3. Launch NexusHarness as a desktop app:

```powershell
npm run desktop
```

The app builds the production renderer, opens the desktop shell, and lets you choose a local workspace folder from the sidebar.

### Hybrid Supervisor Mode

Open **Settings**, switch mode to **Hybrid supervisor**, and save an OpenRouter-compatible API key. The key is stored in Electron user data, not in browser localStorage. The supervisor checks the local worker after repeated actions, tool errors, and the configured step interval. If the supervisor detects drift, it returns a **Course Correction Directive**, which is injected into the next local worker prompt.

### Safety Gates

File writes and shell commands are gated by default. The desktop shell shows an approval dialog with the exact file path or PowerShell command before execution. Dangerous shell patterns such as recursive deletion, shutdown, registry deletion, disk partitioning, and formatting are blocked by local policy before approval.

## UI Layout

NexusHarness now centers the main workspace as the primary surface on desktop, with a 280px left sidebar that can collapse to a 64px icon rail. The workspace uses the elevated dark surface token `--surface-elevated` and a subtle shadow so chat, browser tasks, and terminal output stay visually grouped.

The floating workspace action bar exposes the highest-frequency controls:

- Send
- Run Browser Task
- Switch Brain
- Undo Agent Action
- Dock or undock Runtime Terminal

The left sidebar is grouped into collapsible panels for Threads, Execution Plan, Activity Log, and Cost Tracker. Panel collapse, pin, and order state is stored in `localStorage` under `NEXUS_SIDEBAR_GROUP_STATE`.

At widths below 900px, the sidebar collapses to the icon rail and the terminal docks under the workspace by default. The terminal can also run as a floating window on larger screens.

## Keyboard And Accessibility

All interactive controls use a visible keyboard focus ring:

```css
outline: 3px solid var(--focus-color);
outline-offset: 2px;
```

Main panels are labeled with `role="region"` and `aria-label`. Browser connection changes and Activity Log updates are announced with polite live regions.

Useful shortcuts:

- `Enter`: send the current message when the composer is focused
- Command palette button: opens the workspace command palette
- Sidebar panel title buttons: collapse or expand a panel
- Sidebar reorder buttons: move a panel up or down
