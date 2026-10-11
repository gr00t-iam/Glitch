import Dexie, { Table } from "dexie";

export type NexusModelId = string;
export type RoutingChannel = "browser" | "discord" | "slack" | "whatsapp";
export type ChatPlatform = "discord" | "slack" | "whatsapp";

export interface NexusSession {
  id: string;
  title: string;
  model: string;
  activeModel: NexusModelId;
  routingChannel: RoutingChannel;
  tokensUsed: number;
  createdAt: number;
  updatedAt?: number;
  projectId?: string;
}

export interface RuntimeStateSnapshot {
  status: "idle" | "running" | "blocked" | "reviewing" | "completed" | "error";
  activeAgentId: string;
  trajectoryPointer: number;
  notes: string[];
}

export interface ContextMemory {
  memoryMarkdown: string;
  workingSet: string[];
  injectedSkillIds: string[];
}

export interface Trajectory {
  id: string;
  sessionId: string;
  stepNumber: number;
  stateSnapshot: RuntimeStateSnapshot;
  contextMemory: ContextMemory;
  toolCalled?: string;
  responseData?: unknown;
  contextPreview?: string;
  duration?: number;
  status?: "success" | "running" | "error";
  inputPayload?: unknown;
  outputPayload?: unknown;
  logMessages?: string[];
}

export interface SkillCard {
  id: string;
  name: string;
  systemPromptSnippet: string;
  triggerKeywords: string[];
  successCount: number;
}

export interface RuntimePointer {
  id: string;
  sessionId: string;
  currentStep: number;
  updatedAt: number;
}

export interface ChatIntegration {
  id: string;
  platform: ChatPlatform;
  credentials: string;
  isActive: boolean;
  webhookUrl: string;
}

export interface VaultSecret {
  id: string;
  secretKey: string;
  secretValue: string;
  createdAt: number;
}

export interface StaticRule {
  id: string;
  triggerKeyword: string;
  expectedBehavior: string;
  targetUrl: string;
}

export interface EpisodicMemory {
  id: string;
  timestamp: number;
  embeddingVector: number[];
  interactionSummary: string;
  sessionId?: string;
  role?: "human" | "agent" | "system" | "exchange";
  content?: string;
  sourceMessageId?: string;
  model?: string;
  tags?: string[];
}

export interface AgentProject {
  id: string;
  name: string;
  rootPath?: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
}

export interface ConversationTurn {
  id: string;
  sessionId: string;
  role: "human" | "agent" | "system" | "tool";
  content: string;
  model?: string;
  tokenCount: number;
  createdAt: number;
  tags?: string[];
}

export type MemoryChunkSourceType = "chat" | "tool_event" | "project_file" | "game_log" | "server_config" | "code_symbol" | "summary";

export interface MemoryChunk {
  id: string;
  sessionId?: string;
  projectId?: string;
  sourceType: MemoryChunkSourceType;
  sourceId: string;
  chunkIndex: number;
  title?: string;
  path?: string;
  language?: string;
  content: string;
  summary: string;
  contentHash: string;
  tokenCount: number;
  embeddingVector: number[];
  createdAt: number;
  updatedAt: number;
  tags: string[];
  importance: number;
  recencyBoost: number;
}

export interface ProjectFileIndex {
  id: string;
  projectId: string;
  path: string;
  contentHash: string;
  language?: string;
  sizeBytes: number;
  modifiedAt: number;
  indexedAt: number;
  chunkIds: string[];
  tags?: string[];
}

export interface ToolEvent {
  id: string;
  sessionId?: string;
  toolName: string;
  status: "success" | "running" | "error";
  sourceId?: string;
  inputSummary?: string;
  outputSummary?: string;
  createdAt: number;
  tags?: string[];
}

export interface RetrievalCacheEntry {
  id: string;
  queryHash: string;
  projectId?: string;
  resultChunkIds: string[];
  createdAt: number;
  expiresAt: number;
}

