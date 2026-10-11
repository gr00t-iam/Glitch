// self-edit/patchTool.ts
//
// The actual read/write surface the agent is allowed to touch. Two patching
// strategies are supported:
//
//  1. Anchor-based replace (default, works for any text file): the model
//     supplies an `oldText` block that must appear EXACTLY ONCE in the file,
//     and a `newText` block to replace it with. This is far more reliable
//     than asking a model to hand-roll a unified diff, and — unlike a full
//     rewrite — keeps edits small and reviewable.
//
//  2. AST-assisted edits for .ts/.tsx (optional, requires `ts-morph`): for
//     structural changes like "add an import" or "add a prop to a JSX tag"
//     where line-anchored text is fragile across formatting differences.
//
// Both paths are confined to the workspace root via safeWorkspacePath.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeWorkspacePath } from "./snapshotManager";

export interface ReplaceOp {
  type: "replace";
  path: string;
  oldText: string;
  newText: string;
}

export interface WriteOp {
  type: "write";
  path: string;
  content: string;
}

export interface AstImportOp {
  type: "ast-add-import";
  path: string; // must be .ts/.tsx
  moduleSpecifier: string; // e.g. "./DarkModeToggle"
  namedImports: string[]; // e.g. ["DarkModeToggle"]
}

export type PatchOp = ReplaceOp | WriteOp | AstImportOp;

export interface PatchResult {
  path: string;
  ok: boolean;
  message: string;
}

export async function readWorkspaceFile(workspaceRoot: string, relPath: string): Promise<string> {
  const absPath = safeWorkspacePath(workspaceRoot, relPath);
  return readFile(absPath, "utf8");
}

export async function listWorkspaceDir(workspaceRoot: string, relPath: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const absPath = safeWorkspacePath(workspaceRoot, relPath || ".");
  const entries = await readdir(absPath, { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
}

export async function applyPatchOp(workspaceRoot: string, op: PatchOp): Promise<PatchResult> {
  try {
    if (op.type === "write") return await applyWrite(workspaceRoot, op);
    if (op.type === "replace") return await applyReplace(workspaceRoot, op);
    return await applyAstImport(workspaceRoot, op);
  } catch (error) {
    return { path: op.path, ok: false, message: error instanceof Error ? error.message : "Unknown patch error." };
  }
}

async function applyWrite(workspaceRoot: string, op: WriteOp): Promise<PatchResult> {
  const absPath = safeWorkspacePath(workspaceRoot, op.path);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, op.content, "utf8");
  return { path: op.path, ok: true, message: `Wrote ${op.content.length} bytes.` };
}

async function applyReplace(workspaceRoot: string, op: ReplaceOp): Promise<PatchResult> {
  const absPath = safeWorkspacePath(workspaceRoot, op.path);
  const current = await readFile(absPath, "utf8");

  const occurrences = countOccurrences(current, op.oldText);
  if (occurrences === 0) {
    return { path: op.path, ok: false, message: "oldText not found — the file may have already changed. Re-read it first." };
  }
  if (occurrences > 1) {
    return { path: op.path, ok: false, message: `oldText matched ${occurrences} times — must be unique. Add more surrounding context.` };
  }

  const updated = current.replace(op.oldText, () => op.newText);
  await writeFile(absPath, updated, "utf8");
  return { path: op.path, ok: true, message: "Replacement applied." };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

/**
 * Optional AST-assisted import insertion. Requires `ts-morph` as an
 * optional devDependency: `npm i -D ts-morph`. Falls back to a clear error
 * (rather than corrupting the file) if it isn't installed.
 */
async function applyAstImport(workspaceRoot: string, op: AstImportOp): Promise<PatchResult> {
  let tsMorph: typeof import("ts-morph");
  try {
    tsMorph = await import("ts-morph");
  } catch {
    return {
      path: op.path,
      ok: false,
      message: "ts-morph is not installed. Run `npm i -D ts-morph` to enable AST-based edits, or use a 'replace' op instead.",
    };
  }

  const absPath = safeWorkspacePath(workspaceRoot, op.path);
  const project = new tsMorph.Project({ tsConfigFilePath: safeWorkspacePath(workspaceRoot, "tsconfig.json") });
  const sourceFile = project.addSourceFileAtPath(absPath);

  const existing = sourceFile.getImportDeclaration((decl) => decl.getModuleSpecifierValue() === op.moduleSpecifier);
  if (existing) {
    const currentNames = new Set(existing.getNamedImports().map((n) => n.getName()));
    for (const name of op.namedImports) {
      if (!currentNames.has(name)) existing.addNamedImport(name);
    }
  } else {
    sourceFile.addImportDeclaration({ moduleSpecifier: op.moduleSpecifier, namedImports: op.namedImports });
  }

  await sourceFile.save();
  return { path: op.path, ok: true, message: `Import(s) ${op.namedImports.join(", ")} ensured from ${op.moduleSpecifier}.` };
}
