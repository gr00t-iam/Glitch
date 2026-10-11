/**
 * WorkspaceBridge — the single orchestration surface that the UI and the AI
 * agent both use to read and mutate the local machine: filesystem, terminal,
 * and the git review state. Every mutation broadcasts a `workspace-changed`
 * event so the Files / Review / Terminal tabs refresh live, exactly like an
 * agentic workspace (Cowork / Claude Code style).
 */
import { runtimeJson } from "./RemoteRuntime";

export interface FsEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  modifiedAt: string;
}

export interface FsRoot {
  label: string;
  path: string;
}

export interface FsListResult {
  ok: boolean;
  path: string;
  parent: string | null;
  separator: string;
  entries: FsEntry[];
  error?: string;
}

export interface FsReadResult {
  ok: boolean;
  path: string;
  size: number;
  modifiedAt: string;
  content: string;
  binary: boolean;
  truncated?: boolean;
  previewBytes?: number;
  error?: string;
}

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export interface LiveSearchResult {
  title: string;
  url: string;
  snippet: string;
  content: string;
}

export interface LiveSearchResponse {
  ok: boolean;
  query: string;
  provider: "tavily" | "local-search";
  searchedAt: string;
  results: LiveSearchResult[];
  error?: string;
}

export interface PermanentChatMemoryInput {
  id: string;
  sessionId: string;
  title: string;
  model: string;
  summary: string;
  savedAt: number;
}

export interface DiffLine {
  type: "context" | "added" | "deleted" | "meta";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export interface DiffResult {
  ok: boolean;
  status: Array<{ path: string; status: string }>;
  files: DiffFile[];
  error?: string;
}

export interface GitHubActionResult {
  ok: boolean;
  message: string;
  path?: string;
  branch?: string;
  url?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

const WORKSPACE_EVENT = "nexusharness:workspace-changed";
const ACTIVE_PROJECT_DIRECTORY_KEY = "NEXUS_ACTIVE_PROJECT_DIRECTORY";
let activeProjectDirectory =
  typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_PROJECT_DIRECTORY_KEY) ?? "" : "";

export function emitWorkspaceChanged(reason: string): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT, { detail: { reason, at: Date.now() } }));
}

export function onWorkspaceChanged(handler: (reason: string) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<{ reason: string }>).detail?.reason ?? "change");
  window.addEventListener(WORKSPACE_EVENT, listener);
  return () => window.removeEventListener(WORKSPACE_EVENT, listener);
}

async function getJson<T>(url: string): Promise<T> {
  return runtimeJson<T>(url, { method: "GET", retries: 3, timeoutMs: 12000 });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return runtimeJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    retries: 2,
    timeoutMs: 20000,
  });
}

function isAbsoluteLocalPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

function joinProjectPath(basePath: string, relativePath: string): string {
  const trimmedBase = basePath.replace(/[\\/]+$/, "");
  const separator = trimmedBase.includes("\\") ? "\\" : "/";
  return `${trimmedBase}${separator}${relativePath.replace(/^[\\/]+/, "")}`;
}

function resolveProjectPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || isAbsoluteLocalPath(trimmed) || !activeProjectDirectory) return trimmed;
  return joinProjectPath(activeProjectDirectory, trimmed);
}