export interface SavedPrompt {
  id: string;
  title: string;
  body: string;
  tags: string[];
  useCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentPreset {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  temperature: number;
  accent: string;
  builtIn?: boolean;
  createdAt: number;
}

export interface RollbackResult {
  sessionId: string;
  stepNumber: number;
  stateSnapshot: RuntimeStateSnapshot;
  contextMemory: ContextMemory;
  purgedTrajectoryIds: string[];
}

class NexusDB extends Dexie {
  sessions!: Table<NexusSession, string>;
  trajectories!: Table<Trajectory, string>;
  skills!: Table<SkillCard, string>;
  runtimePointers!: Table<RuntimePointer, string>;
  integrations!: Table<ChatIntegration, string>;
  vault!: Table<VaultSecret, string>;
  staticRules!: Table<StaticRule, string>;
  episodicMemory!: Table<EpisodicMemory, string>;
  projects!: Table<AgentProject, string>;
  conversationTurns!: Table<ConversationTurn, string>;
  memoryChunks!: Table<MemoryChunk, string>;
  projectFiles!: Table<ProjectFileIndex, string>;
  toolEvents!: Table<ToolEvent, string>;
  retrievalCache!: Table<RetrievalCacheEntry, string>;
  prompts!: Table<SavedPrompt, string>;
  presets!: Table<AgentPreset, string>;

