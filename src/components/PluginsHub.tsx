import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Boxes,
  Brush,
  Chrome,
  Cloud,
  Code2,
  Database,
  FileText,
  Flame,
  Github,
  Gitlab,
  Globe2,
  Inbox,
  KeyRound,
  Layers3,
  Mail,
  MoreHorizontal,
  Plug,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Ticket,
  WalletCards,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type PluginCategory =
  | "Development Tools & Repositories"
  | "Code Intelligence"
  | "Project Management & Knowledge Hubs"
  | "Web Automation & Active Research"
  | "Design, Analytics & Operations";

export interface PluginToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface PluginAuthConfig {
  type: "oauth" | "token" | "path" | "none";
  label: string;
  fields: Array<{ key: string; label: string; secret?: boolean; placeholder: string }>;
}

export interface NexusPlugin {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  category: PluginCategory;
  provider: "OpenAI" | "Workspace" | "Personal";
  isInstalled: boolean;
  isEnabled: boolean;
  isConfigured: boolean;
  authConfig: PluginAuthConfig;
  tools: PluginToolSchema[];
}

export interface RegisteredPluginTool extends PluginToolSchema {
  pluginId: string;
  pluginName: string;
}

interface PluginRuntime {
  plugins: NexusPlugin[];
  tools: RegisteredPluginTool[];
  execute: (toolName: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    nexusPluginRuntime?: PluginRuntime;
  }
}

const pluginStorageKey = "NEXUS_PLUGIN_REGISTRY";
const pluginConfigStorageKey = "NEXUS_PLUGIN_CONFIGS";

const categories: PluginCategory[] = [
  "Development Tools & Repositories",
  "Code Intelligence",
  "Project Management & Knowledge Hubs",
  "Web Automation & Active Research",
  "Design, Analytics & Operations",
];

const iconMap: Record<string, LucideIcon> = {
  github: Github,
  gitlab: Gitlab,
  vercel: Cloud,
  supabase: Database,
  firebase: Flame,
  typescript: Code2,
  pyright: Code2,
  rust: Boxes,
  go: Code2,
  linear: Workflow,
  notion: FileText,
  jira: Ticket,
  drive: Layers3,
  confluence: FileText,
  playwright: Chrome,
  context7: Globe2,
  firecrawl: Globe2,
  slack: Send,
  gmail: Mail,
  figma: Brush,
  canva: Sparkles,
  posthog: BarChart3,
  sentry: ShieldCheck,
  stripe: WalletCards,
};

const credentialFields = (label = "API Key"): PluginAuthConfig["fields"] => [
  { key: "token", label, secret: true, placeholder: "Paste token or key" },
];

const workspacePathFields: PluginAuthConfig["fields"] = [
  { key: "workspacePath", label: "Workspace Path", placeholder: "C:\\Projects\\my-app or /Users/me/project" },
];

function tool(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): PluginToolSchema {
  return { name, description, parameters: { type: "object", properties, required } };
}

