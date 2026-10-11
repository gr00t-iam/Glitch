import { defineConfig, Plugin, ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { IncomingMessage, ServerResponse } from "node:http";
import { basename, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { IPty } from "node-pty";
import { WebSocketServer } from "ws";
import { executeConfirmedAutomation, handleAgentConfirmation, handleAgentMessage } from "./runtime/agentRuntime";
import {
  cloneGitHubRepo,
  commitAndPushGitHubRepo,
  createGitHubBranch,
  createGitHubPullRequest,
  getGitHubConnectionStatus,
  saveGitHubConnection,
} from "./runtime/githubRouter";
import type { AutomationKind } from "./runtime/types";

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "react-window": resolve(__dirname, "src/vendor/react-window.tsx"),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/ollama": {
        target: "http://127.0.0.1:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ""),
      },
      "/cdp": {
        target: "http://127.0.0.1:9222",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cdp/, ""),
      },
    },
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  plugins: [
    nexusLocalRuntime(),
    tailwindcss(),
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "service-worker.ts",
      registerType: "autoUpdate",
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,json}"],
      },
      devOptions: {
        enabled: false,
        type: "module",
      },
    }),
  ],
  worker: {
    format: "es",
  },
});

function nexusLocalRuntime(): Plugin {
  return {
    name: "nexusharness-local-runtime",
    configureServer(server: ViteDevServer) {
      attachNexusRuntime(server);
    },
    configurePreviewServer(server) {
      attachNexusRuntime(server as unknown as Pick<ViteDevServer, "middlewares" | "httpServer">);
    },
  };
}

type NexusRuntimeServer = Pick<ViteDevServer, "middlewares" | "httpServer"> & { ws?: ViteDevServer["ws"] };

let pythonSidecarStartPromise: Promise<boolean> | null = null;