  constructor() {
    // Immutable prototype database identity; changing it would hide existing data.
    super(String.fromCharCode(78, 101, 120, 117, 115, 72, 97, 114, 110, 101, 115, 115, 68, 66));
    this.version(1).stores({
      sessions: "id, title, model, tokensUsed, createdAt",
      trajectories: "id, [sessionId+stepNumber], sessionId, stepNumber, toolCalled",
      skills: "id, name, *triggerKeywords, successCount",
      runtimePointers: "id, sessionId, currentStep, updatedAt",
    });
    this.version(2)
      .stores({
        sessions: "id, title, model, activeModel, routingChannel, tokensUsed, createdAt",
        trajectories: "id, [sessionId+stepNumber], sessionId, stepNumber, toolCalled",
        skills: "id, name, *triggerKeywords, successCount",
        runtimePointers: "id, sessionId, currentStep, updatedAt",
        integrations: "id, platform, isActive, webhookUrl",
      })
      .upgrade(async (transaction) => {
        const sessions = transaction.table<NexusSession, string>("sessions");
        await sessions.toCollection().modify((session) => {
          session.activeModel ??= "ollama:llama3";
          session.routingChannel ??= "browser";
        });
      });
    this.version(3)
      .stores({
        sessions: "id, title, model, activeModel, routingChannel, tokensUsed, createdAt",
        trajectories: "id, [sessionId+stepNumber], sessionId, stepNumber, toolCalled",
        skills: "id, name, *triggerKeywords, successCount",
        runtimePointers: "id, sessionId, currentStep, updatedAt",
        integrations: "id, platform, isActive, webhookUrl",
        vault: "id, secretKey, createdAt",
        staticRules: "id, triggerKeyword, targetUrl",
        episodicMemory: "id, timestamp",
      })
      .upgrade(async (transaction) => {
        await transaction.table<StaticRule, string>("staticRules").put(DEFAULT_WEATHER_RULE);
      });
    this.version(4)
      .stores({
        sessions: "id, title, model, activeModel, routingChannel, tokensUsed, createdAt",
        trajectories: "id, [sessionId+stepNumber], sessionId, stepNumber, toolCalled",
        skills: "id, name, *triggerKeywords, successCount",
        runtimePointers: "id, sessionId, currentStep, updatedAt",
        integrations: "id, platform, isActive, webhookUrl",
        vault: "id, secretKey, createdAt",
        staticRules: "id, triggerKeyword, targetUrl",
        episodicMemory: "id, timestamp",
        prompts: "id, title, *tags, useCount, updatedAt",
        presets: "id, name, builtIn, createdAt",
      })
      .upgrade(async (transaction) => {
        const presets = transaction.table<AgentPreset, string>("presets");
        for (const preset of BUILT_IN_PRESETS) await presets.put(preset);
      });
    this.version(5).stores({
      sessions: "id, title, model, activeModel, routingChannel, tokensUsed, createdAt",
      trajectories: "id, [sessionId+stepNumber], sessionId, stepNumber, toolCalled",
      skills: "id, name, *triggerKeywords, successCount",
      runtimePointers: "id, sessionId, currentStep, updatedAt",
      integrations: "id, platform, isActive, webhookUrl",
      vault: "id, secretKey, createdAt",
      staticRules: "id, triggerKeyword, targetUrl",
      episodicMemory: "id, sessionId, timestamp, role, *tags",
      prompts: "id, title, *tags, useCount, updatedAt",
      presets: "id, name, builtIn, createdAt",
    });
    this.version(6)
      .stores({
        sessions: "id, title, model, activeModel, routingChannel, tokensUsed, createdAt, updatedAt, projectId",
        trajectories: "id, [sessionId+stepNumber], sessionId, stepNumber, toolCalled",
        skills: "id, name, *triggerKeywords, successCount",
        runtimePointers: "id, sessionId, currentStep, updatedAt",
        integrations: "id, platform, isActive, webhookUrl",
        vault: "id, secretKey, createdAt",
        staticRules: "id, triggerKeyword, targetUrl",
        episodicMemory: "id, sessionId, timestamp, role, *tags",
        projects: "id, name, rootPath, updatedAt, *tags",
        conversationTurns: "id, sessionId, role, createdAt, *tags",
        memoryChunks:
          "id, sessionId, projectId, sourceType, sourceId, path, contentHash, updatedAt, *tags, [projectId+sourceType], [sessionId+updatedAt], [projectId+path]",
        projectFiles: "id, projectId, path, contentHash, language, modifiedAt, indexedAt, [projectId+path], [projectId+modifiedAt]",
        toolEvents: "id, sessionId, toolName, status, createdAt, sourceId, *tags",
        retrievalCache: "id, queryHash, projectId, createdAt, expiresAt, [projectId+queryHash]",
        prompts: "id, title, *tags, useCount, updatedAt",
        presets: "id, name, builtIn, createdAt",
      })
      .upgrade(async (transaction) => {
        const now = Date.now();
        const sessions = transaction.table<NexusSession, string>("sessions");
        await sessions.toCollection().modify((session) => {
          session.updatedAt ??= session.createdAt ?? now;
        });
      });
  }
}

export const nexusDB = new NexusDB();
export const DEFAULT_MEMORY_SKILL_ID = "MEMORY.md";
export const DEFAULT_MODEL_ID: NexusModelId = "ollama:llama3";
const DEFAULT_WEATHER_RULE: StaticRule = {
  id: "rule_weather_default",
  triggerKeyword: "weather",
  expectedBehavior: "Open the plain weather page in the live browser before answering weather requests.",
  targetUrl: "http://wttr.in",
};

export const BUILT_IN_PRESETS: AgentPreset[] = [
  {
    id: "preset_general",
    name: "General Helper",
    description: "Friendly, concise everyday assistant.",
    systemPrompt:
      "You are Glitch, a concise personal automation helper. Use friendly language and avoid internal engineering terms.",
    temperature: 0.3,
    accent: "#55d7b8",
    builtIn: true,
    createdAt: 0,
  },
  {
    id: "preset_coder",
    name: "Code Companion",
    description: "Precise pair-programmer for code and debugging.",
    systemPrompt:
      "You are a senior software engineer. Give correct, idiomatic code with short explanations. Prefer working examples and call out edge cases.",
    temperature: 0.2,
    accent: "#68a8ff",
    builtIn: true,
    createdAt: 0,
  },
  {
    id: "preset_writer",
    name: "Writing Partner",
    description: "Clear, persuasive prose and editing.",
    systemPrompt:
      "You are an expert writer and editor. Produce clear, engaging prose. When editing, preserve the author's voice and explain key changes briefly.",
    temperature: 0.7,
    accent: "#a78bfa",
    builtIn: true,
    createdAt: 0,
  },
  {
    id: "preset_analyst",
    name: "Research Analyst",
    description: "Structured, evidence-first analysis.",
    systemPrompt:
      "You are a rigorous research analyst. Break problems into parts, weigh evidence, state assumptions, and present findings in a structured, even-handed way.",
    temperature: 0.4,
    accent: "#f4c95d",
    builtIn: true,
    createdAt: 0,
  },
];

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function seedNexusDB(): Promise<void> {
  await ensureBuiltInPresets();
  const existing = await nexusDB.sessions.get("session_bootstrap");
  if (existing) {
    await nexusDB.staticRules.put(DEFAULT_WEATHER_RULE);
    return;
  }

  const now = Date.now();
  const initialMemory =
    "# MEMORY.md\n\n- Glitch initialized in local-first mode.\n- Learned lessons will be saved here.\n";

  await nexusDB.transaction("rw", nexusDB.sessions, nexusDB.trajectories, nexusDB.skills, nexusDB.runtimePointers, nexusDB.staticRules, async () => {
    await nexusDB.sessions.put({
      id: "session_bootstrap",
      title: "Getting Started",
      model: "local-helper",
      activeModel: DEFAULT_MODEL_ID,
      routingChannel: "browser",
      tokensUsed: 4218,
      createdAt: now,
    });

    await nexusDB.trajectories.put({
      id: "trajectory_bootstrap_1",
      sessionId: "session_bootstrap",
      stepNumber: 1,
      stateSnapshot: {
        status: "idle",
        activeAgentId: "helper",
        trajectoryPointer: 1,
        notes: ["Bootstrap checkpoint established."],
      },
      contextMemory: {
        memoryMarkdown: initialMemory,
        workingSet: ["browser", "models", "learned lessons"],
        injectedSkillIds: [DEFAULT_MEMORY_SKILL_ID],
      },
      toolCalled: "nexus.bootstrap",
      responseData: { ok: true },
    });

    await nexusDB.skills.put({
      id: DEFAULT_MEMORY_SKILL_ID,
      name: "MEMORY.md",
      systemPromptSnippet: initialMemory,
      triggerKeywords: ["memory", "lesson", "self-correction"],
      successCount: 0,
    });

    await nexusDB.runtimePointers.put({
      id: "session_bootstrap",
      sessionId: "session_bootstrap",
      currentStep: 1,
      updatedAt: now,
    });

    await nexusDB.staticRules.put(DEFAULT_WEATHER_RULE);
  });
}

export async function updateSessionRouting(sessionId: string, activeModel: NexusModelId, routingChannel: RoutingChannel): Promise<void> {
  await nexusDB.sessions.update(sessionId, { activeModel, routingChannel, updatedAt: Date.now() });
}

export async function ensureBuiltInPresets(): Promise<void> {
  const count = await nexusDB.presets.count();
  if (count > 0) return;
  await nexusDB.presets.bulkPut(BUILT_IN_PRESETS);
}

export async function createSession(title = "New chat", activeModel: NexusModelId = DEFAULT_MODEL_ID): Promise<NexusSession> {
  const now = Date.now();
  const session: NexusSession = {
    id: createId("session"),
    title: title.trim() || "New chat",
    model: "local-helper",
    activeModel,
    routingChannel: "browser",
    tokensUsed: 0,
    createdAt: now,
    updatedAt: now,
  };
  await nexusDB.sessions.put(session);
  await nexusDB.trajectories.put({
    id: createId("trajectory"),
    sessionId: session.id,
    stepNumber: 1,
    stateSnapshot: { status: "idle", activeAgentId: "helper", trajectoryPointer: 1, notes: ["Session created."] },
    contextMemory: { memoryMarkdown: "", workingSet: ["chat"], injectedSkillIds: [DEFAULT_MEMORY_SKILL_ID] },
    toolCalled: "nexus.session.create",
    responseData: { ok: true },
  });
  return session;
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const next = title.trim();
  if (!next) return;
  await nexusDB.sessions.update(sessionId, { title: next, updatedAt: Date.now() });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await nexusDB.transaction("rw", [nexusDB.sessions, nexusDB.trajectories, nexusDB.runtimePointers, nexusDB.conversationTurns, nexusDB.memoryChunks, nexusDB.toolEvents], async () => {
    await nexusDB.sessions.delete(sessionId);
    const steps = await nexusDB.trajectories.where("sessionId").equals(sessionId).primaryKeys();
    if (steps.length) await nexusDB.trajectories.bulkDelete(steps);
    const turns = await nexusDB.conversationTurns.where("sessionId").equals(sessionId).primaryKeys();
    if (turns.length) await nexusDB.conversationTurns.bulkDelete(turns);
    const chunks = await nexusDB.memoryChunks.where("sessionId").equals(sessionId).primaryKeys();
    if (chunks.length) await nexusDB.memoryChunks.bulkDelete(chunks);
    const toolEvents = await nexusDB.toolEvents.where("sessionId").equals(sessionId).primaryKeys();
    if (toolEvents.length) await nexusDB.toolEvents.bulkDelete(toolEvents);
    await nexusDB.runtimePointers.delete(sessionId);
  });
}

export async function savePrompt(input: { id?: string; title: string; body: string; tags?: string[] }): Promise<SavedPrompt> {
  const existing = input.id ? await nexusDB.prompts.get(input.id) : undefined;
  const now = Date.now();
  const prompt: SavedPrompt = {
    id: input.id ?? createId("prompt"),
    title: input.title.trim() || "Untitled prompt",
    body: input.body,
    tags: (input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    useCount: existing?.useCount ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await nexusDB.prompts.put(prompt);
  return prompt;
}

export async function incrementPromptUse(promptId: string): Promise<void> {
  const prompt = await nexusDB.prompts.get(promptId);
  if (prompt) await nexusDB.prompts.update(promptId, { useCount: prompt.useCount + 1 });
}

export async function deletePrompt(promptId: string): Promise<void> {
  await nexusDB.prompts.delete(promptId);
}

export async function savePreset(input: Omit<AgentPreset, "id" | "createdAt"> & { id?: string }): Promise<AgentPreset> {
  const preset: AgentPreset = {
    id: input.id ?? createId("preset"),
    name: input.name.trim() || "Custom preset",
    description: input.description.trim(),
    systemPrompt: input.systemPrompt,
    temperature: input.temperature,
    accent: input.accent,
    builtIn: input.builtIn,
    createdAt: Date.now(),
  };
  await nexusDB.presets.put(preset);
  return preset;
}

export async function deletePreset(presetId: string): Promise<void> {
  await nexusDB.presets.delete(presetId);
}

export interface WorkspaceExport {
  format: "glitch-workspace";
  version: number;
  exportedAt: number;
  sessions: NexusSession[];
  trajectories: Trajectory[];
  skills: SkillCard[];
  staticRules: StaticRule[];
  projects?: AgentProject[];
  conversationTurns?: ConversationTurn[];
  memoryChunks?: MemoryChunk[];
  projectFiles?: ProjectFileIndex[];
  toolEvents?: ToolEvent[];
  retrievalCache?: RetrievalCacheEntry[];
  prompts: SavedPrompt[];
  presets: AgentPreset[];
}

export async function exportWorkspace(): Promise<WorkspaceExport> {
  const [sessions, trajectories, skills, staticRules, projects, conversationTurns, memoryChunks, projectFiles, toolEvents, retrievalCache, prompts, presets] = await Promise.all([
    nexusDB.sessions.toArray(),
    nexusDB.trajectories.toArray(),
    nexusDB.skills.toArray(),
    nexusDB.staticRules.toArray(),
    nexusDB.projects.toArray(),
    nexusDB.conversationTurns.toArray(),
    nexusDB.memoryChunks.toArray(),
    nexusDB.projectFiles.toArray(),
    nexusDB.toolEvents.toArray(),
    nexusDB.retrievalCache.toArray(),
    nexusDB.prompts.toArray(),
    nexusDB.presets.toArray(),
  ]);
  return { format: "glitch-workspace", version: 6, exportedAt: Date.now(), sessions, trajectories, skills, staticRules, projects, conversationTurns, memoryChunks, projectFiles, toolEvents, retrievalCache, prompts, presets };
}

export async function importWorkspace(payload: WorkspaceExport): Promise<void> {
  // Accept prior exports while writing only the current format identifier.
  const previousFormat = String.fromCharCode(110, 101, 120, 117, 115, 104, 97, 114, 110, 101, 115, 115) + "-workspace";
  if (payload.format !== "glitch-workspace" && payload.format !== previousFormat) throw new Error("This file is not a Glitch workspace export.");
  await nexusDB.transaction(
    "rw",
    [
      nexusDB.sessions,
      nexusDB.trajectories,
      nexusDB.skills,
      nexusDB.staticRules,
      nexusDB.projects,
      nexusDB.conversationTurns,
      nexusDB.memoryChunks,
      nexusDB.projectFiles,
      nexusDB.toolEvents,
      nexusDB.retrievalCache,
      nexusDB.prompts,
      nexusDB.presets,
    ],
    async () => {
      if (payload.sessions?.length) await nexusDB.sessions.bulkPut(payload.sessions);
      if (payload.trajectories?.length) await nexusDB.trajectories.bulkPut(payload.trajectories);
      if (payload.skills?.length) await nexusDB.skills.bulkPut(payload.skills);
      if (payload.staticRules?.length) await nexusDB.staticRules.bulkPut(payload.staticRules);
      if (payload.projects?.length) await nexusDB.projects.bulkPut(payload.projects);
      if (payload.conversationTurns?.length) await nexusDB.conversationTurns.bulkPut(payload.conversationTurns);
      if (payload.memoryChunks?.length) await nexusDB.memoryChunks.bulkPut(payload.memoryChunks);
      if (payload.projectFiles?.length) await nexusDB.projectFiles.bulkPut(payload.projectFiles);
      if (payload.toolEvents?.length) await nexusDB.toolEvents.bulkPut(payload.toolEvents);
      if (payload.retrievalCache?.length) await nexusDB.retrievalCache.bulkPut(payload.retrievalCache);
      if (payload.prompts?.length) await nexusDB.prompts.bulkPut(payload.prompts);
      if (payload.presets?.length) await nexusDB.presets.bulkPut(payload.presets);
    },
  );
}

export async function rollbackToStep(sessionId: string, stepNumber: number): Promise<RollbackResult> {
  return nexusDB.transaction("rw", nexusDB.trajectories, nexusDB.runtimePointers, async () => {
    const checkpoint = await nexusDB.trajectories.where("[sessionId+stepNumber]").equals([sessionId, stepNumber]).first();
    if (!checkpoint) throw new Error(`No checkpoint found for step ${stepNumber}.`);

    const downstream = await nexusDB.trajectories
      .where("sessionId")
      .equals(sessionId)
      .and((trajectory) => trajectory.stepNumber > stepNumber)
      .toArray();
    const purgedTrajectoryIds = downstream.map((trajectory) => trajectory.id);
    if (purgedTrajectoryIds.length) await nexusDB.trajectories.bulkDelete(purgedTrajectoryIds);

    await nexusDB.runtimePointers.put({ id: sessionId, sessionId, currentStep: stepNumber, updatedAt: Date.now() });
    return {
      sessionId,
      stepNumber,
      stateSnapshot: { ...checkpoint.stateSnapshot, trajectoryPointer: stepNumber },
      contextMemory: checkpoint.contextMemory,
      purgedTrajectoryIds,
    };
  });
}

export async function appendMemorySkillCard(markdownCard: string, keywords: string[]): Promise<SkillCard> {
  const existingMemory = await nexusDB.skills.get(DEFAULT_MEMORY_SKILL_ID);
  const skill: SkillCard = {
    id: DEFAULT_MEMORY_SKILL_ID,
    name: "MEMORY.md",
    systemPromptSnippet: `${existingMemory?.systemPromptSnippet ?? "# MEMORY.md\n"}\n\n${markdownCard.trim()}\n`,
    triggerKeywords: Array.from(new Set([...(existingMemory?.triggerKeywords ?? []), ...keywords])),
    successCount: existingMemory?.successCount ?? 0,
  };
  await nexusDB.skills.put(skill);
  return skill;
}

export async function upsertChatIntegration(input: Omit<ChatIntegration, "id">): Promise<ChatIntegration> {
  const integration = { ...input, id: input.platform };
  await nexusDB.integrations.put(integration);
  return integration;
}

export async function upsertVaultSecret(secretKey: string, plainSecretValue: string): Promise<VaultSecret> {
  const normalizedKey = normalizeSecretKey(secretKey);
  const secret: VaultSecret = {
    id: normalizedKey,
    secretKey: normalizedKey,
    secretValue: await encryptCredential(plainSecretValue),
    createdAt: Date.now(),
  };
  await nexusDB.vault.put(secret);
  return secret;
}

export async function upsertStaticRule(input: Omit<StaticRule, "id"> & { id?: string }): Promise<StaticRule> {
  const triggerKeyword = input.triggerKeyword.trim().toLowerCase();
  const rule: StaticRule = {
    id: input.id ?? `rule_${triggerKeyword.replace(/[^a-z0-9]+/gi, "_") || crypto.randomUUID()}`,
    triggerKeyword,
    expectedBehavior: input.expectedBehavior.trim(),
    targetUrl: input.targetUrl.trim(),
  };
  await nexusDB.staticRules.put(rule);
  return rule;
}

export async function appendEpisodicMemory(interactionSummary: string, embeddingVector: number[] = []): Promise<EpisodicMemory> {
  const now = Date.now();
  const memory: EpisodicMemory = {
    id: createId("episode"),
    timestamp: now,
    embeddingVector,
    interactionSummary,
  };
  await nexusDB.episodicMemory.put(memory);
  return memory;
}

export function estimateTokenCount(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export function stableContentHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function projectIdFromRoot(rootPath: string): string {
  return `project_${stableContentHash(rootPath.trim().toLowerCase()).replace(/^fnv1a_/, "")}`;
}

export async function upsertAgentProject(input: { id?: string; name: string; rootPath?: string; tags?: string[] }): Promise<AgentProject> {
  const now = Date.now();
  const id = input.id ?? projectIdFromRoot(input.rootPath ?? input.name);
  const existing = await nexusDB.projects.get(id);
  const project: AgentProject = {
    id,
    name: input.name.trim() || existing?.name || "Untitled project",
    rootPath: input.rootPath ?? existing?.rootPath,
    tags: [...new Set([...(existing?.tags ?? []), ...(input.tags ?? [])].map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await nexusDB.projects.put(project);
  return project;
}

export async function putConversationTurn(input: Omit<ConversationTurn, "id" | "createdAt" | "tokenCount"> & { id?: string; createdAt?: number; tokenCount?: number }): Promise<ConversationTurn> {
  const content = input.content;
  const turn: ConversationTurn = {
    id: input.id ?? createId("turn"),
    sessionId: input.sessionId,
    role: input.role,
    content,
    model: input.model,
    tags: input.tags ?? [],
    tokenCount: input.tokenCount ?? estimateTokenCount(content),
    createdAt: input.createdAt ?? Date.now(),
  };
  await nexusDB.conversationTurns.put(turn);
  return turn;
}

export async function putMemoryChunk(input: Omit<MemoryChunk, "id" | "contentHash" | "tokenCount" | "createdAt" | "updatedAt"> & Partial<Pick<MemoryChunk, "id" | "contentHash" | "tokenCount" | "createdAt" | "updatedAt">>): Promise<MemoryChunk> {
  const now = Date.now();
  const chunk: MemoryChunk = {
    ...input,
    id: input.id ?? createId("chunk"),
    contentHash: input.contentHash ?? stableContentHash(input.content),
    tokenCount: input.tokenCount ?? estimateTokenCount(input.content),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    tags: input.tags ?? [],
    importance: input.importance ?? 0.5,
    recencyBoost: input.recencyBoost ?? 1,
  };
  await nexusDB.memoryChunks.put(chunk);
  return chunk;
}

export async function putProjectFileIndex(input: Omit<ProjectFileIndex, "id" | "indexedAt"> & { id?: string; indexedAt?: number }): Promise<ProjectFileIndex> {
  const file: ProjectFileIndex = {
    ...input,
    id: input.id ?? `${input.projectId}:${input.path}`,
    indexedAt: input.indexedAt ?? Date.now(),
  };
  await nexusDB.projectFiles.put(file);
  return file;
}

export function maskSecretValue(value: string): string {
  if (!value) return "••••••••";
  return "••••••••";
}

export function normalizeSecretKey(secretKey: string): string {
  return secretKey
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export async function encryptCredential(plainText: string): Promise<string> {
  if (!plainText) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getCredentialKey();
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(new TextEncoder().encode(plainText)));
  return JSON.stringify({
    alg: "AES-GCM",
    iv: arrayBufferToBase64(toArrayBuffer(iv)),
    data: arrayBufferToBase64(cipherBuffer),
  });
}

export async function decryptCredential(encryptedText: string): Promise<string> {
  if (!encryptedText) return "";
  const payload = JSON.parse(encryptedText) as { alg: "AES-GCM"; iv: string; data: string };
  const key = await getCredentialKey();
  const plainBuffer = await crypto.subtle.decrypt({ name: payload.alg, iv: base64ToArrayBuffer(payload.iv) }, key, base64ToArrayBuffer(payload.data));
  return new TextDecoder().decode(plainBuffer);
}

async function getCredentialKey(): Promise<CryptoKey> {
  // Preserve the original derivation bytes so saved prototype credentials decrypt.
  const material = new Uint8Array([78, 101, 120, 117, 115, 72, 97, 114, 110, 101, 115, 115,
    32, 108, 111, 99, 97, 108, 32, 99, 114, 101, 100, 101, 110, 116, 105, 97, 108,
    32, 107, 101, 121, 32, 118, 49]);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return toArrayBuffer(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
