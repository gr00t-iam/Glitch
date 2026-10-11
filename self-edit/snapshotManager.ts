// self-edit/snapshotManager.ts
//
// Every self-edit run gets a snapshot id. Before any file is touched, its
// current contents are copied into .nexus-snapshots/<snapshotId>/<relPath>.
// Revert restores from that folder. If the workspace is a git repo, we also
// try to make a real commit so you get full git history as a second net.

import { copyFile, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";

const SNAPSHOT_DIR_NAME = ".nexus-snapshots";

export interface SnapshotRecord {
  id: string;
  createdAt: string;
  instruction: string;
  files: string[]; // relative paths captured
}

export function safeWorkspacePath(workspaceRoot: string, requestedPath: string): string {
  const candidate = resolve(workspaceRoot, requestedPath);
  const normalizedRoot = resolve(workspaceRoot);
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("Path escapes the workspace.");
  }
  return candidate;
}

export async function createSnapshot(
  workspaceRoot: string,
  relPaths: string[],
  instruction: string,
): Promise<SnapshotRecord> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const snapshotRoot = join(workspaceRoot, SNAPSHOT_DIR_NAME, id);
  await mkdir(snapshotRoot, { recursive: true });

  const captured: string[] = [];
  for (const relPath of relPaths) {
    const absSource = safeWorkspacePath(workspaceRoot, relPath);
    const absTarget = join(snapshotRoot, relPath);
    try {
      await stat(absSource); // only snapshot files that already exist
      await mkdir(dirname(absTarget), { recursive: true });
      await copyFile(absSource, absTarget);
      captured.push(relPath);
    } catch {
      // new file being created for the first time — nothing to snapshot
    }
  }

  const record: SnapshotRecord = { id, createdAt: new Date().toISOString(), instruction, files: captured };
  await writeFile(join(snapshotRoot, "manifest.json"), JSON.stringify(record, null, 2), "utf8");

  await tryGitCommit(workspaceRoot, `nexus: pre-edit snapshot ${id} — ${instruction.slice(0, 72)}`);

  return record;
}

export async function revertSnapshot(workspaceRoot: string, snapshotId: string): Promise<{ restored: string[] }> {
  const snapshotRoot = join(workspaceRoot, SNAPSHOT_DIR_NAME, snapshotId);
  const manifestRaw = await readFile(join(snapshotRoot, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as SnapshotRecord;

  const restored: string[] = [];
  for (const relPath of manifest.files) {
    const absSource = join(snapshotRoot, relPath);
    const absTarget = safeWorkspacePath(workspaceRoot, relPath);
    await copyFile(absSource, absTarget);
    restored.push(relPath);
  }

  await tryGitCommit(workspaceRoot, `nexus: revert to snapshot ${snapshotId}`);
  return { restored };
}

export async function listSnapshots(workspaceRoot: string): Promise<SnapshotRecord[]> {
  const { readdir } = await import("node:fs/promises");
  const rootDir = join(workspaceRoot, SNAPSHOT_DIR_NAME);
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const records: SnapshotRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(join(rootDir, entry.name, "manifest.json"), "utf8");
        records.push(JSON.parse(raw) as SnapshotRecord);
      } catch {
        // ignore malformed snapshot dirs
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

async function tryGitCommit(cwd: string, message: string): Promise<void> {
  const isRepo = await new Promise<boolean>((resolvePromise) => {
    execFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd }, (error) => resolvePromise(!error));
  });
  if (!isRepo) return;

  await new Promise<void>((resolvePromise) => {
    execFile("git", ["add", "-A"], { cwd }, () => {
      execFile("git", ["commit", "-m", message, "--allow-empty"], { cwd }, () => resolvePromise());
    });
  });
}