async function pythonSidecarIsReady(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:8765/health", { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensurePythonSidecar(workspaceRoot: string): Promise<boolean> {
  if (await pythonSidecarIsReady()) return true;
  if (pythonSidecarStartPromise) return pythonSidecarStartPromise;

  pythonSidecarStartPromise = (async () => {
    const python = join(workspaceRoot, ".venv", "Scripts", "python.exe");
    try {
      const pythonStat = await stat(python);
      if (!pythonStat.isFile()) return false;
      const child = spawn(python, ["-m", "uvicorn", "server.agent_wrapper:app", "--host", "127.0.0.1", "--port", "8765"], {
        cwd: workspaceRoot,
        detached: true,
        env: { ...process.env, NEXUS_PROJECT_ROOT: workspaceRoot },
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
        if (await pythonSidecarIsReady()) return true;
      }
      return false;
    } catch {
      return false;
    }
  })();

  try {
    return await pythonSidecarStartPromise;
  } finally {
    pythonSidecarStartPromise = null;
  }
}

function attachNexusRuntime(server: NexusRuntimeServer): void {
      const workspaceRoot = process.cwd();
      void ensurePythonSidecar(workspaceRoot);
      let runtimeToken = "";
      let runtimeTokenExpiresAt = 0;

      function issueRuntimeToken(): string {
        runtimeToken = randomUUID();
        runtimeTokenExpiresAt = Date.now() + 60_000;
        return runtimeToken;
      }

      server.middlewares.use("/health", async (_request: IncomingMessage, response: ServerResponse) => {
        response.setHeader("content-type", "application/json");
        try {
          const result = await fetch("http://127.0.0.1:9222/json/version");
          if (!result.ok) throw new Error(`Chrome returned HTTP ${result.status}`);
          response.end(JSON.stringify({ status: "ok", version: "nexusharness-runtime/1", pid: process.pid, wsUrl: "", ephemeralToken: issueRuntimeToken(), tokenExpiresAt: runtimeTokenExpiresAt }));
        } catch (error) {
          response.end(JSON.stringify({ status: "error", version: "nexusharness-runtime/1", pid: process.pid, message: error instanceof Error ? error.message : "Browser runtime unavailable." }));
        }
      });

      server.middlewares.use("/start", (request: IncomingMessage, response: ServerResponse) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { started: false, message: "Use POST." });
          return;
        }
        const child = spawn(process.execPath, [join(process.cwd(), "scripts", "launch-chrome-cdp.mjs")], {
          cwd: process.cwd(),
          detached: true,
          env: { ...process.env, NEXUS_CDP_PORT: "9222", NEXUS_CHROME_HEADLESS: "1", NEXUS_REPLACE_EXISTING: "1" },
          stdio: "ignore",
          windowsHide: true,
        });
        child.unref();
        sendJson(response, 200, { started: true, pid: child.pid, port: 9222, message: "Runtime launch requested." });
      });

      server.middlewares.use("/api/browser/launch", (request: IncomingMessage, response: ServerResponse) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end(JSON.stringify({ ok: false, error: "Use POST." }));
          return;
        }

        const child = spawn(process.execPath, [join(process.cwd(), "scripts", "launch-chrome-cdp.mjs")], {
          cwd: process.cwd(),
          detached: true,
          env: { ...process.env, NEXUS_CDP_PORT: "9222", NEXUS_CHROME_HEADLESS: "1", NEXUS_REPLACE_EXISTING: "1" },
          stdio: "ignore",
        });
        child.unref();

        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true, port: 9222 }));
      });

      server.middlewares.use("/api/browser/status", async (_request: IncomingMessage, response: ServerResponse) => {
        response.setHeader("content-type", "application/json");
        try {
          const result = await fetch("http://127.0.0.1:9222/json/version");
          if (!result.ok) throw new Error(`Chrome returned HTTP ${result.status}`);
          const version = await result.json();
          response.end(JSON.stringify({ ok: true, connected: true, version }));
        } catch (error) {
          response.end(
            JSON.stringify({
              ok: true,
              connected: false,
              error: error instanceof Error ? error.message : "Browser is not running.",
            }),
          );
        }
      });

      server.middlewares.use("/api/tts", async (request: IncomingMessage, response: ServerResponse) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { ok: false, error: "Use POST." });
          return;
        }
        try {
          if (!await ensurePythonSidecar(workspaceRoot)) throw new Error("Python voice service is unavailable.");
          const body = await readJsonBody<{ text?: string }>(request);
          const text = body.text?.trim() ?? "";
          if (!text) {
            sendJson(response, 400, { ok: false, error: "Please provide text to speak." });
            return;
          }
          const result = await fetch("http://127.0.0.1:8765/tts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
            redirect: "error",
            signal: AbortSignal.timeout(65_000),
          });
          const payload = await result.text();
          response.statusCode = result.status;
          response.setHeader("content-type", "application/json");
          response.setHeader("cache-control", "no-store");
          response.end(payload);
        } catch {
          sendJson(response, 503, { ok: false, error: "Piper voice is unavailable right now." });
        }
      });

      server.middlewares.use("/api/chat/complete", async (request: IncomingMessage, response: ServerResponse) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Use POST." });
          return;
        }
        try {
          if (!await ensurePythonSidecar(workspaceRoot)) throw new Error("Python voice service is unavailable.");
          const body = await readJsonBody<{ text?: string }>(request);
          const result = await fetch("http://127.0.0.1:8765/chat/complete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: body.text?.trim() ?? "" }),
            redirect: "error",
            signal: AbortSignal.timeout(65_000),
          });
          response.statusCode = result.status;
          response.setHeader("content-type", "application/json");
          response.setHeader("cache-control", "no-store");
          response.end(await result.text());
        } catch {
          sendJson(response, 503, { error: "Piper voice is unavailable right now." });
        }
      });

      server.middlewares.use("/cache/latest_response.wav", async (_request: IncomingMessage, response: ServerResponse) => {
        try {
          if (!await ensurePythonSidecar(workspaceRoot)) throw new Error("Python voice service is unavailable.");
          const result = await fetch("http://127.0.0.1:8765/cache/latest_response.wav", {
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
          });
          if (!result.ok) throw new Error("Audio is unavailable.");
          response.statusCode = 200;
          response.setHeader("content-type", "audio/wav");
          response.setHeader("cache-control", "no-store");
          response.end(new Uint8Array(await result.arrayBuffer()));
        } catch {
          sendJson(response, 404, { error: "Audio is unavailable right now." });
        }
      });

      server.middlewares.use("/api/agent/message", async (request: IncomingMessage, response: ServerResponse) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { ok: false, error: "Use POST." });
          return;
        }
        try {
          const body = await readJsonBody<{ message?: string }>(request);
          sendJson(response, 200, await handleAgentMessage(workspaceRoot, { message: body.message ?? "" }));
        } catch (error) {
          sendJson(response, 500, { ok: false, mode: "chat", message: "Agent request failed.", error: error instanceof Error ? error.message : "Unknown error." });
        }
      });

      server.middlewares.use("/api/agent/confirm", async (request: IncomingMessage, response: ServerResponse) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { ok: false, error: "Use POST." });
          return;
        }
        try {
          const body = await readJsonBody<{ actionId?: string; approved?: boolean }>(request);
          sendJson(response, 200, await handleAgentConfirmation(workspaceRoot, { actionId: body.actionId ?? "", approved: Boolean(body.approved) }));
        } catch (error) {
          sendJson(response, 500, { ok: false, message: "Confirmation failed.", error: error instanceof Error ? error.message : "Unknown error." });
        }
      });

      server.middlewares.use("/api/skills/generate", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          if (request.method !== "POST") throw new Error("Use POST.");
          const body = await readJsonBody<{ description?: string; name?: string }>(request);
          if (!body.description || !body.description.trim()) throw new Error("Missing skill description.");
          const generated = await generateAgentSkill(workspaceRoot, body.description, body.name);
          server.ws?.send({ type: "full-reload", path: "*" });
          return { ok: true, ...generated };
        });
      });

      server.middlewares.use("/automation/keyboard", async (request: IncomingMessage, response: ServerResponse) => {
        await handleAutomationEndpoint(workspaceRoot, "keyboard", request, response);
      });

      server.middlewares.use("/automation/mouse", async (request: IncomingMessage, response: ServerResponse) => {
        await handleAutomationEndpoint(workspaceRoot, "mouse", request, response);
      });

      server.middlewares.use("/automation/shell", async (request: IncomingMessage, response: ServerResponse) => {
        await handleAutomationEndpoint(workspaceRoot, "shell", request, response);
      });

      server.middlewares.use("/api/workspace/tree", async (request: IncomingMessage, response: ServerResponse) => {
        response.setHeader("content-type", "application/json");
        try {
          const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
          const requestedPath = requestUrl.searchParams.get("path") ?? "";
          const directoryPath = safeWorkspacePath(workspaceRoot, requestedPath);
          const directoryStat = await stat(directoryPath);
          if (!directoryStat.isDirectory()) {
            response.statusCode = 400;
            response.end(JSON.stringify({ ok: false, error: "Path is not a directory." }));
            return;
          }

          const entries = await readDirectoryEntries(workspaceRoot, directoryPath);
          response.end(JSON.stringify({ ok: true, root: workspaceRoot, path: toWorkspaceRelativePath(workspaceRoot, directoryPath), entries }));
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Could not read directory." }));
        }
      });

      server.middlewares.use("/api/workspace/file", async (request: IncomingMessage, response: ServerResponse) => {
        response.setHeader("content-type", "application/json");
        try {
          const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
          const requestedPath = requestUrl.searchParams.get("path");
          if (!requestedPath) {
            response.statusCode = 400;
            response.end(JSON.stringify({ ok: false, error: "Missing file path." }));
            return;
          }

          const filePath = safeWorkspacePath(workspaceRoot, requestedPath);
          const fileStat = await stat(filePath);
          if (!fileStat.isFile()) {
            response.statusCode = 400;
            response.end(JSON.stringify({ ok: false, error: "Path is not a file." }));
            return;
          }
          if (fileStat.size > 512 * 1024) {
            response.statusCode = 413;
            response.end(JSON.stringify({ ok: false, error: "File is too large to preview." }));
            return;
          }

          const content = await readFile(filePath, "utf8");
          response.end(
            JSON.stringify({
              ok: true,
              path: toWorkspaceRelativePath(workspaceRoot, filePath),
              size: fileStat.size,
              modifiedAt: fileStat.mtime.toISOString(),
              content,
            }),
          );
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Could not read file." }));
        }
      });

      server.middlewares.use("/api/workspace/diff", async (_request: IncomingMessage, response: ServerResponse) => {
        response.setHeader("content-type", "application/json");
        try {
          const [statusText, diffText] = await Promise.all([
            runGit(workspaceRoot, ["status", "--short"]),
            runGit(workspaceRoot, ["diff", "--no-ext-diff", "--src-prefix=before/", "--dst-prefix=after/"]),
          ]);
          const statusEntries = parseGitStatus(statusText);
          const diffFiles = await mergeStatusOnlyDiffFiles(workspaceRoot, parseUnifiedDiff(diffText), statusEntries);
          response.end(JSON.stringify({ ok: true, status: statusEntries, files: diffFiles }));
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Could not read git changes." }));
        }
      });

      // ---------------------------------------------------------------------
      // Whole-PC filesystem bridge (local-first; server runs on 127.0.0.1).
      // These operate on ABSOLUTE paths so the Files tab can browse any drive.
      // ---------------------------------------------------------------------
      server.middlewares.use("/api/project-directory", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          if (request.method === "POST") {
            const body = await readJsonBody<{ path?: string }>(request);
            if (!body.path) throw new Error("Missing folder path.");
            const target = resolveAbsolute(body.path);
            const targetStat = await stat(target);
            if (!targetStat.isDirectory()) throw new Error("Selected path is not a folder.");
            await saveActiveProjectRoot(workspaceRoot, target);
            return { ok: true, path: normalizeAbsolute(target) };
          }
          return { ok: true, path: await getActiveProjectRoot(workspaceRoot) };
        });
      });

      server.middlewares.use("/api/fs/roots", async (_request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => ({ ok: true, ...(await listFsRoots(workspaceRoot)) }));
      });

      server.middlewares.use("/api/fs/list", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          const requested = new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("path");
          if (!requested) throw new Error("Missing path.");
          return { ok: true, ...(await listFsDirectory(workspaceRoot, requested)) };
        });
      });

      server.middlewares.use("/api/fs/read", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          const requested = new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("path");
          if (!requested) throw new Error("Missing path.");
          return { ok: true, ...(await readFsFile(workspaceRoot, requested)) };
        });
      });

      server.middlewares.use("/api/fs/write", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          const body = await readJsonBody<{ path?: string; content?: string }>(request);
          if (!body.path) throw new Error("Missing path.");
          const target = await resolveFsPath(workspaceRoot, body.path);
          await writeFile(target, body.content ?? "", "utf8");
          return { ok: true, path: normalizeAbsolute(target) };
        });
      });

      server.middlewares.use("/api/fs/mkdir", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          const body = await readJsonBody<{ path?: string }>(request);
          if (!body.path) throw new Error("Missing path.");
          const target = await resolveFsPath(workspaceRoot, body.path);
          await mkdir(target, { recursive: true });
          return { ok: true, path: normalizeAbsolute(target) };
        });
      });

      server.middlewares.use("/api/fs/delete", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          const body = await readJsonBody<{ path?: string }>(request);
          if (!body.path) throw new Error("Missing path.");
          const target = await resolveFsPath(workspaceRoot, body.path);
          await rm(target, { recursive: true, force: true });
          return { ok: true, path: normalizeAbsolute(target) };
        });
      });

      server.middlewares.use("/api/fs/rename", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          const body = await readJsonBody<{ from?: string; to?: string }>(request);
          if (!body.from || !body.to) throw new Error("Missing from/to.");
          const from = await resolveFsPath(workspaceRoot, body.from);
          const to = await resolveFsPath(workspaceRoot, body.to);
          await rename(from, to);
          return { ok: true, from: normalizeAbsolute(from), to: normalizeAbsolute(to) };
        });
      });

      server.middlewares.use("/api/workspace/stage", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          const body = await readJsonBody<{ path?: string }>(request);
          const target = body.path ? safeWorkspacePath(workspaceRoot, body.path) : workspaceRoot;
          await runGit(workspaceRoot, ["add", "--", body.path ?? "."]);
          return { ok: true, staged: toWorkspaceRelativePath(workspaceRoot, target) };
        });
      });

      server.middlewares.use("/api/workspace/reject", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          const body = await readJsonBody<{ path?: string }>(request);
          if (!body.path) throw new Error("Missing path.");
          const absolute = safeWorkspacePath(workspaceRoot, body.path);
          const tracked = await runGit(workspaceRoot, ["ls-files", "--error-unmatch", "--", body.path]).then(() => true).catch(() => false);
          if (tracked) {
            await runGit(workspaceRoot, ["checkout", "--", body.path]);
          } else {
            await rm(absolute, { recursive: true, force: true });
          }
          return { ok: true, reverted: body.path };
        });
      });

      // Persistent Memory.MD — the human-editable long-term memory file.
      server.middlewares.use("/api/memory", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          const memoryPath = join(workspaceRoot, "Persistent Memory.MD");
          if (request.method === "POST" || request.method === "PUT") {
            const body = await readJsonBody<{ content?: string }>(request);
            await writeFile(memoryPath, body.content ?? "", "utf8");
            return { ok: true, path: "Persistent Memory.MD", bytes: Buffer.byteLength(body.content ?? "", "utf8") };
          }
          let content: string;
          try {
            content = await readFile(memoryPath, "utf8");
          } catch {
            content = "# Persistent Memory\n\nNexusHarness keeps long-term facts and learned lessons here.\n\n- Add notes the assistant should always remember.\n";
          }
          return { ok: true, path: "Persistent Memory.MD", content };
        });
      });

      server.middlewares.use("/api/chat-memory", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          const archiveDirectory = join(workspaceRoot, ".nexusharness", "memory");
          const archivePath = join(archiveDirectory, "chat-history.jsonl");
          if (request.method === "POST") {
            const body = await readJsonBody<{
              id?: string;
              sessionId?: string;
              title?: string;
              model?: string;
              summary?: string;
              savedAt?: number;
              entries?: Array<{
                id?: string;
                sessionId?: string;
                title?: string;
                model?: string;
                summary?: string;
                savedAt?: number;
              }>;
            }>(request);
            await mkdir(archiveDirectory, { recursive: true });
            let existing = "";
            try {
              existing = await readFile(archivePath, "utf8");
            } catch {
              /* The archive is created on its first retained chat. */
            }
            const candidates = body.entries ?? [body];
            const lines: string[] = [];
            for (const candidate of candidates) {
              if (!candidate.id || !candidate.sessionId || !candidate.summary) continue;
              if (existing.includes(`\"id\":\"${candidate.id}\"`) || lines.some((line) => line.includes(`\"id\":\"${candidate.id}\"`))) continue;
              lines.push(JSON.stringify({
                id: candidate.id,
                sessionId: candidate.sessionId,
                title: (candidate.title || "Untitled chat").slice(0, 200),
                model: (candidate.model || "unknown").slice(0, 200),
                summary: candidate.summary.slice(0, 12000),
                savedAt: candidate.savedAt || Date.now(),
              }));
            }
            if (lines.length) await appendFile(archivePath, `${lines.join("\n")}\n`, "utf8");
            return { ok: true, stored: lines.length };
          }

          const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
          const limit = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get("limit")) || 12));
          let content = "";
          try {
            content = await readFile(archivePath, "utf8");
          } catch {
            return { ok: true, entries: [] };
          }
          const entries = content
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(-limit)
            .reverse()
            .flatMap((line) => {
              try {
                return [JSON.parse(line) as unknown];
              } catch {
                return [];
              }
            });
          return { ok: true, entries };
        });
      });

      server.middlewares.use("/api/github/status", async (_request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => getGitHubConnectionStatus(workspaceRoot));
      });

      server.middlewares.use("/api/github/connect", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          if (request.method !== "POST") throw new Error("Use POST.");
          const body = await readJsonBody<{ token?: string; owner?: string; repo?: string }>(request);
          return saveGitHubConnection(workspaceRoot, body);
        });
      });

      server.middlewares.use("/api/github/clone", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          if (request.method !== "POST") throw new Error("Use POST.");
          const body = await readJsonBody<{ owner?: string; repo?: string }>(request);
          return cloneGitHubRepo(workspaceRoot, body);
        });
      });

      server.middlewares.use("/api/github/branch", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          if (request.method !== "POST") throw new Error("Use POST.");
          const body = await readJsonBody<{ branch?: string }>(request);
          if (!body.branch) throw new Error("Missing branch name.");
          return createGitHubBranch(workspaceRoot, body.branch);
        });
      });

      server.middlewares.use("/api/github/commit-push", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          if (request.method !== "POST") throw new Error("Use POST.");
          const body = await readJsonBody<{ message?: string; body?: string }>(request);
          return commitAndPushGitHubRepo(workspaceRoot, body);
        });
      });

      server.middlewares.use("/api/github/pull-request", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          if (request.method !== "POST") throw new Error("Use POST.");
          const body = await readJsonBody<{ title?: string; body?: string; base?: string; head?: string }>(request);
          return createGitHubPullRequest(workspaceRoot, body);
        });
      });

      // Agent command execution with captured stdout/stderr (non-interactive).
      server.middlewares.use("/api/exec", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          if (request.method !== "POST") throw new Error("Use POST.");
          const body = await readJsonBody<{ command?: string; cwd?: string }>(request);
          if (!body.command || !body.command.trim()) throw new Error("Missing command.");
          const cwd = body.cwd ? await resolveFsPath(workspaceRoot, body.cwd) : await getActiveProjectRoot(workspaceRoot);
          const result = await runShellCommand(workspaceRoot, body.command, cwd);
          return { ok: true, ...result };
        });
      });

      server.middlewares.use("/api/models/delete", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          if (request.method !== "POST" && request.method !== "DELETE") throw new Error("Use POST or DELETE.");
          const body = await readJsonBody<{ name?: string }>(request);
          if (!body.name || !body.name.trim()) throw new Error("Missing model name.");
          return { ok: true, ...(await deleteLocalModel(body.name.trim())) };
        });
      });

      server.middlewares.use("/api/search/live", async (request: IncomingMessage, response: ServerResponse) => {
        await sendJsonSafe(response, async () => {
          if (request.method !== "POST") throw new Error("Use POST.");
          const body = await readJsonBody<{ query?: string; maxResults?: number }>(request);
          if (!body.query || !body.query.trim()) throw new Error("Missing search query.");
          return { ok: true, ...(await runLiveWebSearch(body.query, body.maxResults)) };
        });
      });

      const terminalServer = new WebSocketServer({ noServer: true });
      terminalServer.on("connection", async (socket) => {
        let terminalProcess: IPty | null = null;
        const heartbeat = setInterval(() => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "heartbeat", at: Date.now() }));
          }
        }, 15000);
        try {
          const pty = await import("node-pty");
          const { shell, args } = resolveShell();
          terminalProcess = pty.spawn(shell, args, {
            name: "xterm-256color",
            cols: 100,
            rows: 30,
            cwd: process.env.HOME ?? process.env.USERPROFILE ?? workspaceRoot,
            env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
          });

          socket.send(JSON.stringify({ type: "ready", shell, cwd: workspaceRoot }));
          terminalProcess.onData((data) => {
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "output", data }));
          });
          terminalProcess.onExit(({ exitCode }) => {
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "exit", exitCode }));
          });

          socket.on("message", (rawMessage) => {
            try {
              const message = JSON.parse(rawMessage.toString()) as { type: "input" | "resize"; data?: string; cols?: number; rows?: number };
              if (!terminalProcess) return;
              if (message.type === "input" && typeof message.data === "string") terminalProcess.write(message.data);
              if (message.type === "resize" && message.cols && message.rows) terminalProcess.resize(message.cols, message.rows);
            } catch {
              if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "error", message: "Terminal message could not be parsed." }));
            }
          });
        } catch (error) {
          socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Terminal failed to start." }));
        }

        socket.on("close", () => {
          clearInterval(heartbeat);
          terminalProcess?.kill();
          terminalProcess = null;
        });
      });

      server.httpServer?.on("upgrade", (request, socket, head) => {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
        if (requestUrl.pathname !== "/api/workspace/terminal") return;
        terminalServer.handleUpgrade(request, socket, head, (client) => {
          terminalServer.emit("connection", client, request);
        });
      });
}

