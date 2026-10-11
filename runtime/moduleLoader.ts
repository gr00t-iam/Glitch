import { readdir, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { AgentSkill, AgentTool } from "./types";

interface ModuleCacheEntry<T> {
  mtimeMs: number;
  value: T;
}

const toolCache = new Map<string, ModuleCacheEntry<AgentTool>>();
const skillCache = new Map<string, ModuleCacheEntry<AgentSkill>>();

export async function loadTools(workspaceRoot: string): Promise<AgentTool[]> {
  return loadHotModules<AgentTool>(join(workspaceRoot, "tools"), toolCache, validateTool);
}

export async function loadSkills(workspaceRoot: string): Promise<AgentSkill[]> {
  const [legacySkills, generatedSkills] = await Promise.all([
    loadHotModules<AgentSkill>(join(workspaceRoot, "skills"), skillCache, validateSkill),
    loadHotModules<AgentSkill>(join(workspaceRoot, ".agents", "skills"), skillCache, validateSkill, true),
  ]);
  return [...legacySkills, ...generatedSkills].sort((a, b) => a.name.localeCompare(b.name));
}

async function loadHotModules<T>(
  directory: string,
  cache: Map<string, ModuleCacheEntry<T>>,
  validate: (value: unknown, filePath: string) => T,
  recursive = false,
): Promise<T[]> {
  const files = recursive ? await listModuleFilesRecursive(directory) : await listModuleFiles(directory);
  const modules = await Promise.all(
    files.map(async (filePath) => {
      const fileStat = await stat(filePath);
      const cached = cache.get(filePath);
      if (cached && cached.mtimeMs === fileStat.mtimeMs) return cached.value;

      const url = `${pathToFileURL(filePath).href}?v=${fileStat.mtimeMs}`;
      const imported = (await import(url)) as { default?: unknown };
      const value = validate(imported.default, filePath);
      cache.set(filePath, { mtimeMs: fileStat.mtimeMs, value });
      return value;
    }),
  );
  return modules.sort((a, b) => moduleName(a as { name?: string; id?: string }).localeCompare(moduleName(b as { name?: string; id?: string })));
}

async function listModuleFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(mjs|js)$/.test(entry.name))
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

async function listModuleFilesRecursive(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) return listModuleFilesRecursive(fullPath);
        return entry.isFile() && /(?:^index\.(mjs|js)$|\.(mjs|js)$)/.test(entry.name) ? [fullPath] : [];
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
}

function validateTool(value: unknown, filePath: string): AgentTool {
  if (!value || typeof value !== "object") throw new Error(`Tool ${filePath} must export an object.`);
  const tool = value as Partial<AgentTool>;
  if (!tool.name || !tool.description || !tool.parameters || typeof tool.handler !== "function") {
    throw new Error(`Tool ${filePath} must export name, description, parameters, and handler.`);
  }
  return tool as AgentTool;
}

function validateSkill(value: unknown, filePath: string): AgentSkill {
  if (!value || typeof value !== "object") throw new Error(`Skill ${filePath} must export an object.`);
  const skill = value as Partial<AgentSkill>;
  if (!skill.id || !skill.name || !skill.description || !Array.isArray(skill.triggers) || !skill.instructions) {
    throw new Error(`Skill ${filePath} must export id, name, description, triggers, and instructions.`);
  }
  return skill as AgentSkill;
}

function moduleName(value: { name?: string; id?: string }): string {
  return value.name ?? value.id ?? "";
}
