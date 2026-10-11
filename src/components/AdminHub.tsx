import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  BrainCircuit,
  Check,
  Code2,
  Database,
  Download,
  Eye,
  EyeOff,
  Github,
  Globe2,
  Hammer,
  Info,
  KeyRound,
  MessageCircle,
  Network,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  PlugZap,
  X,
} from "lucide-react";
import { marked } from "marked";
import { ChatPlatform, maskSecretValue, StaticRule, VaultSecret } from "../db/nexusDB";
import { SettingsPage } from "../pages/Settings";
import { isChatHistoryMemoryEnabled, setChatHistoryMemoryEnabled } from "../services/MemoryPreferences";
import type { ResetScope } from "./Usage";
import type { PluginToolSchema } from "./PluginsHub";
import type { StandardToolDefinition } from "../services/McpRouter";
import { OllamaProgressEvent, findOllamaRuntime, normalizeModelIdentifier, ollamaFetch, readOllamaError } from "../services/OllamaRuntime";
import { runtimeJson } from "../services/RemoteRuntime";

export interface RuntimeLogEntry {
  id: string;
  at: number;
  source: "app" | "service-worker" | "model" | "chat" | "browser";
  message: string;
}

export interface AdminIntegrationState {
  platform: ChatPlatform;
  isActive: boolean;
  botToken: string;
  webhookUrl: string;
}

export interface LocalModelInfo {
  id: string;
  name: string;
  size: number;
  modifiedAt?: string;
  details?: {
    family?: string;
    parameterSize?: string;
    quantizationLevel?: string;
  };
}

export type SubAgentStatus = "Idle" | "Downloading" | "Active" | "Running";

export interface SubAgentProfile {
  id: string;
  name: string;
  description: string;
  specialization: string;
  status: SubAgentStatus;
  contextLimit: number;
  currentTask: string;
  sharedPayload?: string;
}

interface SafetySettings {
  shellCommands: boolean;
  fileDeletions: boolean;
  networkOverwrites: boolean;
  audibleAlerts: boolean;
}

interface AdminHubProps {
  activeModel: string;
  downloadedModels: LocalModelInfo[];
  integrations: AdminIntegrationState[];
  logs: RuntimeLogEntry[];
  tools: StandardToolDefinition[];
  pluginTools: PluginToolSchema[];
  staticRules: StaticRule[];
  vaultSecrets: VaultSecret[];
  isPowerMode: boolean;
  safetySettings: SafetySettings;
  tokenBudget: number;
  tokensUsed: number;
  subAgents: SubAgentProfile[];
  onClose: () => void;
  onModelChange: (model: string) => Promise<void>;
  onModelDeleted: (modelId: string) => void;
  onModelsRefresh: () => Promise<void>;
  onIntegrationChange: (platform: ChatPlatform, patch: Partial<AdminIntegrationState>) => void;
  onIntegrationSave: (form: AdminIntegrationState) => Promise<void>;
  onRuntimeLog: (source: RuntimeLogEntry["source"], message: string) => void;
  onResetTokenUsage: () => Promise<void>;
  onSafetySettingChange: (key: keyof SafetySettings, value: boolean) => void;
  onStaticRuleDelete: (ruleId: string) => Promise<void>;
  onStaticRuleUrlChange: (rule: StaticRule, targetUrl: string) => Promise<void>;
  onVaultSecretDelete: (secretId: string) => Promise<void>;
  onSubAgentDeploy: (agentId: string) => void;
  onSubAgentTerminate: (agentId: string) => void;
  onSubAgentContextLimitChange: (agentId: string, contextLimit: number) => void;
}

type AdminTab = "models" | "github" | "integrationsMemory" | "memory" | "neural" | "keys" | "chat" | "safety" | "logs";
type KeyStatus = "unknown" | "checking" | "valid" | "missing" | "invalid";
type GitHubStatus = "unknown" | "checking" | "connected" | "missing" | "invalid";

const platformLabels: Record<ChatPlatform, string> = {
  discord: "Discord",
  slack: "Slack",
  whatsapp: "WhatsApp",
};

const providerKeyStorage: Record<"openai" | "anthropic", string> = {
  openai: "NEXUS_OPENAI_API_KEY",
  anthropic: "NEXUS_ANTHROPIC_API_KEY",
};

const tabs: Array<{ id: AdminTab; label: string; Icon: typeof Download }> = [
  { id: "models", label: "Model Manager", Icon: Download },
  { id: "github", label: "GitHub Connections", Icon: Github },
  { id: "integrationsMemory", label: "Integrations & System Memory", Icon: Database },
  { id: "memory", label: "Persistent Memory", Icon: BrainCircuit },
  { id: "neural", label: "Neural Network", Icon: Network },
  { id: "keys", label: "Cloud API Keys", Icon: KeyRound },
  { id: "chat", label: "Chat Integrations", Icon: MessageCircle },
  { id: "safety", label: "Safety Breakpoints", Icon: ShieldCheck },
  { id: "logs", label: "Runtime Logs", Icon: Server },
];

const demoNeuronActivity = [0.12, 0.28, 0.44, 0.67, 0.82, 0.96, 0.38, 0.74, 0.53, 0.9, 0.21, 0.62];
const LivingBrainCanvas = lazy(() =>
  import("./NeuralNetwork/LivingBrainCanvas").then((module) => ({ default: module.LivingBrainCanvas })),
);