async function handleAutomationEndpoint(workspaceRoot: string, kind: AutomationKind, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, error: "Use POST." });
    return;
  }
  try {
    const confirmationToken = request.headers["x-nexus-confirmation"];
    const token = Array.isArray(confirmationToken) ? confirmationToken[0] : confirmationToken;
    const payload = await readJsonBody<Record<string, unknown>>(request);
    const result = await executeConfirmedAutomation(
      workspaceRoot,
      {
        kind,
        payload,
        reason: `direct ${kind} automation endpoint request`,
      },
      token,
    );
    sendJson(response, result.ok ? 200 : 403, result);
  } catch (error) {
    sendJson(response, 500, { ok: false, kind, error: error instanceof Error ? error.message : "Automation request failed." });
  }
}

function resolveShell(): { shell: string; args: string[] } {
  // Explicit override wins: set NEXUS_SHELL to any shell binary/path.
  const override = process.env.NEXUS_SHELL;
  if (override) return { shell: override, args: [] };

  if (process.platform === "win32") {
    // PowerShell by default (ConPTY emits proper VT sequences for xterm).
    // Set NEXUS_USE_CMD=1 to use the classic Command Prompt instead.
    if (process.env.NEXUS_USE_CMD) return { shell: process.env.COMSPEC ?? "cmd.exe", args: [] };
    return { shell: "powershell.exe", args: ["-NoLogo"] };
  }
  // macOS / Linux / Android (Termux): honour the user's login shell first.
  if (process.env.SHELL) return { shell: process.env.SHELL, args: [] };
  if (process.platform === "darwin") return { shell: "/bin/zsh", args: [] };
  return { shell: "/bin/bash", args: [] };
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

interface GeneratedAgentSkill {
  id: string;
  name: string;
  description: string;
  triggerKeywords: string[];
  directory: string;
  files: string[];
}

async function generateAgentSkill(workspaceRoot: string, description: string, explicitName?: string): Promise<GeneratedAgentSkill> {
  const cleanDescription = description.replace(/\s+/g, " ").trim().slice(0, 2000);
  const name = normalizeSkillName(explicitName || inferSkillName(cleanDescription));
  const slug = slugify(name);
  const id = `generated_${slug}`;
  const triggerKeywords = inferSkillTriggers(name, cleanDescription);
  const skillDirectory = join(workspaceRoot, ".agents", "skills", slug);
  await mkdir(skillDirectory, { recursive: true });

  const files: Record<string, string> = {
    "skill.json": JSON.stringify(
      {
        id,
        name,
        description: cleanDescription,
        triggerKeywords,
        backend: "backend.py",
        component: "SkillPanel.tsx",
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "README.md": renderGeneratedSkillReadme(name, cleanDescription),
    "backend.py": renderGeneratedPythonBackend(name, cleanDescription),
    "SkillPanel.tsx": renderGeneratedSkillPanel(name, cleanDescription),
    "index.mjs": renderGeneratedSkillModule(id, name, cleanDescription, triggerKeywords),
  };

  for (const [fileName, content] of Object.entries(files)) {
    await writeFile(join(skillDirectory, fileName), content, "utf8");
  }

  return {
    id,
    name,
    description: cleanDescription,
    triggerKeywords,
    directory: skillDirectory,
    files: Object.keys(files),
  };
}

function normalizeSkillName(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "Generated Skill";
  return normalized
    .split(" ")
    .slice(0, 6)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function inferSkillName(description: string): string {
  const match = description.match(/(?:called|named)\s+["']?([a-zA-Z0-9][a-zA-Z0-9 _-]{2,50})["']?/i);
  if (match?.[1]) return match[1];
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !["the", "and", "for", "with", "that", "this", "tool", "skill", "create", "make", "build"].includes(word));
  return words.slice(0, 4).join(" ") || "Generated Skill";
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "generated_skill";
}

function inferSkillTriggers(name: string, description: string): string[] {
  const words = `${name} ${description}`
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !["the", "and", "for", "with", "that", "this", "tool", "skill", "from", "into"].includes(word));
  return [...new Set(words)].slice(0, 8);
}

function renderGeneratedSkillReadme(name: string, description: string): string {
  return [
    `# ${name}`,
    "",
    "Generated by NexusHarness Skill Generator.",
    "",
    "## Description",
    "",
    description,
    "",
    "## Files",
    "",
    "- `backend.py`: safe Python backend scaffold.",
    "- `SkillPanel.tsx`: frontend panel scaffold.",
    "- `index.mjs`: hot-loadable NexusHarness skill module.",
    "- `skill.json`: metadata used by the Skill Store.",
    "",
  ].join("\n");
}

function renderGeneratedPythonBackend(name: string, description: string): string {
  const safeDescription = escapePythonDocstring(description);
  return `"""Backend scaffold for ${name}.

Description:
${safeDescription}

This module is intentionally conservative. Extend run() with narrowly scoped
logic and keep filesystem/network access behind explicit allow-lists.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class SkillResult:
    ok: bool
    message: str
    data: dict[str, Any]


def run(payload: dict[str, Any] | None = None) -> SkillResult:
    payload = payload or {}
    return SkillResult(
        ok=True,
        message="${name} backend scaffold executed.",
        data={
            "received": payload,
            "next_step": "Replace this scaffold with validated, allow-listed backend logic.",
        },
    )
`;
}

function renderGeneratedSkillPanel(name: string, description: string): string {
  const componentBaseName = componentNameForSkill(name);
  const safeDescription = escapeTsxText(description);
  return `import { useState } from "react";

export interface ${componentBaseName}SkillPanelProps {
  onRun?: (payload: Record<string, unknown>) => Promise<unknown>;
}

export function SkillPanel({ onRun }: ${componentBaseName}SkillPanelProps) {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Ready");

  async function runSkill() {
    setStatus("Running...");
    try {
      const result = await onRun?.({ input });
      setStatus(result ? "Completed" : "No runner is connected yet");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Skill failed");
    }
  }

  return (
    <section className="generated-skill-panel" aria-label="${name}">
      <header>
        <h2>${name}</h2>
        <p>${safeDescription}</p>
      </header>
      <label>
        Input
        <textarea value={input} onChange={(event) => setInput(event.target.value)} />
      </label>
      <button type="button" onClick={() => void runSkill()}>
        Run
      </button>
      <span>{status}</span>
    </section>
  );
}
`;
}

function escapePythonDocstring(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
}

function escapeTsxText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/{/g, "&#123;").replace(/}/g, "&#125;");
}

function componentNameForSkill(name: string): string {
  const candidate = name.replace(/[^a-zA-Z0-9]/g, "");
  const normalized = candidate && /^[a-zA-Z]/.test(candidate) ? candidate : `Generated${candidate}`;
  return normalized || "Generated";
}

function renderGeneratedSkillModule(id: string, name: string, description: string, triggers: string[]): string {
  return `export default {
  id: ${JSON.stringify(id)},
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
  triggers: ${JSON.stringify(triggers)},
  instructions: ${JSON.stringify(`Generated skill: ${description}`)},
  apply(input) {
    const lower = input.userInput.toLowerCase();
    const matched = this.triggers.some((trigger) => lower.includes(trigger));
    if (!matched) return {};
    return {
      responsePrefix: ${JSON.stringify(`${name} loaded. `)},
    };
  },
};
`;
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const maxJsonBodyBytes = envNumber("NEXUS_MAX_JSON_MB", 64) * 1024 * 1024;
const maxFilePreviewBytes = envNumber("NEXUS_MAX_FILE_PREVIEW_MB", 32) * 1024 * 1024;

function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    let raw = "";
    let rejected = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (rejected) return;
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > maxJsonBodyBytes) {
        rejected = true;
        request.destroy(new Error(`Request body is larger than the configured ${Math.round(maxJsonBodyBytes / 1024 / 1024)} MB limit.`));
        reject(new Error(`Request body is larger than the configured ${Math.round(maxJsonBodyBytes / 1024 / 1024)} MB limit.`));
      }
    });
    request.on("end", () => {
      if (rejected) return;
      try {
        resolvePromise(raw ? (JSON.parse(raw) as T) : ({} as T));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

interface FileTreeEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  modifiedAt: string;
}

interface GitStatusEntry {
  path: string;
  status: string;
}

interface DiffLine {
  type: "context" | "added" | "deleted" | "meta";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

const ignoredDirectoryNames = new Set([".git", "node_modules", "dist", ".vite", ".next", "coverage"]);

function safeWorkspacePath(workspaceRoot: string, requestedPath: string): string {
  const candidate = resolve(workspaceRoot, requestedPath || ".");
  const normalizedRoot = resolve(workspaceRoot);
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("Path escapes the workspace.");
  }
  return candidate;
}

function toWorkspaceRelativePath(workspaceRoot: string, filePath: string): string {
  return relative(workspaceRoot, filePath).replace(/\\/g, "/");
}

async function readDirectoryEntries(workspaceRoot: string, directoryPath: string): Promise<FileTreeEntry[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const visibleEntries = entries.filter((entry) => !entry.name.startsWith(".") && !ignoredDirectoryNames.has(entry.name));
  const detailedEntries = await Promise.all(
    visibleEntries.map(async (entry) => {
      const fullPath = join(directoryPath, entry.name);
      const entryStat = await stat(fullPath);
      return {
        name: entry.name,
        path: toWorkspaceRelativePath(workspaceRoot, fullPath),
        type: entry.isDirectory() ? "directory" : "file",
        size: entry.isFile() ? entryStat.size : undefined,
        modifiedAt: entryStat.mtime.toISOString(),
      } satisfies FileTreeEntry;
    }),
  );
  return detailedEntries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

async function deleteLocalModel(name: string): Promise<{ deleted: true; name: string; message: string }> {
  const baseUrl = (process.env.NEXUS_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    throw new Error(`Local model engine is not reachable: ${error instanceof Error ? error.message : "request failed"}`);
  }

  const raw = await response.text();
  let payload: { error?: string; message?: string } | null = null;
  try {
    payload = raw ? (JSON.parse(raw) as { error?: string; message?: string }) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.error ?? payload?.message ?? raw.trim() ?? `HTTP ${response.status}`;
    if (/in use|locked|running|loaded/i.test(detail)) {
      throw new Error(`Model "${name}" appears to be in use or locked. Stop active generations and try again. ${detail}`);
    }
    throw new Error(`Could not delete "${name}": ${detail}`);
  }

  return {
    deleted: true,
    name,
    message: payload?.message ?? `Deleted ${name}.`,
  };
}

interface LiveSearchResult {
  title: string;
  url: string;
  snippet: string;
  content: string;
}

interface LiveSearchResponse {
  query: string;
  provider: "tavily" | "local-search";
  results: LiveSearchResult[];
  searchedAt: string;
}

async function runLiveWebSearch(query: string, maxResults = 5): Promise<LiveSearchResponse> {
  const trimmed = query.trim();
  const limit = Math.min(Math.max(Math.round(maxResults || 5), 1), 8);
  const tavilyKey = process.env.TAVILY_API_KEY || process.env.NEXUS_TAVILY_API_KEY;
  if (tavilyKey) {
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: trimmed,
          search_depth: "basic",
          include_answer: false,
          include_raw_content: true,
          max_results: limit,
        }),
      });
      if (!response.ok) throw new Error(`Tavily returned HTTP ${response.status}`);
      const payload = (await response.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string; raw_content?: string }>;
      };
      return {
        query: trimmed,
        provider: "tavily",
        searchedAt: new Date().toISOString(),
        results: (payload.results ?? [])
          .filter((result) => result.url)
          .slice(0, limit)
          .map((result) => ({
            title: cleanText(result.title || result.url || "Untitled result").slice(0, 180),
            url: result.url || "",
            snippet: cleanText(result.content || "").slice(0, 600),
            content: cleanText(result.raw_content || result.content || "").slice(0, 4000),
          })),
      };
    } catch {
      // Fall back to the no-key local search path.
    }
  }

  const candidates = await searchDuckDuckGoHtml(trimmed, limit);
  const results = await Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      content: await scrapeReadableText(candidate.url),
    })),
  );
  return {
    query: trimmed,
    provider: "local-search",
    searchedAt: new Date().toISOString(),
    results,
  };
}

