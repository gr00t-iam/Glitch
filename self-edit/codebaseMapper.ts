// self-edit/codebaseMapper.ts
//
// Builds a compact, LLM-readable snapshot of the workspace: a directory tree
// plus the full contents of files that are likely relevant to the requested
// edit. This is what gets stuffed into the system/context portion of the
// self-edit prompt so the model isn't guessing about file layout.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".vite", "dev-dist", ".nexus-snapshots", "coverage"]);
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".html", ".md"]);
const MAX_FILE_BYTES = 40_000; // don't blow the context window on one file
const MAX_TOTAL_BYTES = 180_000; // hard ceiling on the whole map

export interface CodebaseMapOptions {
  /** Free-text instruction, used to rank which files are "relevant". */
  instruction: string;
  /** Explicit paths the caller already knows it wants included (relative to root). */
  forcePaths?: string[];
  /** Max number of file bodies to inline. */
  maxFiles?: number;
}

export interface CodebaseMapResult {
  tree: string;
  files: { path: string; content: string; truncated: boolean }[];
  totalBytes: number;
}

export async function buildCodebaseMap(workspaceRoot: string, options: CodebaseMapOptions): Promise<CodebaseMapResult> {
  const tree = await walkTree(workspaceRoot, workspaceRoot, "");
  const candidatePaths = await collectSourceFiles(workspaceRoot, workspaceRoot);

  const ranked = rankByRelevance(candidatePaths, options.instruction, options.forcePaths ?? []);
  const maxFiles = options.maxFiles ?? 14;

  const files: CodebaseMapResult["files"] = [];
  let totalBytes = 0;

  for (const relPath of ranked) {
    if (files.length >= maxFiles || totalBytes >= MAX_TOTAL_BYTES) break;
    const absPath = join(workspaceRoot, relPath);
    try {
      const raw = await readFile(absPath, "utf8");
      const truncated = raw.length > MAX_FILE_BYTES;
      const content = truncated ? `${raw.slice(0, MAX_FILE_BYTES)}\n/* ...truncated... */` : raw;
      totalBytes += content.length;
      files.push({ path: relPath, content, truncated });
    } catch {
      // binary or unreadable — skip
    }
  }

  return { tree, files, totalBytes };
}

async function walkTree(root: string, dir: string, prefix: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const visible = entries
    .filter((e) => !e.name.startsWith(".") && !IGNORED_DIRS.has(e.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  let out = "";
  for (const entry of visible) {
    const relPath = relative(root, join(dir, entry.name)).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      out += `${prefix}${entry.name}/\n`;
      out += await walkTree(root, join(dir, entry.name), `${prefix}  `);
    } else {
      out += `${prefix}${entry.name}\n`;
    }
    void relPath;
  }
  return out;
}

async function collectSourceFiles(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectSourceFiles(root, abs)));
    } else if (TEXT_EXTENSIONS.has(extname(entry.name))) {
      const info = await stat(abs);
      if (info.size <= 512 * 1024) {
        results.push(relative(root, abs).replace(/\\/g, "/"));
      }
    }
  }
  return results;
}

/** Cheap keyword-overlap ranking — no embeddings needed for a workspace this size. */
function rankByRelevance(paths: string[], instruction: string, forcePaths: string[]): string[] {
  const keywords = instruction
    .toLowerCase()
    .replace(/[^a-z0-9\s./-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const scored = paths
    .filter((p) => !forcePaths.includes(p))
    .map((p) => {
      const lower = p.toLowerCase();
      let score = 0;
      for (const kw of keywords) if (lower.includes(kw)) score += 2;
      if (lower.includes("app.tsx") || lower.includes("main.tsx")) score += 1;
      return { path: p, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((s) => s.path);

  return [...forcePaths, ...scored];
}