export const workspace = {
  // ---- Active project directory ------------------------------------------
  getActiveProjectDirectory: () => getJson<{ ok: boolean; path: string; error?: string }>("/api/project-directory"),
  async setActiveProjectDirectory(path: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    const result = await postJson<{ ok: boolean; path?: string; error?: string }>("/api/project-directory", { path });
    if (result.ok && result.path) {
      activeProjectDirectory = result.path;
      window.localStorage.setItem(ACTIVE_PROJECT_DIRECTORY_KEY, result.path);
      emitWorkspaceChanged(`project folder set to ${result.path}`);
    }
    return result;
  },
  activeProjectDirectory: () => activeProjectDirectory,
  resolveProjectPath,

  // ---- Filesystem ---------------------------------------------------------
  roots: () => getJson<{ ok: boolean; roots: FsRoot[]; separator: string; error?: string }>("/api/fs/roots"),
  list: (path: string) => getJson<FsListResult>(`/api/fs/list?path=${encodeURIComponent(resolveProjectPath(path))}`),
  read: (path: string) => getJson<FsReadResult>(`/api/fs/read?path=${encodeURIComponent(resolveProjectPath(path))}`),

  async write(path: string, content: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    const targetPath = resolveProjectPath(path);
    const result = await postJson<{ ok: boolean; path?: string; error?: string }>("/api/fs/write", { path: targetPath, content });
    if (result.ok) emitWorkspaceChanged(`wrote ${path}`);
    return result;
  },
  async makeDir(path: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    const targetPath = resolveProjectPath(path);
    const result = await postJson<{ ok: boolean; path?: string; error?: string }>("/api/fs/mkdir", { path: targetPath });
    if (result.ok) emitWorkspaceChanged(`created folder ${path}`);
    return result;
  },
  async remove(path: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    const targetPath = resolveProjectPath(path);
    const result = await postJson<{ ok: boolean; path?: string; error?: string }>("/api/fs/delete", { path: targetPath });
    if (result.ok) emitWorkspaceChanged(`deleted ${path}`);
    return result;
  },
  async rename(from: string, to: string): Promise<{ ok: boolean; error?: string }> {
    const result = await postJson<{ ok: boolean; error?: string }>("/api/fs/rename", { from: resolveProjectPath(from), to: resolveProjectPath(to) });
    if (result.ok) emitWorkspaceChanged(`renamed ${from}`);
    return result;
  },

  // ---- Terminal / processes ----------------------------------------------
  async exec(command: string, cwd?: string): Promise<ExecResult> {
    const result = await postJson<ExecResult>("/api/exec", { command, cwd: cwd ? resolveProjectPath(cwd) : activeProjectDirectory || undefined });
    emitWorkspaceChanged(`ran: ${command}`);
    return result;
  },

  liveSearch: (query: string, maxResults = 5) => postJson<LiveSearchResponse>("/api/search/live", { query, maxResults }),
  archiveChatMemory: (entry: PermanentChatMemoryInput) =>
    postJson<{ ok: boolean; stored: number; error?: string }>("/api/chat-memory", entry),
  archiveChatMemories: (entries: PermanentChatMemoryInput[]) =>
    postJson<{ ok: boolean; stored: number; error?: string }>("/api/chat-memory", { entries }),

  // ---- Review / git -------------------------------------------------------
  diff: () => getJson<DiffResult>("/api/workspace/diff"),
  async stage(path: string): Promise<{ ok: boolean; error?: string }> {
    const result = await postJson<{ ok: boolean; error?: string }>("/api/workspace/stage", { path });
    if (result.ok) emitWorkspaceChanged(`staged ${path}`);
    return result;
  },
  async reject(path: string): Promise<{ ok: boolean; error?: string }> {
    const result = await postJson<{ ok: boolean; error?: string }>("/api/workspace/reject", { path });
    if (result.ok) emitWorkspaceChanged(`reverted ${path}`);
    return result;
  },

  // ---- GitHub repository automation --------------------------------------
  githubStatus: () => getJson<{ ok: boolean; connected: boolean; owner?: string; repo?: string; login?: string; permissions?: Record<string, boolean>; error?: string }>("/api/github/status"),
  async githubCloneRepo(input: { owner?: string; repo?: string } = {}): Promise<GitHubActionResult> {
    const result = await postJson<GitHubActionResult>("/api/github/clone", input);
    if (result.ok) emitWorkspaceChanged(result.message);
    return result;
  },
  async githubCreateBranch(branch: string): Promise<GitHubActionResult> {
    const result = await postJson<GitHubActionResult>("/api/github/branch", { branch });
    if (result.ok) emitWorkspaceChanged(result.message);
    return result;
  },
  async githubCommitAndPush(message: string, body?: string): Promise<GitHubActionResult> {
    const result = await postJson<GitHubActionResult>("/api/github/commit-push", { message, body });
    if (result.ok) emitWorkspaceChanged(result.message);
    return result;
  },
  async githubCreatePullRequest(title: string, body?: string, base?: string): Promise<GitHubActionResult> {
    const result = await postJson<GitHubActionResult>("/api/github/pull-request", { title, body, base });
    if (result.ok) emitWorkspaceChanged(result.message);
    return result;
  },
};