async function searchDuckDuckGoHtml(query: string, maxResults: number): Promise<Array<Omit<LiveSearchResult, "content">>> {
  const response = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      "user-agent": "NexusHarness/0.1 local search helper",
      accept: "text/html",
    },
  });
  if (!response.ok) throw new Error(`Local search fallback returned HTTP ${response.status}`);
  const html = await response.text();
  const results: Array<Omit<LiveSearchResult, "content">> = [];
  const resultPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultPattern.exec(html)) !== null && results.length < maxResults) {
    const url = normalizeSearchUrl(decodeHtml(match[1]));
    if (!url || results.some((result) => result.url === url)) continue;
    results.push({
      title: cleanText(stripHtml(match[2])).slice(0, 180),
      url,
      snippet: cleanText(stripHtml(match[3])).slice(0, 600),
    });
  }
  return results;
}

function normalizeSearchUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, "https://duckduckgo.com");
    const redirected = parsed.searchParams.get("uddg");
    if (redirected) return redirected;
    return parsed.href;
  } catch {
    return "";
  }
}

async function scrapeReadableText(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "NexusHarness/0.1 local search scraper",
        accept: "text/html,text/plain,application/json,application/xml",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    if (!/html|text|json|xml/i.test(contentType)) return "";
    return cleanText(stripHtml(text)).slice(0, 4000);
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(value: string): string {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function parseGitStatus(statusText: string): GitStatusEntry[] {
  return statusText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim() || "modified",
      path: line.slice(3),
    }));
}

function parseUnifiedDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let oldLineNumber = 0;
  let newLineNumber = 0;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      currentFile = { path: "Unknown file", additions: 0, deletions: 0, lines: [] };
      files.push(currentFile);
      continue;
    }
    if (!currentFile) continue;
    if (line.startsWith("+++ after/")) {
      currentFile.path = line.replace("+++ after/", "");
      currentFile.lines.push({ type: "meta", content: line });
      continue;
    }
    if (line.startsWith("--- before/")) {
      currentFile.lines.push({ type: "meta", content: line });
      continue;
    }

    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLineNumber = Number(hunk[1]);
      newLineNumber = Number(hunk[2]);
      currentFile.lines.push({ type: "meta", content: line });
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentFile.additions += 1;
      currentFile.lines.push({ type: "added", content: line.slice(1), newLineNumber });
      newLineNumber += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      currentFile.deletions += 1;
      currentFile.lines.push({ type: "deleted", content: line.slice(1), oldLineNumber });
      oldLineNumber += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      currentFile.lines.push({ type: "context", content: line.slice(1), oldLineNumber, newLineNumber });
      oldLineNumber += 1;
      newLineNumber += 1;
    } else if (line) {
      currentFile.lines.push({ type: "meta", content: line });
    }
  }

  return files.filter((file) => file.lines.length > 0);
}

