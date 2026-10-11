const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

function normalizeInside(root, target) {
  if (!root) throw new Error("Choose a workspace before using file tools.");
  const base = path.resolve(root);
  const resolved = path.resolve(base, target || ".");
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the active workspace.");
  }
  return resolved;
}

function commandLooksDangerous(command) {
  const lowered = String(command).toLowerCase();
  return [
    "format ",
    "shutdown",
    "restart-computer",
    "remove-item -recurse",
    "rm -rf",
    "del /s",
    "reg delete",
    "bcdedit",
    "diskpart",
  ].some((needle) => lowered.includes(needle));
}

function execPowerShell(command, cwd) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { cwd, timeout: 120_000, windowsHide: true, maxBuffer: 1024 * 1024 * 6 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout,
          stderr,
          exitCode: error && typeof error.code === "number" ? error.code : 0,
          message: error ? error.message : undefined,
        });
      },
    );
  });
}

function createTools({ workspacePath, requestApproval, settings }) {
  return [
    {
      name: "list_workspace",
      description: "List files and folders in the active workspace.",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string" },
        },
      },
      handler: async (args) => {
        const dir = normalizeInside(workspacePath, args.directory || ".");
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries
          .filter((entry) => !["node_modules", ".git", "dist"].includes(entry.name))
          .slice(0, 80)
          .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" }));
      },
    },
    {
      name: "read_file",
      description: "Read a UTF-8 file from the active workspace.",
      parameters: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string" },
        },
      },
      handler: async (args) => {
        const filePath = normalizeInside(workspacePath, args.path);
        const content = await fs.readFile(filePath, "utf8");
        return { path: args.path, content: content.slice(0, 120_000), truncated: content.length > 120_000 };
      },
    },
    {
      name: "write_file",
      description: "Write a UTF-8 file inside the active workspace.",
      highRisk: "file_write",
      parameters: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
      },
      handler: async (args) => {
        if (settings.requireApprovalForWrites) {
          const approved = await requestApproval({
            action: "write_file",
            reason: `Glitch wants to write ${args.path}.`,
            risk: "high",
            payload: { path: args.path, preview: String(args.content || "").slice(0, 1200) },
          });
          if (!approved) return { ok: false, aborted: true };
        }
        const filePath = normalizeInside(workspacePath, args.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, String(args.content ?? ""), "utf8");
        return { ok: true, path: args.path, bytes: Buffer.byteLength(String(args.content ?? ""), "utf8") };
      },
    },
    {
      name: "run_shell",
      description: "Run an approved PowerShell command in the active workspace.",
      highRisk: "shell_command",
      parameters: {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string" },
        },
      },
      handler: async (args) => {
        const command = String(args.command || "").trim();
        if (!command) throw new Error("Missing shell command.");
        if (commandLooksDangerous(command)) {
          throw new Error("Dangerous shell command blocked by local policy.");
        }
        if (settings.requireApprovalForShell) {
          const approved = await requestApproval({
            action: "run_shell",
            reason: "Glitch wants to run a PowerShell command.",
            risk: "high",
            payload: { command, workspacePath },
          });
          if (!approved) return { ok: false, aborted: true };
        }
        return execPowerShell(command, workspacePath);
      },
    },
    {
      name: "git_diff",
      description: "Show the current uncommitted git diff.",
      parameters: {
        type: "object",
        properties: {},
      },
      handler: async () => execPowerShell("git diff -- .", workspacePath),
    },
  ];
}

module.exports = { createTools };
