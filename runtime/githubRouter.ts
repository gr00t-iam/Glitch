import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { Octokit } from "@octokit/rest";

export interface GitHubConnectionInput {
  token?: string;
  owner?: string;
  repo?: string;
}

export interface StoredGitHubConnection {
  owner: string;
  repo: string;
  tokenEncrypted: string;
  updatedAt: string;
}

interface GitHubConnectionPublic {
  ok: boolean;
  connected: boolean;
  owner?: string;
  repo?: string;
  login?: string;
  permissions?: Record<string, boolean>;
  error?: string;
}

interface GitHubActionResult {
  ok: boolean;
  message: string;
  path?: string;
  branch?: string;
  url?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface GitHubCommitInput {
  message?: string;
  body?: string;
}

interface GitHubPullRequestInput {
  title?: string;
  body?: string;
  base?: string;
  head?: string;
}

const ownerRepoPattern = /^[A-Za-z0-9_.-]+$/;
const branchPattern = /^[A-Za-z0-9._/-]+$/;

export async function saveGitHubConnection(workspaceRoot: string, input: GitHubConnectionInput): Promise<GitHubConnectionPublic> {
  const owner = validateOwnerOrRepo(input.owner, "owner");
  const repo = validateOwnerOrRepo(input.repo, "repo");
  const token = input.token?.trim() || process.env.NEXUS_GITHUB_TOKEN;
  if (!token) throw new Error("Missing GitHub token.");

  const octokit = new Octokit({ auth: token });
  const [user, repository] = await Promise.all([
    octokit.users.getAuthenticated(),
    octokit.repos.get({ owner, repo }),
  ]);
  const permissions = (repository.data.permissions ?? {}) as Record<string, boolean>;
  if (!permissions.push && !permissions.admin && repository.data.private) {
    throw new Error("The token can read this private repository, but it does not appear to have push access.");
  }

  const config: StoredGitHubConnection = {
    owner,
    repo,
    tokenEncrypted: encryptToken(workspaceRoot, token),
    updatedAt: new Date().toISOString(),
  };
  await writeConnection(workspaceRoot, config);
  return {
    ok: true,
    connected: true,
    owner,
    repo,
    login: user.data.login,
    permissions: normalizePermissions(permissions),
  };
}

export async function getGitHubConnectionStatus(workspaceRoot: string): Promise<GitHubConnectionPublic> {
  try {
    const config = await readConnection(workspaceRoot);
    const token = process.env.NEXUS_GITHUB_TOKEN ?? decryptToken(workspaceRoot, config.tokenEncrypted);
    const octokit = new Octokit({ auth: token });
    const [user, repository] = await Promise.all([
      octokit.users.getAuthenticated(),
      octokit.repos.get({ owner: config.owner, repo: config.repo }),
    ]);
    return {
      ok: true,
      connected: true,
      owner: config.owner,
      repo: config.repo,
      login: user.data.login,
      permissions: normalizePermissions((repository.data.permissions ?? {}) as Record<string, boolean>),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { ok: true, connected: false, error: "No GitHub connection saved yet." };
    }
    return { ok: true, connected: false, error: error instanceof Error ? error.message : "GitHub is not connected." };
  }
}

export async function cloneGitHubRepo(workspaceRoot: string, input: GitHubConnectionInput = {}): Promise<GitHubActionResult> {
  const connection = await getConnectionWithToken(workspaceRoot, input);
  const target = repoWorkspacePath(workspaceRoot, connection.owner, connection.repo);
  await mkdir(join(workspaceRoot, "repositories"), { recursive: true });
  await rm(target, { recursive: true, force: true });
  const remote = `https://github.com/${connection.owner}/${connection.repo}.git`;
  const result = await runGitWithToken(connection.token, workspaceRoot, ["clone", remote, target]);
  return {
    ok: result.exitCode === 0,
    message: result.exitCode === 0 ? `Cloned ${connection.owner}/${connection.repo}.` : "Clone failed.",
    path: target,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function createGitHubBranch(workspaceRoot: string, branch: string): Promise<GitHubActionResult> {
  const connection = await getConnectionWithToken(workspaceRoot);
  const safeBranch = validateBranch(branch);
  const repoPath = await requireRepoPath(workspaceRoot, connection.owner, connection.repo);
  const result = await runGitWithToken(connection.token, repoPath, ["checkout", "-B", safeBranch]);
  return {
    ok: result.exitCode === 0,
    message: result.exitCode === 0 ? `Created branch ${safeBranch}.` : "Branch creation failed.",
    branch: safeBranch,
    path: repoPath,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function commitAndPushGitHubRepo(workspaceRoot: string, input: GitHubCommitInput): Promise<GitHubActionResult> {
  const connection = await getConnectionWithToken(workspaceRoot);
  const repoPath = await requireRepoPath(workspaceRoot, connection.owner, connection.repo);
  const commitMessage = sanitizeCommitMessage(input.message || "NexusHarness agent update");
  const commitBody = sanitizeCommitMessage(input.body || "Changes generated and reviewed by NexusHarness.");

  await ensureGitIdentity(repoPath);
  await runGit(repoPath, ["add", "-A"]);
  const status = await runGit(repoPath, ["status", "--short"]);
  if (!status.stdout.trim()) {
    return { ok: true, message: "No workspace changes to commit.", path: repoPath, stdout: status.stdout, stderr: status.stderr };
  }
  const commit = await runGit(repoPath, ["commit", "-m", commitMessage, "-m", commitBody]);
  if (commit.exitCode !== 0) {
    return { ok: false, message: "Commit failed.", path: repoPath, stdout: commit.stdout, stderr: commit.stderr };
  }
  const push = await runGitWithToken(connection.token, repoPath, ["push", "-u", "origin", "HEAD"]);
  return {
    ok: push.exitCode === 0,
    message: push.exitCode === 0 ? "Committed and pushed workspace changes." : "Push failed.",
    path: repoPath,
    stdout: `${commit.stdout}\n${push.stdout}`.trim(),
    stderr: `${commit.stderr}\n${push.stderr}`.trim(),
  };
}

export async function createGitHubPullRequest(workspaceRoot: string, input: GitHubPullRequestInput): Promise<GitHubActionResult> {
  const connection = await getConnectionWithToken(workspaceRoot);
  const repoPath = await requireRepoPath(workspaceRoot, connection.owner, connection.repo);
  const octokit = new Octokit({ auth: connection.token });
  const repository = await octokit.repos.get({ owner: connection.owner, repo: connection.repo });
  const currentBranch = input.head ? validateBranch(input.head) : (await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  const base = input.base ? validateBranch(input.base) : repository.data.default_branch;
  const pr = await octokit.pulls.create({
    owner: connection.owner,
    repo: connection.repo,
    title: input.title?.trim() || `NexusHarness update: ${currentBranch}`,
    body: input.body?.trim() || "Automated changes prepared by NexusHarness.",
    head: currentBranch,
    base,
  });
  return { ok: true, message: `Opened pull request #${pr.data.number}.`, url: pr.data.html_url, branch: currentBranch, path: repoPath };
}

async function getConnectionWithToken(workspaceRoot: string, override: GitHubConnectionInput = {}) {
  const saved = await readConnection(workspaceRoot);
  const owner = override.owner ? validateOwnerOrRepo(override.owner, "owner") : saved.owner;
  const repo = override.repo ? validateOwnerOrRepo(override.repo, "repo") : saved.repo;
  const token = override.token?.trim() || process.env.NEXUS_GITHUB_TOKEN || decryptToken(workspaceRoot, saved.tokenEncrypted);
  if (!token) throw new Error("GitHub token is not configured.");
  return { owner, repo, token };
}

async function readConnection(workspaceRoot: string): Promise<StoredGitHubConnection> {
  const raw = await readFile(connectionPath(workspaceRoot), "utf8");
  return JSON.parse(raw) as StoredGitHubConnection;
}

async function writeConnection(workspaceRoot: string, config: StoredGitHubConnection): Promise<void> {
  await mkdir(configDirectory(workspaceRoot), { recursive: true });
  await writeFile(connectionPath(workspaceRoot), JSON.stringify(config, null, 2), "utf8");
}

function configDirectory(workspaceRoot: string): string {
  return join(workspaceRoot, ".nexusharness");
}

function connectionPath(workspaceRoot: string): string {
  return join(configDirectory(workspaceRoot), "github-connection.json");
}

function encryptionKey(workspaceRoot: string, salt: Buffer): Buffer {
  return scryptSync(process.env.NEXUS_LOCAL_SECRET || `${hostname()}:${resolve(workspaceRoot)}`, salt, 32);
}

function encryptToken(workspaceRoot: string, token: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(workspaceRoot, salt), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function decryptToken(workspaceRoot: string, payload: string): string {
  const bytes = Buffer.from(payload, "base64");
  const salt = bytes.subarray(0, 16);
  const iv = bytes.subarray(16, 28);
  const tag = bytes.subarray(28, 44);
  const encrypted = bytes.subarray(44);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(workspaceRoot, salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function validateOwnerOrRepo(value: string | undefined, label: "owner" | "repo"): string {
  const trimmed = value?.trim();
  if (!trimmed || !ownerRepoPattern.test(trimmed)) throw new Error(`Invalid GitHub ${label}.`);
  return trimmed;
}

function validateBranch(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.startsWith("/") || trimmed.endsWith("/") || !branchPattern.test(trimmed)) {
    throw new Error("Invalid branch name.");
  }
  return trimmed;
}

function sanitizeCommitMessage(value: string): string {
  return value.replace(/\r/g, "").trim().slice(0, 4000) || "NexusHarness agent update";
}

function repoWorkspacePath(workspaceRoot: string, owner: string, repo: string): string {
  const safeName = `${owner}__${repo}`.replace(/[^A-Za-z0-9_.-]/g, "_");
  const candidate = resolve(workspaceRoot, "repositories", safeName);
  const root = resolve(workspaceRoot, "repositories");
  const pathRelative = relative(root, candidate);
  if (pathRelative.startsWith("..") || pathRelative.includes(`..${sep}`) || resolve(candidate) === root) {
    throw new Error("Repository path escaped the designated workspace.");
  }
  return candidate;
}

async function requireRepoPath(workspaceRoot: string, owner: string, repo: string): Promise<string> {
  const repoPath = repoWorkspacePath(workspaceRoot, owner, repo);
  const repoStat = await stat(join(repoPath, ".git")).catch(() => null);
  if (!repoStat) throw new Error(`Repository is not cloned yet. Run github_clone_repo first for ${owner}/${repo}.`);
  return repoPath;
}

function normalizePermissions(permissions: Record<string, boolean>): Record<string, boolean> {
  return {
    admin: Boolean(permissions.admin),
    maintain: Boolean(permissions.maintain),
    push: Boolean(permissions.push),
    triage: Boolean(permissions.triage),
    pull: Boolean(permissions.pull),
  };
}

function gitEnv(token?: string): NodeJS.ProcessEnv {
  if (!token) return process.env;
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
  };
}

function runGitWithToken(token: string, cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runGit(cwd, args, token);
}

async function ensureGitIdentity(repoPath: string): Promise<void> {
  const [name, email] = await Promise.all([
    runGit(repoPath, ["config", "user.name"]),
    runGit(repoPath, ["config", "user.email"]),
  ]);
  if (!name.stdout.trim()) {
    await runGit(repoPath, ["config", "user.name", "NexusHarness Agent"]);
  }
  if (!email.stdout.trim()) {
    await runGit(repoPath, ["config", "user.email", "nexusharness-agent@users.noreply.github.com"]);
  }
}

function runGit(cwd: string, args: string[], token?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise) => {
    const child = execFile("git", args, { cwd, env: gitEnv(token), windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolvePromise({
        stdout,
        stderr,
        exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
      });
    });
    child.on("error", (error) => resolvePromise({ stdout: "", stderr: error.message, exitCode: 1 }));
  });
}

export const gitHubToolSchemas = [
  {
    name: "github_clone_repo",
    description: "Clone the connected GitHub repository into the designated NexusHarness repositories workspace. Optional owner/repo values override the saved connection for this call.",
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
    description: "Create or reset a local feature branch inside the connected repository.",
    parameters: { type: "object", properties: { branch: { type: "string", description: "Feature branch name" } }, required: ["branch"] },
  },
  {
    name: "github_commit_and_push",
    description: "Stage all changed files, create a structured commit, and push the current branch to GitHub.",
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
    description: "Open a pull request from the current branch to the repository default branch.",
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