// ---------------------------------------------------------------------------
// Agent tool schema — hand these to the LLM (OpenAI/Anthropic function calling)
// so the "AI Brain" can drive the workspace. executeAgentTool() dispatches a
// tool call to the bridge above and returns a JSON-serialisable result.
// ---------------------------------------------------------------------------
export interface AgentToolSpec {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export const agentTools: AgentToolSpec[] = [
  {
    name: "list_directory",
    description: "List the files and folders inside a directory. Relative paths resolve inside the active Projects folder.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Absolute path, or path relative to the active Projects folder" } }, required: ["path"] },
  },
  {
    name: "read_file",
    description: "Read the UTF-8 contents of a file. Relative paths resolve inside the active Projects folder.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Absolute path, or path relative to the active Projects folder" } }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given contents. Relative paths save inside the active Projects folder. Parent folders must exist.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute path, or path relative to the active Projects folder" }, content: { type: "string", description: "Full file contents" } },
      required: ["path", "content"],
    },
  },
  {
    name: "create_folder",
    description: "Create a folder recursively. Relative paths resolve inside the active Projects folder.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Absolute path, or path relative to the active Projects folder" } }, required: ["path"] },
  },
  {
    name: "delete_path",
    description: "Delete a file or folder (recursive) at an absolute path. Destructive — confirm with the user first.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Absolute path to delete" } }, required: ["path"] },
  },
  {
    name: "run_command",
    description: "Run a shell command and capture stdout/stderr. Use for builds, tests, git, etc.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "Command line to run" }, cwd: { type: "string", description: "Optional working directory" } },
      required: ["command"],
    },
  },
  {
    name: "live_web_search",
    description: "Search the current web for up-to-date information, scrape result pages, and return sourced text snippets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query for current or external information" },
        maxResults: { type: "number", description: "Maximum number of results to fetch, default 5" },
      },
      required: ["query"],
    },
  },
  {
    name: "review_changes",
    description: "Return the current git diff of the project so the user can inspect pending changes.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "stage_change",
    description: "Stage a changed file (git add) inside the project.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Project-relative path" } }, required: ["path"] },
  },
  {
    name: "reject_change",
    description: "Revert a changed file or delete a new untracked file inside the project.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Project-relative path" } }, required: ["path"] },
  },
  {
    name: "github_clone_repo",
    description: "Clone the connected GitHub repository into the NexusHarness repositories workspace. Optional owner/repo values override the saved connection for this call.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Optional GitHub repository owner or organization" },
        repo: { type: "string", description: "Optional GitHub repository name" },
      },
      required: [],
    },
  },
  {
    name: "github_create_branch",
    description: "Create a feature branch inside the connected GitHub repository before making changes.",
    parameters: { type: "object", properties: { branch: { type: "string", description: "Feature branch name" } }, required: ["branch"] },
  },
  {
    name: "github_commit_and_push",
    description: "Stage modified files, create a structured commit message, and push the branch to GitHub.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit subject" },
        body: { type: "string", description: "Detailed commit body" },
      },
      required: ["message"],
    },
  },
  {
    name: "github_create_pull_request",
    description: "Open a pull request for the current branch in the connected GitHub repository.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Pull request title" },
        body: { type: "string", description: "Pull request body" },
        base: { type: "string", description: "Optional base branch" },
      },
      required: ["title"],
    },
  },
];

export async function executeAgentTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const gate = typeof window !== "undefined" ? window.nexusExecutionSafety : undefined;
  if (gate) {
    const decision = await gate.inspectToolCall(name, args);
    if (decision !== "approved") {
      return {
        ok: false,
        aborted: true,
        toolName: name,
        message: "Action paused by NexusHarness safety controls. Rewrite the step without the risky operation.",
      };
    }
  }

  switch (name) {
    case "list_directory":
      return workspace.list(String(args.path ?? ""));
    case "read_file":
      return workspace.read(String(args.path ?? ""));
    case "write_file":
      return workspace.write(String(args.path ?? ""), String(args.content ?? ""));
    case "create_folder":
      return workspace.makeDir(String(args.path ?? ""));
    case "delete_path":
      return workspace.remove(String(args.path ?? ""));
    case "run_command":
      return workspace.exec(String(args.command ?? ""), args.cwd ? String(args.cwd) : undefined);
    case "live_web_search":
      return workspace.liveSearch(String(args.query ?? ""), args.maxResults ? Number(args.maxResults) : 5);
    case "review_changes":
      return workspace.diff();
    case "stage_change":
      return workspace.stage(String(args.path ?? ""));
    case "reject_change":
      return workspace.reject(String(args.path ?? ""));
    case "github_clone_repo":
      return workspace.githubCloneRepo({ owner: args.owner ? String(args.owner) : undefined, repo: args.repo ? String(args.repo) : undefined });
    case "github_create_branch":
      return workspace.githubCreateBranch(String(args.branch ?? ""));
    case "github_commit_and_push":
      return workspace.githubCommitAndPush(String(args.message ?? ""), args.body ? String(args.body) : undefined);
    case "github_create_pull_request":
      return workspace.githubCreatePullRequest(String(args.title ?? ""), args.body ? String(args.body) : undefined, args.base ? String(args.base) : undefined);
    default:
      throw new Error(`Unknown agent tool: ${name}`);
  }
}

// Expose the bridge for the agent runtime and for quick manual testing.
declare global {
  interface Window {
    nexusWorkspace?: typeof workspace & { tools: AgentToolSpec[]; execute: typeof executeAgentTool };
    nexusExecutionSafety?: {
      inspectToolCall: (toolName: string, args: Record<string, unknown>) => Promise<"approved" | "aborted">;
    };
  }
}
if (typeof window !== "undefined") {
  window.nexusWorkspace = Object.assign({}, workspace, { tools: agentTools, execute: executeAgentTool });
}