export const pluginCatalog: NexusPlugin[] = [
  {
    id: "github",
    name: "GitHub",
    subtitle: "PRs, issues, commits, and repo cloning.",
    icon: "github",
    category: "Development Tools & Repositories",
    provider: "Workspace",
    isInstalled: true,
    isEnabled: true,
    isConfigured: false,
    authConfig: { type: "token", label: "GitHub PAT", fields: credentialFields("GitHub token") },
    tools: [
      tool("github_clone_repo", "Clone a repository into the approved workspace.", { owner: { type: "string" }, repo: { type: "string" } }, ["owner", "repo"]),
      tool("github_create_pull_request", "Open a pull request for the current branch.", { title: { type: "string" }, body: { type: "string" } }, ["title"]),
      tool("github_sync_issues", "Read and summarize repository issues.", { labels: { type: "string" } }),
    ],
  },
  {
    id: "gitlab",
    name: "GitLab",
    subtitle: "CI/CD metrics and repository management.",
    icon: "gitlab",
    category: "Development Tools & Repositories",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "GitLab token", fields: credentialFields("GitLab token") },
    tools: [tool("gitlab_pipeline_status", "Fetch CI pipeline status.", { projectId: { type: "string" } }, ["projectId"])],
  },
  {
    id: "vercel",
    name: "Vercel",
    subtitle: "Deployments, domain routing, and edge logs.",
    icon: "vercel",
    category: "Development Tools & Repositories",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Vercel token", fields: credentialFields("Vercel token") },
    tools: [tool("vercel_latest_deployment", "Inspect latest deployment status.", { projectId: { type: "string" } }, ["projectId"])],
  },
  {
    id: "supabase",
    name: "Supabase",
    subtitle: "Schema introspection and direct SQL queries.",
    icon: "supabase",
    category: "Development Tools & Repositories",
    provider: "OpenAI",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Supabase service role", fields: credentialFields("Service role key") },
    tools: [tool("supabase_query", "Run an approved SQL query.", { sql: { type: "string" } }, ["sql"])],
  },
  {
    id: "firebase",
    name: "Firebase",
    subtitle: "Firestore rules and authentication queries.",
    icon: "firebase",
    category: "Development Tools & Repositories",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Firebase service account", fields: credentialFields("Service account JSON") },
    tools: [tool("firebase_auth_lookup", "Look up Firebase auth users.", { email: { type: "string" } }, ["email"])],
  },
  {
    id: "typescript-lsp",
    name: "TypeScript LSP",
    subtitle: "JS/TS type checking and go-to-definition.",
    icon: "typescript",
    category: "Code Intelligence",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: true,
    authConfig: { type: "path", label: "Project path", fields: workspacePathFields },
    tools: [tool("typescript_diagnostics", "Return TypeScript diagnostics.", { path: { type: "string" } }, ["path"])],
  },
  {
    id: "pyright-lsp",
    name: "Pyright LSP",
    subtitle: "Python type parsing and syntax diagnostics.",
    icon: "pyright",
    category: "Code Intelligence",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: true,
    authConfig: { type: "path", label: "Project path", fields: workspacePathFields },
    tools: [tool("pyright_diagnostics", "Return Python diagnostics.", { path: { type: "string" } }, ["path"])],
  },
  {
    id: "rust-analyzer-lsp",
    name: "Rust Analyzer",
    subtitle: "Rust macro evaluation and compile checking.",
    icon: "rust",
    category: "Code Intelligence",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: true,
    authConfig: { type: "path", label: "Cargo workspace", fields: workspacePathFields },
    tools: [tool("rust_analyzer_check", "Run Rust analyzer checks.", { cratePath: { type: "string" } }, ["cratePath"])],
  },
  {
    id: "gopls-lsp",
    name: "gopls",
    subtitle: "Go module handling and static code inspection.",
    icon: "go",
    category: "Code Intelligence",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: true,
    authConfig: { type: "path", label: "Go module path", fields: workspacePathFields },
    tools: [tool("gopls_inspect", "Inspect Go module diagnostics.", { modulePath: { type: "string" } }, ["modulePath"])],
  },
  {
    id: "linear",
    name: "Linear",
    subtitle: "Issue tracking and sprint board management.",
    icon: "linear",
    category: "Project Management & Knowledge Hubs",
    provider: "OpenAI",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Linear API key", fields: credentialFields("Linear API key") },
    tools: [tool("linear_create_issue", "Create a Linear issue.", { title: { type: "string" } }, ["title"])],
  },
  {
    id: "notion",
    name: "Notion",
    subtitle: "Database queries and knowledge-base pages.",
    icon: "notion",
    category: "Project Management & Knowledge Hubs",
    provider: "OpenAI",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Notion integration token", fields: credentialFields("Notion token") },
    tools: [tool("notion_query_database", "Query a Notion database.", { databaseId: { type: "string" } }, ["databaseId"])],
  },
  {
    id: "jira",
    name: "Jira",
    subtitle: "Atlassian board sync and ticket updates.",
    icon: "jira",
    category: "Project Management & Knowledge Hubs",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Jira token", fields: credentialFields("Jira API token") },
    tools: [tool("jira_update_ticket", "Update a Jira ticket.", { issueKey: { type: "string" }, comment: { type: "string" } }, ["issueKey"])],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    subtitle: "Document lookup and spreadsheet reading/writing.",
    icon: "drive",
    category: "Project Management & Knowledge Hubs",
    provider: "OpenAI",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "oauth", label: "Google OAuth", fields: credentialFields("OAuth access token") },
    tools: [tool("google_drive_search", "Search Drive files.", { query: { type: "string" } }, ["query"])],
  },
  {
    id: "confluence",
    name: "Confluence",
    subtitle: "Team wiki and requirements space mapping.",
    icon: "confluence",
    category: "Project Management & Knowledge Hubs",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Confluence token", fields: credentialFields("Confluence token") },
    tools: [tool("confluence_search_pages", "Search Confluence pages.", { query: { type: "string" } }, ["query"])],
  },
  {
    id: "playwright",
    name: "Playwright",
    subtitle: "Headless browser automation and screenshots.",
    icon: "playwright",
    category: "Web Automation & Active Research",
    provider: "Workspace",
    isInstalled: true,
    isEnabled: true,
    isConfigured: true,
    authConfig: { type: "none", label: "Local runtime", fields: [] },
    tools: [tool("playwright_capture", "Capture a screenshot from a URL.", { url: { type: "string" } }, ["url"])],
  },
  {
    id: "context7",
    name: "Context7",
    subtitle: "Live external API documentation lookup.",
    icon: "context7",
    category: "Web Automation & Active Research",
    provider: "OpenAI",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Context7 key", fields: credentialFields("Context7 API key") },
    tools: [tool("context7_lookup_docs", "Look up current API docs.", { library: { type: "string" } }, ["library"])],
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    subtitle: "Markdown web scraping and crawling.",
    icon: "firecrawl",
    category: "Web Automation & Active Research",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Firecrawl key", fields: credentialFields("Firecrawl API key") },
    tools: [tool("firecrawl_scrape", "Scrape a URL to markdown.", { url: { type: "string" } }, ["url"])],
  },
  {
    id: "slack",
    name: "Slack",
    subtitle: "Post alerts, read threads, and monitor channels.",
    icon: "slack",
    category: "Web Automation & Active Research",
    provider: "OpenAI",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Slack bot token", fields: credentialFields("Slack bot token") },
    tools: [tool("slack_post_message", "Post a message to Slack.", { channel: { type: "string" }, text: { type: "string" } }, ["channel", "text"])],
  },
  {
    id: "gmail",
    name: "Gmail",
    subtitle: "Inbox triage and follow-up drafts.",
    icon: "gmail",
    category: "Web Automation & Active Research",
    provider: "OpenAI",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "oauth", label: "Gmail OAuth", fields: credentialFields("OAuth access token") },
    tools: [tool("gmail_search_threads", "Search Gmail threads.", { query: { type: "string" } }, ["query"])],
  },
  {
    id: "figma",
    name: "Figma",
    subtitle: "Design token parsing and layouts to React.",
    icon: "figma",
    category: "Design, Analytics & Operations",
    provider: "OpenAI",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Figma token", fields: credentialFields("Figma token") },
    tools: [tool("figma_extract_tokens", "Extract design tokens.", { fileKey: { type: "string" } }, ["fileKey"])],
  },
  {
    id: "canva",
    name: "Canva",
    subtitle: "Creative brief template modifications.",
    icon: "canva",
    category: "Design, Analytics & Operations",
    provider: "Personal",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "oauth", label: "Canva OAuth", fields: credentialFields("OAuth access token") },
    tools: [tool("canva_update_template", "Update a Canva template brief.", { templateId: { type: "string" } }, ["templateId"])],
  },
  {
    id: "posthog",
    name: "PostHog",
    subtitle: "Event ingestion and analytics tracking.",
    icon: "posthog",
    category: "Design, Analytics & Operations",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "PostHog key", fields: credentialFields("PostHog project key") },
    tools: [tool("posthog_query_events", "Query analytics events.", { event: { type: "string" } }, ["event"])],
  },
  {
    id: "sentry",
    name: "Sentry",
    subtitle: "Production error log ingestion and diagnostics.",
    icon: "sentry",
    category: "Design, Analytics & Operations",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Sentry token", fields: credentialFields("Sentry token") },
    tools: [tool("sentry_latest_issues", "Fetch latest production issues.", { project: { type: "string" } }, ["project"])],
  },
  {
    id: "stripe",
    name: "Stripe",
    subtitle: "Subscription tracking and webhook testing.",
    icon: "stripe",
    category: "Design, Analytics & Operations",
    provider: "Workspace",
    isInstalled: false,
    isEnabled: false,
    isConfigured: false,
    authConfig: { type: "token", label: "Stripe restricted key", fields: credentialFields("Stripe restricted key") },
    tools: [tool("stripe_lookup_customer", "Look up Stripe customer state.", { customerId: { type: "string" } }, ["customerId"])],
  },
];