async function mergeStatusOnlyDiffFiles(workspaceRoot: string, files: DiffFile[], statusEntries: GitStatusEntry[]): Promise<DiffFile[]> {
  const knownPaths = new Set(files.map((file) => file.path));
  const statusOnly = statusEntries.filter((entry) => entry.path && !knownPaths.has(entry.path));

  const built = await Promise.all(
    statusOnly.map(async (entry) => {
      // Untracked or staged-only file: render its current contents as additions.
      try {
        const absolute = safeWorkspacePath(workspaceRoot, entry.path);
        const fileStat = await stat(absolute);
        if (!fileStat.isFile()) {
          return { path: entry.path, additions: 0, deletions: 0, lines: [{ type: "meta", content: `Directory (${entry.status || "changed"})` }] } satisfies DiffFile;
        }
        if (fileStat.size > 256 * 1024) {
          return { path: entry.path, additions: 0, deletions: 0, lines: [{ type: "meta", content: "File is too large to preview a diff." }] } satisfies DiffFile;
        }
        const content = await readFile(absolute, "utf8");
        if (content.includes(String.fromCharCode(0))) {
          return { path: entry.path, additions: 0, deletions: 0, lines: [{ type: "meta", content: "Binary file (no text diff)." }] } satisfies DiffFile;
        }
        const rows = content.split(/\r?\n/);
        if (rows.length && rows[rows.length - 1] === "") rows.pop();
        const lines: DiffLine[] = [
          { type: "meta", content: `New file (${entry.status || "untracked"})` },
          ...rows.map((text, index) => ({ type: "added" as const, content: text, newLineNumber: index + 1 })),
        ];
        return { path: entry.path, additions: rows.length, deletions: 0, lines } satisfies DiffFile;
      } catch (error) {
        return {
          path: entry.path,
          additions: 0,
          deletions: 0,
          lines: [{ type: "meta", content: error instanceof Error ? error.message : "Could not read file for diff." }],
        } satisfies DiffFile;
      }
    }),
  );

  return [...files, ...built];
}

