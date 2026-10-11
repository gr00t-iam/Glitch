import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  GitBranch,
  KeyRound,
  Loader2,
  MessageSquareText,
  Play,
  Save,
  Settings,
  ShieldAlert,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import type { ApprovalRequest, DesktopSettings, TimelineEvent } from "./desktop-api";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
};

const defaultSettings: DesktopSettings = {
  mode: "local",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "llama3",
  supervisorProvider: "openrouter",
  supervisorBaseUrl: "https://openrouter.ai/api/v1",
  supervisorModel: "anthropic/claude-3.5-sonnet",
  supervisorApiKeySaved: false,
  requireApprovalForWrites: true,
  requireApprovalForShell: true,
  supervisorEverySteps: 5,
  maxSteps: 12,
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function eventTone(type: TimelineEvent["type"]): string {
  if (type.includes("error")) return "danger";
  if (type.includes("approval")) return "warning";
  if (type.includes("supervisor")) return "violet";
  if (type.includes("finished")) return "success";
  return "neutral";
}

export default function DesktopApp(): JSX.Element {
  const [workspacePath, setWorkspacePath] = useState("");
  const [settings, setSettings] = useState<DesktopSettings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Choose a workspace, confirm your AI backend, and describe the task. Glitch will run locally and ask before risky actions.",
      timestamp: Date.now(),
    },
  ]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<DesktopSettings & { supervisorApiKey?: string }>({
    ...defaultSettings,
    supervisorApiKey: "",
  });

  const desktopReady = Boolean(window.nexusDesktop);

  useEffect(() => {
    if (!window.nexusDesktop) return;
    void window.nexusDesktop.getSettings().then((stored) => {
      setSettings(stored);
      setSettingsDraft({ ...stored, supervisorApiKey: "" });
    });

    const offEvent = window.nexusDesktop.onAgentEvent((event) => {
      setTimeline((current) => [event, ...current].slice(0, 200));
      if (event.type === "agent.message" && event.detail) {
        setMessages((current) => [
          ...current,
          { id: event.id, role: "assistant", content: event.detail ?? "", timestamp: event.timestamp },
        ]);
      }
      if (event.type === "agent.started") setIsRunning(true);
      if (event.type === "agent.finished" || event.type === "runtime.error") setIsRunning(false);
    });
    const offApproval = window.nexusDesktop.onApprovalRequest(setApproval);
    return () => {
      offEvent();
      offApproval();
    };
  }, []);

  const supervisorLabel = useMemo(() => {
    if (settings.mode === "local") return "Local only";
    return settings.supervisorApiKeySaved ? "Hybrid supervisor ready" : "Hybrid mode needs API key";
  }, [settings]);

  async function handleSelectWorkspace(): Promise<void> {
    if (!window.nexusDesktop) return;
    const selected = await window.nexusDesktop.selectWorkspace();
    if (selected) {
      setWorkspacePath(selected);
      setTimeline((current) => [
        {
          id: createId("workspace"),
          timestamp: Date.now(),
          type: "agent.message",
          title: "Workspace selected",
          detail: selected,
        },
        ...current,
      ]);
    }
  }

  async function handleRun(): Promise<void> {
    const value = prompt.trim();
    if (!value || isRunning) return;
    setPrompt("");
    setMessages((current) => [
      ...current,
      { id: createId("user"), role: "user", content: value, timestamp: Date.now() },
    ]);

    if (!window.nexusDesktop) {
      setMessages((current) => [
        ...current,
        {
          id: createId("system"),
          role: "system",
          content: "Desktop runtime is not available. Run Glitch through the desktop shell.",
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    const result = await window.nexusDesktop.startAgent({ prompt: value, workspacePath });
    if (!result.ok) {
      setIsRunning(false);
      setTimeline((current) => [
        {
          id: createId("runtime"),
          timestamp: Date.now(),
          type: "runtime.error",
          title: "Agent could not start",
          detail: result.error,
        },
        ...current,
      ]);
    }
  }

  async function handleApproval(approved: boolean): Promise<void> {
    if (!approval || !window.nexusDesktop) return;
    await window.nexusDesktop.resolveApproval(approval.id, approved);
    setApproval(null);
  }

  async function saveSettings(): Promise<void> {
    if (!window.nexusDesktop) return;
    const saved = await window.nexusDesktop.saveSettings(settingsDraft);
    setSettings(saved);
    setSettingsDraft({ ...saved, supervisorApiKey: "" });
    setSettingsOpen(false);
  }

  return (
    <div className={`desktop-shell ${settings.mode === "hybrid" ? "hybrid-active" : ""}`}>
      <aside className="desktop-sidebar">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">G</div>
          <div>
            <strong>Glitch</strong>
            <span>Autonomous desktop agent</span>
          </div>
        </div>

        <section className="side-card">
          <div className="side-card-title">
            <FolderOpen size={16} />
            Workspace
          </div>
          <button className="primary-action full" onClick={handleSelectWorkspace}>
            Choose Folder
          </button>
          <div className="workspace-path">{workspacePath || "No workspace selected"}</div>
        </section>

        <section className="side-card">
          <div className="side-card-title">
            <Bot size={16} />
            Agent Mode
          </div>
          <div className="mode-pill">{settings.mode === "hybrid" ? "Hybrid Supervisor + Worker" : "Local Worker"}</div>
          <p>{supervisorLabel}</p>
        </section>

        <section className="side-card grow">
          <div className="side-card-title">
            <GitBranch size={16} />
            Project Flow
          </div>
          <ol className="flow-list">
            <li>Local model proposes the next step.</li>
            <li>Risky file or shell actions pause for approval.</li>
            <li>Supervisor audits errors, loops, and every {settings.supervisorEverySteps} tool steps.</li>
            <li>Course corrections are injected before the next local step.</li>
          </ol>
        </section>
      </aside>

      <main className="desktop-main">
        <header className="desktop-topbar">
          <div>
            <span className="eyebrow">Runtime</span>
            <h1>Hybrid Supervisor-Worker Workspace</h1>
          </div>
          <div className="topbar-actions">
            <div className="status-chip">
              <span className={`dot ${desktopReady ? "ok" : "bad"}`} />
              {desktopReady ? "Desktop runtime connected" : "Browser preview only"}
            </div>
            <button className="ghost-button" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} />
              Settings
            </button>
          </div>
        </header>

        <section className="chat-grid">
          <div className="chat-panel">
            <div className="panel-title">
              <MessageSquareText size={17} />
              Chat
            </div>
            <div className="message-list">
              {messages.map((message) => (
                <article className={`message-bubble ${message.role}`} key={message.id}>
                  <div className="message-meta">{message.role.toUpperCase()} · {formatTime(message.timestamp)}</div>
                  <p>{message.content}</p>
                </article>
              ))}
            </div>
            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                void handleRun();
              }}
            >
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask Glitch to inspect, edit, test, or explain your workspace..."
                rows={2}
              />
              <button className="send-button" disabled={isRunning || !prompt.trim()}>
                {isRunning ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                Run
              </button>
            </form>
          </div>

          <div className="timeline-panel">
            <div className="panel-title">
              <Terminal size={17} />
              Execution Timeline
            </div>
            <div className="timeline-list">
              {timeline.length === 0 ? (
                <div className="empty-state">No actions recorded yet.</div>
              ) : (
                timeline.map((event) => (
                  <article className={`timeline-event ${eventTone(event.type)}`} key={event.id}>
                    <div className="timeline-icon">
                      {event.type.includes("finished") ? <CheckCircle2 size={15} /> : <ChevronRight size={15} />}
                    </div>
                    <div>
                      <div className="timeline-heading">
                        <strong>{event.title}</strong>
                        <span>{formatTime(event.timestamp)}</span>
                      </div>
                      {event.detail ? <p>{event.detail}</p> : null}
                      {event.payload ? <pre>{JSON.stringify(event.payload, null, 2)}</pre> : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      </main>

      {settingsOpen ? (
        <div className="settings-backdrop" role="dialog" aria-modal="true">
          <section className="settings-panel">
            <div className="settings-header">
              <div>
                <span className="eyebrow">Core Runtime</span>
                <h2>Settings</h2>
              </div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                <X size={18} />
              </button>
            </div>

            <div className="settings-grid">
              <label className="field">
                Mode
                <select
                  value={settingsDraft.mode}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, mode: event.target.value as DesktopSettings["mode"] }))
                  }
                >
                  <option value="local">Local only</option>
                  <option value="hybrid">Hybrid supervisor</option>
                </select>
              </label>
              <label className="field">
                Ollama URL
                <input
                  value={settingsDraft.ollamaBaseUrl}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, ollamaBaseUrl: event.target.value }))}
                />
              </label>
              <label className="field">
                Local model
                <input
                  value={settingsDraft.ollamaModel}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, ollamaModel: event.target.value }))}
                />
              </label>
              <label className="field">
                Supervisor model
                <input
                  value={settingsDraft.supervisorModel}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, supervisorModel: event.target.value }))
                  }
                />
              </label>
              <label className="field span-2">
                Supervisor API key
                <div className="key-row">
                  <KeyRound size={16} />
                  <input
                    type="password"
                    placeholder={settings.supervisorApiKeySaved ? "Saved. Leave blank to keep current key." : "OpenRouter API key"}
                    value={settingsDraft.supervisorApiKey ?? ""}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({ ...current, supervisorApiKey: event.target.value }))
                    }
                  />
                </div>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={settingsDraft.requireApprovalForWrites}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, requireApprovalForWrites: event.target.checked }))
                  }
                />
                Ask before writing files
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={settingsDraft.requireApprovalForShell}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, requireApprovalForShell: event.target.checked }))
                  }
                />
                Ask before shell commands
              </label>
            </div>

            <button className="primary-action" onClick={saveSettings}>
              <Save size={16} />
              Save Settings
            </button>
          </section>
        </div>
      ) : null}

      {approval ? (
        <div className="approval-overlay" role="alertdialog" aria-modal="true">
          <section className="approval-card">
            <ShieldAlert size={26} />
            <h2>Approve this action?</h2>
            <p>{approval.reason}</p>
            <pre>{JSON.stringify(approval.payload, null, 2)}</pre>
            <div className="approval-actions">
              <button className="ghost-button" onClick={() => void handleApproval(false)}>
                Abort & Rewrite
              </button>
              <button className="danger-action" onClick={() => void handleApproval(true)}>
                Approve Action
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {settings.mode === "hybrid" ? (
        <div className="hybrid-glow">
          <Sparkles size={14} />
          Supervisor enabled
        </div>
      ) : null}
    </div>
  );
}