function mergePlugins(saved: NexusPlugin[]): NexusPlugin[] {
  return pluginCatalog.map((seed) => {
    const match = saved.find((plugin) => plugin.id === seed.id);
    return match ? { ...seed, ...match, tools: seed.tools, authConfig: seed.authConfig } : seed;
  });
}

export function loadPluginRegistry(): NexusPlugin[] {
  try {
    const stored = localStorage.getItem(pluginStorageKey);
    if (!stored) return pluginCatalog;
    return mergePlugins(JSON.parse(stored) as NexusPlugin[]);
  } catch {
    return pluginCatalog;
  }
}

export function installedPluginTools(plugins = loadPluginRegistry()): RegisteredPluginTool[] {
  return plugins
    .filter((plugin) => plugin.isInstalled && plugin.isEnabled)
    .flatMap((plugin) => plugin.tools.map((item) => ({ ...item, pluginId: plugin.id, pluginName: plugin.name })));
}

export function publishPluginRuntime(plugins: NexusPlugin[]): RegisteredPluginTool[] {
  const tools = installedPluginTools(plugins);
  window.nexusPluginRuntime = {
    plugins,
    tools,
    execute: async (toolName, args) => ({
      ok: true,
      toolName,
      args,
      message: `${toolName} is registered and ready for the local agent runner.`,
    }),
  };
  window.dispatchEvent(new CustomEvent("nexusharness:plugins-changed", { detail: { plugins, tools } }));
  return tools;
}