export function AdminHub({
  activeModel,
  downloadedModels,
  integrations,
  logs,
  tools,
  pluginTools,
  staticRules,
  vaultSecrets,
  isPowerMode,
  safetySettings,
  tokenBudget,
  tokensUsed,
  subAgents,
  onClose,
  onModelChange,
  onModelDeleted,
  onModelsRefresh,
  onIntegrationChange,
  onIntegrationSave,
  onRuntimeLog,
  onResetTokenUsage,
  onSafetySettingChange,
  onStaticRuleDelete,
  onStaticRuleUrlChange,
  onVaultSecretDelete,
  onSubAgentDeploy,
  onSubAgentTerminate,
  onSubAgentContextLimitChange,
}: AdminHubProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("models");
  const [modelIdentifier, setModelIdentifier] = useState("llama3");
  const [pullStatus, setPullStatus] = useState("Paste any Ollama, Hugging Face, or GGUF model identifier.");
  const [pullProgress, setPullProgress] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [customName, setCustomName] = useState("browser-helper");
  const [baseModel, setBaseModel] = useState("llama3");
  const [systemPrompt, setSystemPrompt] = useState("You are a careful browser automation assistant. Ask before risky actions.");
  const [temperature, setTemperature] = useState(0.2);
  const [contextLength, setContextLength] = useState(8192);
  const [stopTokens, setStopTokens] = useState("<|eot_id|>");
  const [buildStatus, setBuildStatus] = useState("Ready to create a custom AI Brain.");
  const [buildProgress, setBuildProgress] = useState(0);
  const [isBuilding, setIsBuilding] = useState(false);
  const [providerKeys, setProviderKeys] = useState(() => ({
    openai: localStorage.getItem(providerKeyStorage.openai) ?? "",
    anthropic: localStorage.getItem(providerKeyStorage.anthropic) ?? "",
  }));
  const [revealKey, setRevealKey] = useState<Record<"openai" | "anthropic", boolean>>({ openai: false, anthropic: false });
  const [keyStatus, setKeyStatus] = useState<Record<"openai" | "anthropic", KeyStatus>>({
    openai: providerKeys.openai ? "unknown" : "missing",
    anthropic: providerKeys.anthropic ? "unknown" : "missing",
  });
  const [githubForm, setGithubForm] = useState({ token: "", owner: "", repo: "" });
  const [githubStatus, setGithubStatus] = useState<GitHubStatus>("unknown");
  const [githubStatusText, setGithubStatusText] = useState("Not checked yet.");
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [pendingDeleteModel, setPendingDeleteModel] = useState<LocalModelInfo | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [deleteModelStatus, setDeleteModelStatus] = useState("");

  // ---- Persistent Memory.MD ----
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  const [memoryDirty, setMemoryDirty] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState("Loading Persistent Memory.MD…");
  const [rememberChatHistory, setRememberChatHistory] = useState(isChatHistoryMemoryEnabled);

  useEffect(() => {
    void (async () => {
      try {
        const payload = await runtimeJson<{ ok: boolean; content?: string; error?: string }>("/api/memory", {
          retries: 2,
          timeoutMs: 12000,
        });
        if (!payload.ok) throw new Error(payload.error ?? "Could not read memory.");
        setMemoryContent(payload.content ?? "");
        setMemoryStatus("Loaded from Persistent Memory.MD");
      } catch (error) {
        setMemoryStatus(error instanceof Error ? error.message : "Could not read Persistent Memory.MD.");
      } finally {
        setMemoryLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    void loadGitHubStatus();
  }, []);

  async function saveMemory() {
    setMemorySaving(true);
    setMemoryStatus("Saving…");
    try {
      const payload = await runtimeJson<{ ok: boolean; error?: string }>("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: memoryContent }),
        retries: 1,
        timeoutMs: 16000,
      });
      if (!payload.ok) throw new Error(payload.error ?? "Save failed.");
      setMemoryDirty(false);
      setMemoryStatus(`Saved at ${new Date().toLocaleTimeString()}`);
      onRuntimeLog("app", "Persistent Memory.MD updated.");
    } catch (error) {
      setMemoryStatus(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setMemorySaving(false);
    }
  }

  const memoryPreview = useMemo(() => marked.parse(memoryContent || "_Nothing saved yet._", { async: false }) as string, [memoryContent]);
  const origin = typeof window === "undefined" ? "https://your-pwa-domain" : window.location.origin;
  const sortedLogs = useMemo(() => logs.slice(-120).reverse(), [logs]);
  const baseOptions = downloadedModels.length > 0 ? downloadedModels : [{ id: "llama3", name: "llama3", size: 0 }];
  const tokenPercent = Math.min(100, Math.round((tokensUsed / tokenBudget) * 100));
  const activeSubAgentCount = subAgents.filter((agent) => agent.status === "Active" || agent.status === "Running").length;

  async function pullModel() {
    const model = normalizeModelIdentifier(modelIdentifier);
    if (!model) return;
    setIsPulling(true);
    setPullProgress(1);
    setPullStatus("Checking local model engine…");
    onRuntimeLog("model", `Pull requested for ${model}.`);
    try {
      const runtime = await findOllamaRuntime();
      setPullStatus(`Connected through ${runtime.label}. Starting ${model}…`);
      const response = await fetch(`${runtime.baseUrl}/api/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: true }),
      });
      if (!response.ok) throw new Error(await readOllamaError(response));
      await streamOllamaProgress(response, setPullProgress, setPullStatus, (message) => onRuntimeLog("model", message));
      setPullProgress(100);
      setPullStatus(`${model} is ready.`);
      await onModelsRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed.";
      setPullProgress(0);
      setPullStatus(message);
      onRuntimeLog("model", `Download failed: ${message}`);
    } finally {
      setIsPulling(false);
    }
  }

  async function buildCustomModel() {
    const name = customName.trim();
    if (!name || !baseModel.trim()) return;
    const modelfile = [
      `FROM ${baseModel.trim()}`,
      `SYSTEM """${systemPrompt.trim()}"""`,
      `PARAMETER temperature ${temperature}`,
      `PARAMETER num_ctx ${contextLength}`,
      ...stopTokens
        .split("\n")
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => `PARAMETER stop "${token}"`),
    ].join("\n");

    setIsBuilding(true);
    setBuildProgress(1);
    setBuildStatus(`Baking ${name}…`);
    onRuntimeLog("model", `Creating custom AI Brain "${name}".`);
    try {
      const response = await ollamaFetch("/api/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: name, modelfile, stream: true }),
      });
      if (!response.ok) throw new Error(await readOllamaError(response));
      await streamOllamaProgress(response, setBuildProgress, setBuildStatus, (message) => onRuntimeLog("model", message));
      setBuildProgress(100);
      setBuildStatus(`${name} is ready.`);
      await onModelsRefresh();
      await onModelChange(name);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Custom brain build failed.";
      setBuildProgress(0);
      setBuildStatus(message);
      onRuntimeLog("model", `Custom brain build failed: ${message}`);
    } finally {
      setIsBuilding(false);
    }
  }

  async function deleteModel(model: LocalModelInfo): Promise<void> {
    const modelName = model.id || model.name;
    if (!modelName || isActiveModel(model, activeModel)) return;
    setDeletingModelId(model.id);
    setDeleteModelStatus(`Deleting ${modelName}...`);
    onRuntimeLog("model", `Delete requested for ${modelName}.`);
    try {
      const payload = await runtimeJson<{ ok: boolean; deleted?: boolean; name?: string; message?: string; error?: string }>("/api/models/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: modelName }),
        retries: 1,
        timeoutMs: 130000,
      });
      if (!payload.ok) throw new Error(payload.error ?? "Model deletion failed.");
      onModelDeleted(model.id);
      setPendingDeleteModel(null);
      setDeleteModelStatus("");
      onRuntimeLog("model", payload.message ?? `${modelName} deleted.`);
      await onModelsRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Model deletion failed.";
      setDeleteModelStatus(message);
      onRuntimeLog("model", `Delete failed: ${message}`);
    } finally {
      setDeletingModelId(null);
    }
  }

  async function validateProvider(provider: "openai" | "anthropic") {
    const key = providerKeys[provider].trim();
    if (!key) {
      setKeyStatus((current) => ({ ...current, [provider]: "missing" }));
      return;
    }
    localStorage.setItem(providerKeyStorage[provider], key);
    setKeyStatus((current) => ({ ...current, [provider]: "checking" }));
    onRuntimeLog("model", `Checking ${provider === "openai" ? "OpenAI" : "Anthropic"} key.`);
    try {
      const response =
        provider === "openai"
          ? await fetch("https://api.openai.com/v1/models/gpt-4o", { headers: { authorization: `Bearer ${key}` } })
          : await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model: "claude-3-5-sonnet-20241022", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
            });
      setKeyStatus((current) => ({ ...current, [provider]: response.ok ? "valid" : "invalid" }));
      onRuntimeLog("model", `${provider === "openai" ? "OpenAI" : "Anthropic"} key ${response.ok ? "validated" : "was rejected"}.`);
    } catch (error) {
      setKeyStatus((current) => ({ ...current, [provider]: "invalid" }));
      onRuntimeLog("model", `Key check failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  async function loadGitHubStatus(): Promise<void> {
    try {
      const payload = await runtimeJson<{
        ok: boolean;
        connected: boolean;
        owner?: string;
        repo?: string;
        login?: string;
        permissions?: Record<string, boolean>;
        error?: string;
      }>("/api/github/status", { retries: 2, timeoutMs: 12000 });
      if (payload.connected) {
        setGithubForm((current) => ({ ...current, owner: payload.owner ?? "", repo: payload.repo ?? "" }));
        setGithubStatus("connected");
        setGithubStatusText(`Connected as ${payload.login ?? "GitHub user"}${payload.permissions?.push ? " with push access." : "."}`);
      } else {
        setGithubStatus("missing");
        setGithubStatusText(payload.error ?? "No GitHub connection saved yet.");
      }
    } catch (error) {
      setGithubStatus("invalid");
      setGithubStatusText(error instanceof Error ? error.message : "Could not check GitHub.");
    }
  }

  async function saveGitHubConnection(): Promise<void> {
    setGithubStatus("checking");
    setGithubStatusText("Checking GitHub access...");
    try {
      const payload = await runtimeJson<{
        ok: boolean;
        connected?: boolean;
        login?: string;
        permissions?: Record<string, boolean>;
        error?: string;
      }>("/api/github/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(githubForm),
        retries: 1,
        timeoutMs: 20000,
      });
      if (!payload.ok || !payload.connected) throw new Error(payload.error ?? "GitHub connection failed.");
      setGithubForm((current) => ({ ...current, token: "" }));
      setGithubStatus("connected");
      setGithubStatusText(`Connected as ${payload.login ?? "GitHub user"}${payload.permissions?.push ? " with push access." : "."}`);
      onRuntimeLog("app", "GitHub repository connection validated.");
    } catch (error) {
      setGithubStatus("invalid");
      setGithubStatusText(error instanceof Error ? error.message : "GitHub connection failed.");
      onRuntimeLog("app", "GitHub connection validation failed.");
    }
  }

  async function confirmTokenReset(): Promise<void> {
    const confirmed = window.confirm("Reset token usage and budget for the current thread?");
    if (!confirmed) return;
    await onResetTokenUsage();
    onRuntimeLog("app", "Token usage reset from Settings.");
  }

  async function resetTokenUsageWithScope(scope: ResetScope): Promise<void> {
    await onResetTokenUsage();
    onRuntimeLog("app", `Token usage reset for ${scope}.`);
  }

  function saveProviderKey(provider: "openai" | "anthropic", value: string): void {
    setProviderKeys((current) => ({ ...current, [provider]: value }));
    if (value) {
      localStorage.setItem(providerKeyStorage[provider], value);
      localStorage.setItem(provider === "openai" ? "NEXUS_OPENAI_LAST_USED" : "NEXUS_ANTHROPIC_LAST_USED", new Date().toISOString());
      setKeyStatus((current) => ({ ...current, [provider]: "unknown" }));
    } else {
      localStorage.removeItem(providerKeyStorage[provider]);
      setKeyStatus((current) => ({ ...current, [provider]: "missing" }));
    }
  }

  return (
    <section className="admin-overlay" aria-label="Settings & Core Runtime">
      <header className="admin-header">
        <div>
          <h1>Settings &amp; Core Runtime</h1>
          <span>Manage local AI Brains, long-term memory, cloud keys, and integrations.</span>
        </div>
        <button className="ghost-btn" onClick={onClose} aria-label="Close Settings & Core Runtime">
          <X size={16} />
          Close
        </button>
      </header>

      <div className="admin-shell">
        <nav className="admin-nav" aria-label="Settings sections">
          {tabs.map(({ id, label, Icon }) => (
            <button key={id} className={`admin-nav-item ${activeTab === id ? "active" : ""}`} onClick={() => setActiveTab(id)}>
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="admin-body">
          {activeTab === "models" && (
            <SettingsPage
              activeModel={activeModel}
              downloadedModels={downloadedModels}
              initialSection="models"
              providerKeys={providerKeys}
              tokenBudget={tokenBudget}
              tokensUsed={tokensUsed}
              onModelChange={onModelChange}
              onModelRemove={(modelId) => {
                const model = downloadedModels.find((candidate) => candidate.id === modelId);
                if (model) void deleteModel(model);
              }}
              onModelsRefresh={onModelsRefresh}
              onProviderKeySave={saveProviderKey}
              onResetTokenUsage={resetTokenUsageWithScope}
              onRuntimeLog={onRuntimeLog}
            />
          )}

          {false && activeTab === "models" && (
            <div className="admin-grid">
              <section className="dash-card budget-reset-card">
                <div className="dash-card-head">
                  <div>
                    <h2>Usage &amp; Budget</h2>
                    <span>{tokensUsed.toLocaleString()} of {tokenBudget.toLocaleString()} tokens used in the current thread.</span>
                  </div>
                  <span className="badge neutral">{tokenPercent}% used</span>
                </div>
                <div className="progress-meter">
                  <div style={{ width: `${tokenPercent}%` }} />
                </div>
                <button className="danger-soft-btn" onClick={() => void confirmTokenReset()}>
                  Reset Token Usage &amp; Budget
                </button>
              </section>

              <section className="dash-card">
                <div className="dash-card-head">
                  <div>
                    <h2>Downloaded AI Brains</h2>
                    <span>{downloadedModels.length} local model{downloadedModels.length === 1 ? "" : "s"} available</span>
                  </div>
                  <button className="ghost-btn" onClick={() => void onModelsRefresh()}>
                    <RefreshCw size={15} /> Refresh
                  </button>
                </div>
                <div className="model-grid">
                  {baseOptions.map((model) => {
                    const isActive = isActiveModel(model, activeModel);
                    return (
                      <article key={model.id} className={`model-card ${isActive ? "active" : ""}`}>
                        <button className="model-card-select" type="button" onClick={() => void onModelChange(model.id)}>
                          <div className="model-card-top">
                            <strong>{model.name}</strong>
                            <span className={`status-tag ${isActive ? "on" : "idle"}`}>{isActive ? "Active" : "Idle"}</span>
                          </div>
                          <span className="model-meta">{model.details?.parameterSize ?? "Local model"} · {formatBytes(model.size)}</span>
                          {model.details?.quantizationLevel && <span className="model-meta">{model.details.quantizationLevel}</span>}
                        </button>
                        {!isActive && downloadedModels.some((downloaded) => downloaded.id === model.id) && (
                          <button
                            className="model-delete-btn"
                            type="button"
                            aria-label={`Delete ${model.name}`}
                            title={`Delete ${model.name}`}
                            disabled={deletingModelId === model.id}
                            onClick={() => {
                              setPendingDeleteModel(model);
                              setDeleteModelStatus("");
                            }}
                          >
                            <Trash2 size={13} />
                            Delete
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="dash-card">
                <div className="dash-card-head">
                  <div>
                    <h2>
                      Download Any Model
                      <Tooltip text="Accepts Ollama handles (llama3:70b), Hugging Face repo IDs, and GGUF identifiers your local runtime supports." />
                    </h2>
                    <span>Pull a model straight into your local engine.</span>
                  </div>
                  <button onClick={() => void pullModel()} disabled={isPulling}>
                    <Download size={16} /> {isPulling ? "Pulling…" : "Pull Model"}
                  </button>
                </div>
                <input
                  value={modelIdentifier}
                  onChange={(event) => setModelIdentifier(event.target.value)}
                  aria-label="Universal model identifier"
                  placeholder="llama3:70b, phi3, deepseek-coder, MaziyarPanahi/Hermes-3-Llama-3.1-8B-GGUF"
                />
                <div className="progress-meter">
                  <div style={{ width: `${pullProgress}%` }} />
                </div>
                <span className="metric">{pullProgress}% · {pullStatus}</span>
              </section>

              <section className="dash-card">
                <div className="dash-card-head">
                  <div>
                    <h2>
                      Create Custom AI Brain
                      <Tooltip text="Bundles a base model with your system prompt and parameters into a reusable Ollama model — no Modelfile syntax required." />
                    </h2>
                    <span>Bake a tailored model from a base + persona.</span>
                  </div>
                  <button onClick={() => void buildCustomModel()} disabled={isBuilding}>
                    <Hammer size={16} /> {isBuilding ? "Baking…" : "Save &amp; Bake"}
                  </button>
                </div>
                <div className="form-grid">
                  <label>
                    <span className="field-label">Brain Name</span>
                    <input value={customName} onChange={(event) => setCustomName(event.target.value)} aria-label="Custom AI Brain name" />
                  </label>
                  <label>
                    <span className="field-label">Base Model</span>
                    <select value={baseModel} onChange={(event) => setBaseModel(event.target.value)} aria-label="Base Model">
                      {baseOptions.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="wide">
                    <span className="field-label">System Prompt</span>
                    <textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} aria-label="Custom System Prompt" rows={3} />
                  </label>
                  <label>
                    <span className="field-label">Temperature <Tooltip text="Higher = more creative, lower = more focused." /></span>
                    <input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} />
                  </label>
                  <label>
                    <span className="field-label">Context Length</span>
                    <input type="number" min="1024" step="1024" value={contextLength} onChange={(event) => setContextLength(Number(event.target.value))} />
                  </label>
                  <label className="wide">
                    <span className="field-label">Stop Tokens <Tooltip text="One per line. The model stops generating when it emits any of these." /></span>
                    <textarea value={stopTokens} onChange={(event) => setStopTokens(event.target.value)} aria-label="Stop Tokens" rows={2} />
                  </label>
                </div>
                <div className="progress-meter">
                  <div style={{ width: `${buildProgress}%` }} />
                </div>
                <span className="metric">{buildProgress}% · {buildStatus}</span>
              </section>

              <section className="dash-card sub-agent-manager-card wide-card">
                <div className="dash-card-head">
                  <div>
                    <h2>
                      Sub-Agents Manager
                      <Tooltip text="Deploy specialized helpers in parallel. The selected AI Brain coordinates them and reads their shared workspace outputs." />
                    </h2>
                    <span>{activeSubAgentCount} deployed helper{activeSubAgentCount === 1 ? "" : "s"} running alongside the main AI Brain.</span>
                  </div>
                  <span className="badge neutral">
                    <Activity size={13} />
                    Concurrent
                  </span>
                </div>

                <div className="sub-agent-grid">
                  {subAgents.map((agent) => {
                    const Icon = subAgentIcon(agent.id);
                    const isLive = agent.status === "Active" || agent.status === "Running";
                    return (
                      <article className={`sub-agent-card ${isLive ? "live" : ""}`} key={agent.id}>
                        <div className="sub-agent-card-head">
                          <span className="sub-agent-icon">
                            <Icon size={19} />
                          </span>
                          <div>
                            <strong>{agent.name}</strong>
                            <small>{agent.specialization}</small>
                          </div>
                          <span className={`status-tag ${subAgentStatusTone(agent.status)}`}>{agent.status}</span>
                        </div>
                        <p>{agent.description}</p>
                        <label className="sub-agent-slider">
                          <span>
                            <SlidersHorizontal size={13} />
                            Allocated Memory/Context Limit
                          </span>
                          <strong>{agent.contextLimit.toLocaleString()} tokens</strong>
                          <input
                            type="range"
                            min={2048}
                            max={32768}
                            step={1024}
                            value={agent.contextLimit}
                            onChange={(event) => onSubAgentContextLimitChange(agent.id, Number(event.target.value))}
                          />
                        </label>
                        <div className="sub-agent-task-line">
                          <span className={isLive ? "pulse-dot" : "idle-dot"} />
                          <span>{agent.currentTask}</span>
                        </div>
                        {isLive ? (
                          <button className="danger-soft-btn" onClick={() => onSubAgentTerminate(agent.id)}>
                            <Square size={14} />
                            Terminate
                          </button>
                        ) : (
                          <button className="primary-btn" onClick={() => onSubAgentDeploy(agent.id)}>
                            <Download size={14} />
                            Deploy
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {activeTab === "github" && (
            <div className="admin-grid">
              <section className="dash-card github-card">
                <div className="dash-card-head">
                  <div>
                    <h2>
                      GitHub Connections
                      <Tooltip text="The token is saved by the local backend and is never returned to the browser after validation." />
                    </h2>
                    <span>Connect one repository so Glitch can clone, branch, commit, push, and open pull requests.</span>
                  </div>
                  <span className={`badge ${badgeTone(githubStatus === "connected" ? "valid" : githubStatus === "checking" ? "checking" : githubStatus === "missing" ? "missing" : "invalid")}`}>
                    {githubStatus === "connected" ? "Connected" : githubStatus === "checking" ? "Checking..." : githubStatus === "missing" ? "Not connected" : "Needs attention"}
                  </span>
                </div>

                <div className="form-grid">
                  <label className="wide">
                    <span className="field-label">GitHub Personal Access Token</span>
                    <div className="key-input">
                      <input
                        aria-label="GitHub Personal Access Token"
                        type={showGithubToken ? "text" : "password"}
                        value={githubForm.token}
                        placeholder={githubStatus === "connected" ? "Saved securely on this device" : "ghp_... or github_pat_..."}
                        onChange={(event) => setGithubForm((current) => ({ ...current, token: event.target.value }))}
                      />
                      <button
                        type="button"
                        className="ghost-btn icon-only"
                        aria-label={showGithubToken ? "Hide GitHub token" : "Show GitHub token"}
                        onClick={() => setShowGithubToken((current) => !current)}
                      >
                        {showGithubToken ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </label>
                  <label>
                    <span className="field-label">Repository Owner</span>
                    <input
                      aria-label="Repository owner"
                      value={githubForm.owner}
                      placeholder="octocat"
                      onChange={(event) => setGithubForm((current) => ({ ...current, owner: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span className="field-label">Repository Name</span>
                    <input
                      aria-label="Repository name"
                      value={githubForm.repo}
                      placeholder="hello-world"
                      onChange={(event) => setGithubForm((current) => ({ ...current, repo: event.target.value }))}
                    />
                  </label>
                </div>

                <div className="github-connection-actions">
                  <button className="primary-btn" onClick={() => void saveGitHubConnection()} disabled={githubStatus === "checking"}>
                    <Github size={15} />
                    Validate Connection
                  </button>
                  <button className="ghost-btn" onClick={() => void loadGitHubStatus()}>
                    <RefreshCw size={15} />
                    Refresh
                  </button>
                </div>
                <span className="metric">{githubStatusText}</span>
              </section>

              <section className="dash-card github-card">
                <div className="dash-card-head">
                  <div>
                    <h2>Agent GitHub Tools</h2>
                    <span>Available after a repository connection is validated.</span>
                  </div>
                  <Github size={18} />
                </div>
                <div className="github-tool-list">
                  <code>github_clone_repo</code>
                  <code>github_create_branch</code>
                  <code>github_commit_and_push</code>
                  <code>github_create_pull_request</code>
                </div>
                <p className="metric">
                  Repository files are cloned under <code>repositories/</code> and path-checked before git operations run.
                </p>
              </section>
            </div>
          )}

          {activeTab === "integrationsMemory" && (
            <div className="admin-grid integrations-memory-grid">
              <section className="dash-card">
                <div className="dash-card-head">
                  <div>
                    <h2>Connected Tools Status</h2>
                    <span>Open WebUI operational tools and local runtime readiness.</span>
                  </div>
                  <span className="badge neutral">Open WebUI</span>
                </div>
                {[
                  ...(isPowerMode
                    ? [
                        ["Web Search", "Ready", PlugZap],
                        ["Calculator", "Ready", Check],
                        ["RAG Library", "Ready", Database],
                      ]
                    : [
                        ["Local Chat", "Ready", Bot],
                        ["Calculator", "Ready", Check],
                        ["Local Memory", "Ready", Database],
                      ]),
                ].map(([name, status, Icon]) => (
                  <div className="trajectory-row" key={name as string}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Icon size={15} />
                      {name as string}
                    </span>
                    <strong>{status as string}</strong>
                  </div>
                ))}
              </section>

              <section className="dash-card">
                <div className="dash-card-head">
                  <div>
                    <h2>App Integrations</h2>
                    <span>Registered action schemas available to the AI workspace.</span>
                  </div>
                  <span className="badge neutral">{isPowerMode ? `${tools.length + pluginTools.length} actions` : "Paused"}</span>
                </div>
                <div className="tool-list settings-tool-list">
                  {!isPowerMode ? (
                    <span>Safe Mode keeps external app actions turned off.</span>
                  ) : (
                    <>
                      {tools.length + pluginTools.length === 0 ? <span>No external app actions connected yet.</span> : null}
                      {pluginTools.map((tool) => (
                        <code key={`plugin:${tool.name}`}>{tool.name}</code>
                      ))}
                      {tools.map((tool) => (
                        <code key={`${tool.serverId}:${tool.name}`}>{tool.description}</code>
                      ))}
                    </>
                  )}
                </div>
              </section>

              <section className="dash-card memory-panel wide-card">
                <div className="dash-card-head">
                  <div>
                    <h2>System Memory &amp; Learned Lessons</h2>
                    <span>Local pinned rules, browser shortcuts, and saved automation paths.</span>
                  </div>
                  <span className="badge neutral">Local</span>
                </div>
                <div className="persistent-memory-grid settings-memory-grid">
                  <div className="persistent-memory-section">
                    <div className="panel-title-row">
                      <h3>Pinned Automation Rules &amp; Shortcuts</h3>
                      <span>{staticRules.length}</span>
                    </div>
                    {staticRules.length === 0 ? (
                      <span className="metric">No pinned shortcuts yet.</span>
                    ) : (
                      <div className="persistent-memory-list">
                        {staticRules.map((rule) => (
                          <div className="persistent-memory-row" key={rule.id}>
                            <div>
                              <strong>{rule.triggerKeyword}</strong>
                              <span>{rule.expectedBehavior}</span>
                              <input
                                aria-label={`Target URL for ${rule.triggerKeyword}`}
                                defaultValue={rule.targetUrl}
                                onBlur={(event) => void onStaticRuleUrlChange(rule, event.currentTarget.value)}
                              />
                            </div>
                            <button aria-label={`Delete ${rule.triggerKeyword}`} onClick={() => void onStaticRuleDelete(rule.id)}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="persistent-memory-section">
                    <div className="panel-title-row">
                      <h3>Encrypted Credentials Vault</h3>
                      <span>{vaultSecrets.length}</span>
                    </div>
                    {vaultSecrets.length === 0 ? (
                      <span className="metric">No saved credentials yet.</span>
                    ) : (
                      <div className="persistent-memory-list">
                        {vaultSecrets.map((secret) => (
                          <div className="vault-row" key={secret.id}>
                            <strong>{secret.secretKey}</strong>
                            <code>{maskSecretValue(secret.secretValue)}</code>
                            <button aria-label={`Delete ${secret.secretKey}`} onClick={() => void onVaultSecretDelete(secret.id)}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === "memory" && (
            <section className="dash-card memory-card">
              <div className="dash-card-head">
                <div>
                  <h2>Persistent Memory Manager</h2>
                  <span>Edit <code>Persistent Memory.MD</code> — the assistant reads this for long-term facts and lessons.</span>
                </div>
                <div className="memory-actions">
                  <span className={`metric ${memoryDirty ? "dirty" : ""}`}>{memoryDirty ? "Unsaved changes" : memoryStatus}</span>
                  <button className="primary-btn" onClick={() => void saveMemory()} disabled={memorySaving || !memoryLoaded}>
                    <Save size={15} /> {memorySaving ? "Saving…" : "Save Memory"}
                  </button>
                </div>
              </div>
              <label className="memory-retention-control">
                <input
                  type="checkbox"
                  checked={rememberChatHistory}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setRememberChatHistory(enabled);
                    setChatHistoryMemoryEnabled(enabled);
                    onRuntimeLog("app", `Permanent chat memory ${enabled ? "enabled" : "disabled"}.`);
                  }}
                />
                <span>
                  <strong>Include chat history in permanent memory</strong>
                  <small>
                    Future completed exchanges are stored in semantic memory and the local append-only chat archive. Turning this off does not erase existing memory.
                  </small>
                </span>
              </label>
              <div className="memory-split">
                <div className="memory-pane">
                  <div className="memory-pane-label">Markdown</div>
                  <textarea
                    className="memory-editor"
                    aria-label="Persistent Memory editor"
                    value={memoryContent}
                    spellCheck={false}
                    onChange={(event) => {
                      setMemoryContent(event.target.value);
                      setMemoryDirty(true);
                    }}
                  />
                </div>
                <div className="memory-pane">
                  <div className="memory-pane-label">Preview</div>
                  <div className="memory-preview markdown-body" dangerouslySetInnerHTML={{ __html: memoryPreview }} />
                </div>
              </div>
            </section>
          )}

          {activeTab === "neural" && (
            <section className="dash-card living-brain-card" role="region" aria-label="Neural Network">
              <div className="dash-card-head">
                <div>
                  <h2>Neural Network</h2>
                  <span>Live NexusNN topology with simulated activations and weighted propagation.</span>
                </div>
              </div>
              <div className="living-brain-stage">
                <Suspense fallback={<div className="living-brain-loading" role="status">Loading living memory core…</div>}>
                  <LivingBrainCanvas neuronActivity={demoNeuronActivity} />
                </Suspense>
              </div>
            </section>
          )}

          {activeTab === "keys" && (
            <SettingsPage
              activeModel={activeModel}
              downloadedModels={downloadedModels}
              initialSection="keys"
              providerKeys={providerKeys}
              tokenBudget={tokenBudget}
              tokensUsed={tokensUsed}
              onModelChange={onModelChange}
              onModelRemove={(modelId) => {
                const model = downloadedModels.find((candidate) => candidate.id === modelId);
                if (model) void deleteModel(model);
              }}
              onModelsRefresh={onModelsRefresh}
              onProviderKeySave={saveProviderKey}
              onResetTokenUsage={resetTokenUsageWithScope}
              onRuntimeLog={onRuntimeLog}
            />
          )}

          {false && activeTab === "keys" && (
            <div className="admin-grid two-col">
              {(["openai", "anthropic"] as const).map((provider) => (
                <section className="dash-card key-card" key={provider}>
                  <div className="dash-card-head">
                    <div>
                      <h2>{provider === "openai" ? "OpenAI" : "Anthropic"}</h2>
                      <span>Used only when a {provider === "openai" ? "GPT" : "Claude"} cloud model is selected.</span>
                    </div>
                    <span className={`badge ${badgeTone(keyStatus[provider])}`}>{statusText(keyStatus[provider])}</span>
                  </div>
                  <label>
                    <span className="field-label">API Key</span>
                    <div className="key-input">
                      <input
                        aria-label={`${provider === "openai" ? "OpenAI" : "Anthropic"} API key`}
                        type={revealKey[provider] ? "text" : "password"}
                        value={providerKeys[provider]}
                        placeholder={provider === "openai" ? "sk-…" : "sk-ant-…"}
                        onChange={(event) => setProviderKeys((current) => ({ ...current, [provider]: event.target.value }))}
                      />
                      <button
                        type="button"
                        className="ghost-btn icon-only"
                        aria-label={revealKey[provider] ? "Hide key" : "Show key"}
                        onClick={() => setRevealKey((current) => ({ ...current, [provider]: !current[provider] }))}
                      >
                        {revealKey[provider] ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </label>
                  <button className="primary-btn" onClick={() => void validateProvider(provider)}>
                    <Check size={15} /> Verify &amp; Save
                  </button>
                </section>
              ))}
            </div>
          )}

          {activeTab === "chat" && (
            <div className="admin-grid">
              {integrations.map((form) => (
                <section className="dash-card" key={form.platform}>
                  <div className="dash-card-head">
                    <div>
                      <h2>{platformLabels[form.platform]}</h2>
                      <span>{form.isActive ? "Ready to receive messages" : "Turn on when you are ready"}</span>
                    </div>
                    <label className="switch">
                      <input
                        checked={form.isActive}
                        onChange={(event) => onIntegrationChange(form.platform, { isActive: event.target.checked })}
                        type="checkbox"
                      />
                      Enabled
                    </label>
                  </div>
                  <label>
                    <span className="field-label">Generated webhook endpoint</span>
                    <input readOnly value={`${origin}/webhooks/${form.platform}`} aria-label={`${platformLabels[form.platform]} generated webhook`} />
                  </label>
                  <div className="form-grid">
                    <label>
                      <span className="field-label">Bot Token</span>
                      <input
                        aria-label={`${platformLabels[form.platform]} Bot Token`}
                        onChange={(event) => onIntegrationChange(form.platform, { botToken: event.target.value })}
                        type="password"
                        value={form.botToken}
                      />
                    </label>
                    <label>
                      <span className="field-label">Reply Webhook URL</span>
                      <input
                        aria-label={`${platformLabels[form.platform]} Webhook URL`}
                        onChange={(event) => onIntegrationChange(form.platform, { webhookUrl: event.target.value })}
                        value={form.webhookUrl}
                      />
                    </label>
                  </div>
                  <button className="primary-btn" onClick={() => void onIntegrationSave(form)}>
                    Save {platformLabels[form.platform]}
                  </button>
                </section>
              ))}
            </div>
          )}

          {activeTab === "safety" && (
            <div className="admin-grid two-col">
              <section className="dash-card safety-settings-card">
                <div className="dash-card-head">
                  <div>
                    <h2>Execution Breakpoints</h2>
                    <span>Pause high-risk operations before the agent or tool runner executes them.</span>
                  </div>
                  <AlertTriangle size={18} />
                </div>
                {[
                  {
                    key: "shellCommands" as const,
                    title: "Shell Commands",
                    detail: "Pause before PowerShell, bash, npm, git reset, sudo, chmod, and command-runner tools.",
                  },
                  {
                    key: "fileDeletions" as const,
                    title: "File Deletions",
                    detail: "Pause before recursive deletes, path removals, rejects, trash, or erase operations.",
                  },
                  {
                    key: "networkOverwrites" as const,
                    title: "Network Configuration Overwrites",
                    detail: "Pause before DNS, firewall, proxy, VPN, hosts-file, route, or adapter changes.",
                  },
                  {
                    key: "audibleAlerts" as const,
                    title: "Audible Alert",
                    detail: "Play a short local alert sound when a breakpoint pauses execution.",
                  },
                ].map((item) => (
                  <label className="safety-toggle-row" key={item.key}>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </div>
                    <input
                      checked={safetySettings[item.key]}
                      onChange={(event) => onSafetySettingChange(item.key, event.target.checked)}
                      type="checkbox"
                    />
                  </label>
                ))}
              </section>

              <section className="dash-card">
                <div className="dash-card-head">
                  <div>
                    <h2>Current Policy</h2>
                    <span>These checks run before local workspace tools execute.</span>
                  </div>
                  <ShieldCheck size={18} />
                </div>
                <div className="github-tool-list">
                  <code>{safetySettings.shellCommands ? "Shell: Intercept" : "Shell: Pass through"}</code>
                  <code>{safetySettings.fileDeletions ? "Delete: Intercept" : "Delete: Pass through"}</code>
                  <code>{safetySettings.networkOverwrites ? "Network: Intercept" : "Network: Pass through"}</code>
                  <code>{safetySettings.audibleAlerts ? "Alert: Sound on" : "Alert: Silent"}</code>
                </div>
                <p className="metric">
                  When a breakpoint matches, Glitch pauses the loop and shows Approve Action / Abort & Rewrite over the workspace.
                </p>
              </section>
            </div>
          )}

          {activeTab === "logs" && (
            <section className="dash-card">
              <div className="dash-card-head">
                <div>
                  <h2>Live Runtime Logs</h2>
                  <span>Model routing, downloads, builds, and app actions as they happen.</span>
                </div>
                <span className="metric">{logs.length} events</span>
              </div>
              <div className="log-list">
                {sortedLogs.length === 0 ? <span className="metric">No runtime activity yet.</span> : null}
                {sortedLogs.map((log) => (
                  <div className="log-row" key={log.id}>
                    <strong>{new Date(log.at).toLocaleTimeString()}</strong>
                    <span>{log.message}</span>
                    <code>{log.source}</code>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
      {pendingDeleteModel && (
        <div className="model-delete-overlay" role="alertdialog" aria-modal="true" aria-label="Delete local AI Brain">
          <div className="model-delete-dialog">
            <Trash2 size={20} />
            <div>
              <strong>Delete local AI Brain?</strong>
              <span>
                This will permanently delete <code>{pendingDeleteModel.name}</code> from the local model engine and free its disk space.
                This action cannot be undone.
              </span>
            </div>
            {deleteModelStatus && <p className="model-delete-status">{deleteModelStatus}</p>}
            <div className="model-delete-actions">
              <button
                className="ghost-btn"
                type="button"
                disabled={deletingModelId === pendingDeleteModel.id}
                onClick={() => {
                  setPendingDeleteModel(null);
                  setDeleteModelStatus("");
                }}
              >
                Cancel
              </button>
              <button
                className="danger-soft-btn"
                type="button"
                disabled={deletingModelId === pendingDeleteModel.id}
                onClick={() => void deleteModel(pendingDeleteModel)}
              >
                <Trash2 size={14} />
                {deletingModelId === pendingDeleteModel.id ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Tooltip({ text }: { text: string }) {
  return (
    <span className="tooltip" tabIndex={0} aria-label={text}>
      <Info size={13} />
      <span className="tooltip-bubble">{text}</span>
    </span>
  );
}

function subAgentIcon(agentId: string) {
  if (agentId.includes("terminal")) return Terminal;
  if (agentId.includes("code")) return Code2;
  if (agentId.includes("crawler") || agentId.includes("research")) return Globe2;
  return BrainCircuit;
}

function subAgentStatusTone(status: SubAgentStatus): string {
  if (status === "Running" || status === "Active") return "on";
  if (status === "Downloading") return "pending";
  return "idle";
}

async function streamOllamaProgress(
  response: Response,
  setProgress: (value: number) => void,
  setStatus: (value: string) => void,
  onLog: (message: string) => void,
): Promise<void> {
  if (!response.body) {
    setProgress(100);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fallback = 4;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as OllamaProgressEvent;
      if (event.error) throw new Error(event.error);
      const progress = event.total ? Math.round(((event.completed ?? 0) / event.total) * 100) : Math.min(95, fallback);
      fallback = Math.min(95, fallback + 4);
      setProgress(progress);
      setStatus(event.status ?? "Downloading…");
      onLog(event.status ?? "Downloading…");
    }
  }
}

function formatBytes(bytes: number): string {
  if (!bytes) return "size unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function isActiveModel(model: LocalModelInfo, activeModel: string): boolean {
  return activeModel === model.id || activeModel === model.name || activeModel === `ollama:${model.id}` || activeModel === `ollama:${model.name}`;
}

function statusText(status: KeyStatus): string {
  if (status === "checking") return "Checking…";
  if (status === "valid") return "Connected";
  if (status === "invalid") return "Needs attention";
  if (status === "missing") return "Not configured";
  return "Saved locally";
}

function badgeTone(status: KeyStatus): string {
  if (status === "valid") return "ok";
  if (status === "invalid" || status === "missing") return "warn";
  if (status === "checking") return "pending";
  return "neutral";
}