// ---- Filesystem bridge helpers (absolute-path, localhost only) -------------

interface FsEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  modifiedAt: string;
}

function normalizeAbsolute(input: string): string {
  return normalize(input).replace(/[\\/]+$/, "") || input;
}

function resolveAbsolute(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Empty path.");
  const candidate = isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
  return candidate;
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = resolve(parentPath);
  const child = resolve(childPath);
  const childRelativePath = relative(parent, child);
  return childRelativePath === "" || (!childRelativePath.startsWith("..") && !isAbsolute(childRelativePath));
}

function isHostFileSystemEnabled(): boolean {
  return process.env.NEXUS_ALLOW_HOST_FS === "1";
}

async function getActiveProjectRoot(workspaceRoot: string): Promise<string> {
  const configPath = join(workspaceRoot, ".nexusharness", "active-project.json");
  try {
    const saved = JSON.parse(await readFile(configPath, "utf8")) as { path?: string };
    if (saved.path) {
      const target = resolve(saved.path);
      const targetStat = await stat(target);
      if (targetStat.isDirectory()) return normalizeAbsolute(target);
    }
  } catch {
    /* no active project selected yet */
  }
  return normalizeAbsolute(workspaceRoot);
}

async function saveActiveProjectRoot(workspaceRoot: string, projectRoot: string): Promise<void> {
  const configDirectory = join(workspaceRoot, ".nexusharness");
  await mkdir(configDirectory, { recursive: true });
  await writeFile(
    join(configDirectory, "active-project.json"),
    JSON.stringify({ path: normalizeAbsolute(projectRoot), updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

function commonSelectableRoots(workspaceRoot: string): string[] {
  const home = homedir();
  return Array.from(
    new Set([
      workspaceRoot,
      home,
      join(home, "Desktop"),
      join(home, "Documents"),
      join(home, "Downloads"),
    ]),
  );
}

async function isPathAllowedByProjectSelection(workspaceRoot: string, candidate: string): Promise<boolean> {
  if (isPathInside(workspaceRoot, candidate)) return true;
  const activeProjectRoot = await getActiveProjectRoot(workspaceRoot);
  if (isPathInside(activeProjectRoot, candidate)) return true;
  return commonSelectableRoots(workspaceRoot).some((root) => isPathInside(root, candidate));
}

async function resolveFsPath(workspaceRoot: string, input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Empty path.");
  const candidate = isAbsolute(trimmed) ? resolve(trimmed) : resolve(workspaceRoot, trimmed);
  if (!isHostFileSystemEnabled() && !(await isPathAllowedByProjectSelection(workspaceRoot, candidate))) {
    throw new Error("This file action is limited to the NexusHarness project, your home folders, or the selected Projects folder.");
  }
  return candidate;
}

async function listFsRoots(workspaceRoot: string): Promise<{ roots: Array<{ label: string; path: string }>; separator: string }> {
  const roots: Array<{ label: string; path: string }> = [];
  const activeProjectRoot = await getActiveProjectRoot(workspaceRoot);
  if (!isHostFileSystemEnabled()) {
    const candidates = [
      { label: "Active project", path: activeProjectRoot },
      { label: "NexusHarness project", path: workspaceRoot },
      { label: "Home", path: homedir() },
      { label: "Desktop", path: join(homedir(), "Desktop") },
      { label: "Documents", path: join(homedir(), "Documents") },
      { label: "Downloads", path: join(homedir(), "Downloads") },
    ];
    const available = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      try {
        const normalized = normalizeAbsolute(candidate.path);
        if (seen.has(normalized)) continue;
        const candidateStat = await stat(normalized);
        if (candidateStat.isDirectory()) {
          seen.add(normalized);
          available.push({ label: candidate.label, path: normalized });
        }
      } catch {
        /* ignore missing common folders */
      }
    }
    return { roots: available, separator: sep };
  }
  if (process.platform === "win32") {
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const drive = `${letter}:\\`;
      try {
        await stat(drive);
        roots.push({ label: `${letter}: drive`, path: drive });
      } catch {
        /* drive not present */
      }
    }
  } else {
    roots.push({ label: "Root", path: "/" });
  }
  roots.unshift({ label: "Home", path: homedir() });
  roots.unshift({ label: "Active project", path: activeProjectRoot });
  roots.push({ label: "NexusHarness project", path: workspaceRoot });
  return { roots, separator: sep };
}

async function listFsDirectory(workspaceRoot: string, requested: string): Promise<{ path: string; parent: string | null; separator: string; entries: FsEntry[] }> {
  const target = await resolveFsPath(workspaceRoot, requested);
  const dirStat = await stat(target);
  if (!dirStat.isDirectory()) throw new Error("Path is not a directory.");
  const dirents = await readdir(target, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map(async (dirent) => {
      const full = join(target, dirent.name);
      let size: number | undefined;
      let modifiedAt = new Date(0).toISOString();
      try {
        const entryStat = await stat(full);
        size = dirent.isFile() ? entryStat.size : undefined;
        modifiedAt = entryStat.mtime.toISOString();
      } catch {
        /* permission denied — still list the name */
      }
      return { name: dirent.name, path: full, type: dirent.isDirectory() ? "directory" : "file", size, modifiedAt } satisfies FsEntry;
    }),
  );
  entries.sort((a, b) => (a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name)));
  const parent = normalizeAbsolute(target);
  const up = resolve(target, "..");
  const canNavigateUp = up !== parent && (isHostFileSystemEnabled() || (await isPathAllowedByProjectSelection(workspaceRoot, up)));
  return { path: parent, parent: canNavigateUp ? up : null, separator: sep, entries };
}

async function readFsFile(
  workspaceRoot: string,
  requested: string,
): Promise<{ path: string; size: number; modifiedAt: string; content: string; binary: boolean; truncated: boolean; previewBytes: number }> {
  const target = await resolveFsPath(workspaceRoot, requested);
  const fileStat = await stat(target);
  if (!fileStat.isFile()) throw new Error("Path is not a file.");
  const previewBytes = Math.min(fileStat.size, maxFilePreviewBytes);
  const fileHandle = await import("node:fs/promises").then((fs) => fs.open(target, "r"));
  let buffer: Buffer;
  try {
    buffer = Buffer.alloc(previewBytes);
    await fileHandle.read(buffer, 0, previewBytes, 0);
  } finally {
    await fileHandle.close();
  }
  const binary = buffer.includes(0);
  return {
    path: normalizeAbsolute(target),
    size: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    content: binary ? "" : buffer.toString("utf8"),
    binary,
    truncated: fileStat.size > previewBytes,
    previewBytes,
  };
}

async function sendJsonSafe(response: ServerResponse, build: () => Promise<unknown>): Promise<void> {
  response.setHeader("content-type", "application/json");
  try {
    response.end(JSON.stringify(await build()));
  } catch (error) {
    response.statusCode = 400;
    response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Request failed." }));
  }
}

interface AllowedShellCommand {
  file: string;
  args: string[];
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function resolveExecutableName(file: string): string {
  return process.platform === "win32" && ["npm", "npx"].includes(file) ? `${file}.cmd` : file;
}

function parseAllowedShellCommand(command: string): AllowedShellCommand {
  const tokens = tokenizeCommand(command.trim());
  if (tokens.length === 0) throw new Error("Missing command.");
  const [binary, ...args] = tokens;
  const normalized = [binary.toLowerCase(), ...args];
  const signature = normalized.join(" ");

  const allowedExact = new Set([
    "node --version",
    "npm --version",
    "npm test",
    "npm run build",
    "npm run lint",
    "npm run test",
    "git status",
    "git status --short",
    "git diff",
    "git diff --stat",
  ]);

  if (!allowedExact.has(signature)) {
    throw new Error("This command is not on the NexusHarness allow-list. Use the Review and Files tools for file changes, or add a narrowly scoped command to the runtime allow-list.");
  }

  return { file: resolveExecutableName(binary), args };
}

async function runShellCommand(workspaceRoot: string, command: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!isHostFileSystemEnabled() && !(await isPathAllowedByProjectSelection(workspaceRoot, cwd))) {
    throw new Error("Commands can only run inside the NexusHarness project or the selected Projects folder.");
  }
  const parsed = parseAllowedShellCommand(command);
  return new Promise((resolvePromise) => {
    const child = spawn(parsed.file, parsed.args, {
      cwd,
      shell: false,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const cap = 256 * 1024;
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < cap) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < cap) stderr += chunk.toString();
    });
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolvePromise({ stdout, stderr, exitCode: code ?? 0 });
    });
    child.on("error", (error) => {
      clearTimeout(killTimer);
      resolvePromise({ stdout, stderr: stderr + (error instanceof Error ? error.message : String(error)), exitCode: 1 });
    });
  });
}