interface PluginsHubProps {
  onClose: () => void;
  onTryInChat: (promptSeed: string) => void;
  onToolsChange?: (tools: RegisteredPluginTool[]) => void;
}

export function PluginsHub({ onClose, onTryInChat, onToolsChange }: PluginsHubProps) {
  const [plugins, setPlugins] = useState<NexusPlugin[]>(() => loadPluginRegistry());
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PluginCategory | "All">("All");
  const [provider, setProvider] = useState<"All" | NexusPlugin["provider"]>("All");
  const [configuring, setConfiguring] = useState<NexusPlugin | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    localStorage.setItem(pluginStorageKey, JSON.stringify(plugins));
    onToolsChange?.(publishPluginRuntime(plugins));
  }, [onToolsChange, plugins]);

  const installed = plugins.filter((plugin) => plugin.isInstalled);
  const visiblePlugins = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return plugins.filter((plugin) => {
      const matchesCategory = category === "All" || plugin.category === category;
      const matchesProvider = provider === "All" || plugin.provider === provider;
      const matchesQuery =
        !normalized ||
        plugin.name.toLowerCase().includes(normalized) ||
        plugin.subtitle.toLowerCase().includes(normalized) ||
        plugin.id.toLowerCase().includes(normalized) ||
        plugin.tools.some((item) => item.name.toLowerCase().includes(normalized));
      return matchesCategory && matchesProvider && matchesQuery;
    });
  }, [category, plugins, provider, query]);

  function updatePlugin(pluginId: string, patch: Partial<NexusPlugin>): void {
    setPlugins((current) => current.map((plugin) => (plugin.id === pluginId ? { ...plugin, ...patch } : plugin)));
  }

  function openConfig(plugin: NexusPlugin): void {
    try {
      const stored = JSON.parse(localStorage.getItem(pluginConfigStorageKey) ?? "{}") as Record<string, Record<string, string>>;
      setConfigDraft(stored[plugin.id] ?? {});
    } catch {
      setConfigDraft({});
    }
    setConfiguring(plugin);
  }

  function saveConfig(): void {
    if (!configuring) return;
    const stored = JSON.parse(localStorage.getItem(pluginConfigStorageKey) ?? "{}") as Record<string, Record<string, string>>;
    localStorage.setItem(pluginConfigStorageKey, JSON.stringify({ ...stored, [configuring.id]: configDraft }));
    updatePlugin(configuring.id, { isConfigured: true, isInstalled: true, isEnabled: true });
    setConfiguring(null);
  }

  return (
    <div className="plugins-overlay" role="dialog" aria-modal="true" aria-label="Plugins">
      <header className="plugins-header">
        <div>
          <span className="plugins-kicker">
            <Plug size={15} />
            Plugin Library
          </span>
          <h1>Connect abilities to your AI workspace.</h1>
          <p>Install integrations once. Their tools register with the agent immediately.</p>
        </div>
        <button className="ghost-button" onClick={onClose}>
          <X size={15} />
          Close
        </button>
      </header>

      <main className="plugins-shell library">
        <aside className="plugins-category-sidebar">
          <button className={category === "All" ? "active" : ""} onClick={() => setCategory("All")}>
            All <span>{plugins.length}</span>
          </button>
          {categories.map((item) => (
            <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>
              {item}
              <span>{plugins.filter((plugin) => plugin.category === item).length}</span>
            </button>
          ))}
        </aside>

        <section className="plugins-main">
          <section className="plugins-search-row">
            <Search size={16} />
            <input aria-label="Search plugins" placeholder="Search plugins" value={query} onChange={(event) => setQuery(event.target.value)} />
          </section>

          <section className="plugins-installed-row">
            <div>
              <strong>Installed</strong>
              <span>{installed.length} active hooks</span>
            </div>
            <div className="installed-icons">
              {installed.length ? (
                installed.slice(0, 18).map((plugin) => {
                  const Icon = iconMap[plugin.icon] ?? Sparkles;
                  return (
                    <button className="installed-plugin-dot" title={plugin.name} key={plugin.id} onClick={() => onTryInChat(`Use ${plugin.name} to `)}>
                      <Icon size={18} />
                    </button>
                  );
                })
              ) : (
                <span className="plugins-empty-note">No plugins installed yet.</span>
              )}
            </div>
          </section>

          <nav className="plugins-filters" aria-label="Plugin providers">
            {(["All", "OpenAI", "Workspace", "Personal"] as const).map((item) => (
              <button className={item === provider ? "active" : ""} key={item} onClick={() => setProvider(item)}>
                {item === "OpenAI" ? "By OpenAI" : item === "Workspace" ? "By your workspace" : item}
              </button>
            ))}
          </nav>

          <section className="plugins-category">
            <h2>{category === "All" ? "All Plugins" : category}</h2>
            <div className="plugins-grid library-grid">
              {visiblePlugins.map((plugin) => {
                const Icon = iconMap[plugin.icon] ?? Sparkles;
                return (
                  <article className={`plugin-card ${plugin.isInstalled ? "installed" : ""}`} key={plugin.id}>
                    <div className="plugin-card-icon">
                      <Icon size={22} />
                    </div>
                    <div className="plugin-card-body">
                      <div className="plugin-card-title">
                        <strong>{plugin.name}</strong>
                        <PluginStatus plugin={plugin} />
                      </div>
                      <p>{plugin.subtitle}</p>
                      <small>
                        <KeyRound size={12} />
                        {plugin.authConfig.label} · {plugin.tools.length} tool{plugin.tools.length === 1 ? "" : "s"}
                      </small>
                    </div>
                    <div className="plugin-card-actions">
                      {plugin.isInstalled ? (
                        <>
                          <button className="primary-soft" disabled={!plugin.isEnabled} onClick={() => onTryInChat(`Use ${plugin.name} to `)}>
                            Try in chat
                          </button>
                          <button className="icon-only-button" aria-label={`Configure ${plugin.name}`} onClick={() => openConfig(plugin)}>
                            <MoreHorizontal size={16} />
                          </button>
                        </>
                      ) : (
                        <button
                          className="primary-soft"
                          onClick={() =>
                            plugin.authConfig.fields.length ? openConfig(plugin) : updatePlugin(plugin.id, { isInstalled: true, isEnabled: true, isConfigured: true })
                          }
                        >
                          Install
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </section>
      </main>

      {configuring && (
        <div className="plugin-config-backdrop" role="dialog" aria-modal="true" aria-label={`Configure ${configuring.name}`}>
          <section className="plugin-config-modal">
            <div className="dash-card-head">
              <div>
                <h2>Configure {configuring.name}</h2>
                <span>{configuring.authConfig.label}</span>
              </div>
              <button className="icon-only-button" aria-label="Close plugin configuration" onClick={() => setConfiguring(null)}>
                <X size={16} />
              </button>
            </div>
            {configuring.authConfig.fields.length === 0 ? (
              <p className="metric">No credentials are required for this local plugin.</p>
            ) : (
              <div className="form-grid">
                {configuring.authConfig.fields.map((field) => (
                  <label className="wide" key={field.key}>
                    <span className="field-label">{field.label}</span>
                    <input
                      type={field.secret ? "password" : "text"}
                      placeholder={field.placeholder}
                      value={configDraft[field.key] ?? ""}
                      onChange={(event) => setConfigDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                    />
                  </label>
                ))}
              </div>
            )}
            <div className="plugin-config-actions">
              <button className="ghost-btn" onClick={() => updatePlugin(configuring.id, { isEnabled: !configuring.isEnabled })}>
                {configuring.isEnabled ? "Disable" : "Enable"}
              </button>
              <button className="danger-soft-btn" onClick={() => updatePlugin(configuring.id, { isInstalled: false, isEnabled: false })}>
                Remove
              </button>
              <button className="primary-soft" onClick={saveConfig}>
                Save Configuration
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function PluginStatus({ plugin }: { plugin: NexusPlugin }) {
  if (!plugin.isInstalled) return <span className="plugin-status idle">Not installed</span>;
  if (!plugin.isConfigured) return <span className="plugin-status warn">Needs setup</span>;
  if (!plugin.isEnabled) return <span className="plugin-status idle">Paused</span>;
  return <span className="plugin-status live">Active</span>;
}
