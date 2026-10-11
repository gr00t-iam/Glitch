import { execFile } from "node:child_process";
import type { AutomationAction, AutomationExecutionResult } from "./types";

const allowedShellCommands: Record<string, { command: string; args: string[] }> = {
  pwd: { command: process.platform === "win32" ? "powershell.exe" : "pwd", args: process.platform === "win32" ? ["-NoProfile", "-Command", "Get-Location"] : [] },
  ls: { command: process.platform === "win32" ? "powershell.exe" : "ls", args: process.platform === "win32" ? ["-NoProfile", "-Command", "Get-ChildItem"] : [] },
  git_status: { command: "git", args: ["status", "--short"] },
  npm_build: { command: "npm", args: ["run", "build"] },
};

const allowedKeyboardKeys = new Set(["enter", "escape", "tab", "backspace", "delete", "up", "down", "left", "right"]);
const internalConfirmationTokens = new Set<string>();

export function issueAutomationToken(token: string): void {
  internalConfirmationTokens.add(token);
}

export async function executeAutomationAction(workspaceRoot: string, action: AutomationAction, confirmationToken?: string): Promise<AutomationExecutionResult> {
  if (!confirmationToken || !internalConfirmationTokens.has(confirmationToken)) {
    return { ok: false, kind: action.kind, error: "Explicit user confirmation is required." };
  }
  internalConfirmationTokens.delete(confirmationToken);

  if (action.kind === "shell") return runWhitelistedShellCommand(workspaceRoot, action.payload);
  if (action.kind === "keyboard") return runKeyboardAction(action.payload);
  if (action.kind === "mouse") return runMouseAction(action.payload);
  return { ok: false, kind: action.kind, error: "Unsupported automation action." };
}

async function runWhitelistedShellCommand(workspaceRoot: string, payload: Record<string, unknown>): Promise<AutomationExecutionResult> {
  const commandId = String(payload.commandId ?? "");
  const allowed = allowedShellCommands[commandId];
  if (!allowed) return { ok: false, kind: "shell", error: `Command ${commandId || "(empty)"} is not whitelisted.` };

  return new Promise((resolve) => {
    execFile(allowed.command, allowed.args, { cwd: workspaceRoot, timeout: 120000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        kind: "shell",
        output: `${stdout}${stderr}`.trim(),
        error: error ? error.message : undefined,
      });
    });
  });
}

async function runKeyboardAction(payload: Record<string, unknown>): Promise<AutomationExecutionResult> {
  const robot = await loadRobot();
  if (!robot) return { ok: false, kind: "keyboard", error: "robotjs is not installed. Install it to enable keyboard automation." };

  const action = String(payload.action ?? "");
  if (action === "type") {
    const text = String(payload.text ?? "").slice(0, 500);
    robot.typeString(text);
    return { ok: true, kind: "keyboard", output: `Typed ${text.length} character(s).` };
  }
  if (action === "press") {
    const key = String(payload.key ?? "").toLowerCase();
    if (!allowedKeyboardKeys.has(key)) return { ok: false, kind: "keyboard", error: `Key ${key || "(empty)"} is not allowed.` };
    robot.keyTap(key);
    return { ok: true, kind: "keyboard", output: `Pressed ${key}.` };
  }
  return { ok: false, kind: "keyboard", error: "Keyboard action must be type or press." };
}

async function runMouseAction(payload: Record<string, unknown>): Promise<AutomationExecutionResult> {
  const robot = await loadRobot();
  if (!robot) return { ok: false, kind: "mouse", error: "robotjs is not installed. Install it to enable mouse automation." };

  const action = String(payload.action ?? "");
  const x = clampCoordinate(payload.x);
  const y = clampCoordinate(payload.y);
  if (action === "move") {
    robot.moveMouse(x, y);
    return { ok: true, kind: "mouse", output: `Moved mouse to ${x}, ${y}.` };
  }
  if (action === "click") {
    robot.moveMouse(x, y);
    robot.mouseClick("left");
    return { ok: true, kind: "mouse", output: `Clicked at ${x}, ${y}.` };
  }
  return { ok: false, kind: "mouse", error: "Mouse action must be move or click." };
}

async function loadRobot(): Promise<undefined | { typeString(text: string): void; keyTap(key: string): void; moveMouse(x: number, y: number): void; mouseClick(button: "left"): void }> {
  try {
    const moduleName = "robotjs";
    const imported = (await import(moduleName)) as { default?: unknown };
    return (imported.default ?? imported) as { typeString(text: string): void; keyTap(key: string): void; moveMouse(x: number, y: number): void; mouseClick(button: "left"): void };
  } catch {
    return undefined;
  }
}

function clampCoordinate(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.min(10000, Math.round(numberValue)));
}
