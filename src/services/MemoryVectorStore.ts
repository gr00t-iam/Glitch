import {
  createId,
  EpisodicMemory,
  MemoryChunk,
  NexusSession,
  estimateTokenCount,
  nexusDB,
  putConversationTurn,
  putMemoryChunk,
  putProjectFileIndex,
  stableContentHash,
  upsertAgentProject,
} from "../db/nexusDB";

export interface MemorySearchResult {
  memory: EpisodicMemory;
  score: number;
  source: "indexeddb" | "qdrant" | "chroma";
}

export interface RememberExchangeInput {
  session: Pick<NexusSession, "id" | "title" | "activeModel">;
  userText: string;
  assistantText: string;
  sourceMessageId?: string;
  projectId?: string;
  projectRoot?: string;
  tags?: string[];
}

export interface RememberProjectFileInput {
  projectId?: string;
  projectRoot?: string;
  projectName?: string;
  path: string;
  content: string;
  language?: string;
  modifiedAt?: number;
  tags?: string[];
}

const embeddingDimensions = 384;
const qdrantCollection = "nexus_memory_chunks";
const legacyQdrantCollection = "nexus_episodic_memory";
const maxStoredCharacters = 12000;
const secretPattern =
  /\b(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9_]{20,}|github_pat_[a-zA-Z0-9_]+|xox[baprs]-[a-zA-Z0-9-]+|AKIA[0-9A-Z]{16})\b/g;

function envValue(key: string): string {
  return ((import.meta.env[key] as string | undefined) ?? "").trim().replace(/\/$/, "");
}

function redactSecrets(value: string): string {
  return value.replace(secretPattern, "[redacted secret]");
}

function summarizeExchange(userText: string, assistantText: string): string {
  const user = redactSecrets(userText).replace(/\s+/g, " ").trim();
  const assistant = redactSecrets(assistantText).replace(/\s+/g, " ").trim();
  return [`User: ${user}`, `Assistant: ${assistant}`].join("\n").slice(0, maxStoredCharacters);
}

function tokenize(text: string): string[] {
  return redactSecrets(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9_./:-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && token.length < 80);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function embedText(text: string): number[] {
  const vector = new Array<number>(embeddingDimensions).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const hash = fnv1a(token);
    const index = hash % embeddingDimensions;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign * (1 + Math.min(token.length, 16) / 16);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

function cosineSimilarity(left: number[], right: number[]): number {
  const size = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / ((Math.sqrt(leftNorm) || 1) * (Math.sqrt(rightNorm) || 1));
}

function memoryPayload(memory: EpisodicMemory): Record<string, unknown> {
  return {
    id: memory.id,
    timestamp: memory.timestamp,
    sessionId: memory.sessionId,
    role: memory.role,
    interactionSummary: memory.interactionSummary,
    content: memory.content,
    model: memory.model,
    tags: memory.tags ?? [],
  };
}

function chunkPayload(chunk: MemoryChunk): Record<string, unknown> {
  return {
    id: chunk.id,
    timestamp: chunk.updatedAt,
    sessionId: chunk.sessionId,
    projectId: chunk.projectId,
    sourceType: chunk.sourceType,
    sourceId: chunk.sourceId,
    role: chunk.sourceType === "chat" ? "exchange" : chunk.sourceType,
    interactionSummary: chunk.summary,
    content: chunk.content,
    model: undefined,
    title: chunk.title,
    path: chunk.path,
    language: chunk.language,
    chunkIndex: chunk.chunkIndex,
    contentHash: chunk.contentHash,
    tokenCount: chunk.tokenCount,
    tags: chunk.tags,
    importance: chunk.importance,
    recencyBoost: chunk.recencyBoost,
  };
}

function chunkToMemory(chunk: MemoryChunk): EpisodicMemory {
  return {
    id: chunk.id,
    timestamp: chunk.updatedAt,
    sessionId: chunk.sessionId,
    role: chunk.sourceType === "chat" ? "exchange" : "system",
    interactionSummary: chunk.summary,
    content: chunk.content,
    sourceMessageId: chunk.sourceId,
    tags: chunk.tags,
    embeddingVector: chunk.embeddingVector,
  };
}

function chunkText(content: string, targetTokens: number): string[] {
  const maxCharacters = targetTokens * 4;
  const blocks = content.split(/(\n{2,})/);
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (current && current.length + block.length > maxCharacters) {
      chunks.push(current.trim());
      current = "";
    }
    if (block.length > maxCharacters) {
      for (let index = 0; index < block.length; index += maxCharacters) {
        const slice = block.slice(index, index + maxCharacters).trim();
        if (slice) chunks.push(slice);
      }
      continue;
    }
    current += block;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [content];
}

function inferSourceType(path: string, language?: string): MemoryChunk["sourceType"] {
  const lower = `${path} ${language ?? ""}`.toLowerCase();
  if (/\b(logs?|trace|stdout|stderr)\b|\.log$/.test(lower)) return "game_log";
  if (/\b(config|settings|env|ini|toml|ya?ml|json)\b/.test(lower)) return "server_config";
  if (/\b(ts|tsx|js|jsx|py|rs|go|cs|java|cpp|c|h|lua)\b/.test(lower)) return "project_file";
  return "project_file";
}

function inferImportance(path: string): number {
  const lower = path.toLowerCase();
  if (/(package\.json|vite\.config|server|runtime|agent|game|world|player|auth|network|socket)/.test(lower)) return 0.78;
  if (/(readme|agents\.md|claude\.md|memory|config|env)/.test(lower)) return 0.7;
  return 0.52;
}

function summarizeChunk(path: string, content: string): string {
  return `${path}: ${content.replace(/\s+/g, " ").trim().slice(0, 700)}`;
}

function fromQdrantPoint(point: QdrantSearchPoint): MemorySearchResult | null {
  const payload = point.payload;
  if (!payload || typeof payload.interactionSummary !== "string") return null;
  return {
    source: "qdrant",
    score: point.score,
    memory: {
      id: String(payload.id ?? point.id),
      timestamp: Number(payload.timestamp ?? Date.now()),
      sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
      role: payload.role === "human" || payload.role === "agent" || payload.role === "system" || payload.role === "exchange" ? payload.role : "exchange",
      interactionSummary: payload.interactionSummary,
      content: typeof payload.content === "string" ? payload.content : payload.interactionSummary,
      model: typeof payload.model === "string" ? payload.model : undefined,
      tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
      embeddingVector: [],
    },
  };
}

interface QdrantSearchPoint {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class MemoryVectorStore {
  async rememberExchange(input: RememberExchangeInput): Promise<EpisodicMemory> {
    const content = summarizeExchange(input.userText, input.assistantText);
    const now = Date.now();
    const tags = [...new Set([...(input.tags ?? []), input.session.title].filter(Boolean).map((tag) => tag.toLowerCase()))];
    let projectId = input.projectId;
    if (!projectId && input.projectRoot) {
      const project = await upsertAgentProject({
        name: input.session.title,
        rootPath: input.projectRoot,
        tags: ["active-project", ...tags],
      });
      projectId = project.id;
    }
    const userTurn = await putConversationTurn({
      sessionId: input.session.id,
      role: "human",
      content: redactSecrets(input.userText).slice(0, maxStoredCharacters),
      model: input.session.activeModel,
      tags,
      createdAt: now,
    });
    await putConversationTurn({
      sessionId: input.session.id,
      role: "agent",
      content: redactSecrets(input.assistantText).slice(0, maxStoredCharacters),
      model: input.session.activeModel,
      tags,
      createdAt: now + 1,
    });
    const chunk = await putMemoryChunk({
      sessionId: input.session.id,
      projectId,
      sourceType: "chat",
      sourceId: input.sourceMessageId ?? userTurn.id,
      chunkIndex: 0,
      title: input.session.title,
      content,
      summary: content.slice(0, 900),
      embeddingVector: embedText(content),
      tags,
      importance: tags.includes("pinned-memory") || tags.includes("error") ? 0.8 : 0.55,
      recencyBoost: 1,
      createdAt: now,
      updatedAt: now,
    });
    const memory: EpisodicMemory = {
      id: createId("memory"),
      sessionId: input.session.id,
      timestamp: now,
      role: "exchange",
      sourceMessageId: input.sourceMessageId,
      model: input.session.activeModel,
      tags,
      interactionSummary: content.slice(0, 900),
      content,
      embeddingVector: chunk.embeddingVector,
    };

    await nexusDB.episodicMemory.put(memory);
    await Promise.allSettled([this.upsertQdrant(chunk), this.upsertChroma(chunk), this.upsertLegacyQdrant(memory)]);
    return memory;
  }

  async rememberProjectFile(input: RememberProjectFileInput): Promise<MemoryChunk[]> {
    const project =
      input.projectId || input.projectRoot
        ? await upsertAgentProject({
            id: input.projectId,
            name: input.projectName ?? input.path.split(/[\\/]/).at(0) ?? "Project",
            rootPath: input.projectRoot,
            tags: input.tags,
          })
        : undefined;
    const projectId = input.projectId ?? project?.id;
    const contentHash = stableContentHash(input.content);
    const chunks = chunkText(input.content, 1100);
    const tags = [...new Set([...(input.tags ?? []), "project-file", input.language ?? ""].filter(Boolean).map((tag) => tag.toLowerCase()))];
    const now = Date.now();
    const written = await Promise.all(
      chunks.map((chunkContent, chunkIndex) =>
        putMemoryChunk({
          projectId,
          sourceType: inferSourceType(input.path, input.language),
          sourceId: `${projectId ?? "project"}:${input.path}`,
          chunkIndex,
          title: input.path,
          path: input.path,
          language: input.language,
          content: chunkContent,
          summary: summarizeChunk(input.path, chunkContent),
          contentHash: `${contentHash}:${chunkIndex}`,
          embeddingVector: embedText(chunkContent),
          tags,
          importance: inferImportance(input.path),
          recencyBoost: 1,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    );
    if (projectId) {
      await putProjectFileIndex({
        projectId,
        path: input.path,
        contentHash,
        language: input.language,
        sizeBytes: new Blob([input.content]).size,
        modifiedAt: input.modifiedAt ?? now,
        chunkIds: written.map((chunk) => chunk.id),
        tags,
      });
    }
    await Promise.allSettled(written.map((chunk) => this.upsertQdrant(chunk)));
    return written;
  }

  async search(query: string, options: { limit?: number; excludeSessionId?: string } = {}): Promise<MemorySearchResult[]> {
    const limit = options.limit ?? 5;
    const vector = embedText(query);
    const [localResults, qdrantResults, chromaResults] = await Promise.all([
      this.searchLocal(vector, limit, options.excludeSessionId),
      this.searchQdrant(vector, limit, options.excludeSessionId),
      this.searchChroma(vector, limit, options.excludeSessionId),
    ]);

    const merged = new Map<string, MemorySearchResult>();
    for (const result of [...qdrantResults, ...chromaResults, ...localResults]) {
      if (options.excludeSessionId && result.memory.sessionId === options.excludeSessionId) continue;
      const existing = merged.get(result.memory.id);
      if (!existing || result.score > existing.score) merged.set(result.memory.id, result);
    }
    return [...merged.values()]
      .filter((result) => result.score > 0.08)
      .sort((a, b) => b.score - a.score || b.memory.timestamp - a.memory.timestamp)
      .slice(0, limit);
  }

  private async searchLocal(vector: number[], limit: number, excludeSessionId?: string): Promise<MemorySearchResult[]> {
    const [chunks, legacyRows] = await Promise.all([
      nexusDB.memoryChunks.orderBy("updatedAt").reverse().limit(1600).toArray(),
      nexusDB.episodicMemory.orderBy("timestamp").reverse().limit(600).toArray(),
    ]);
    const chunkResults = chunks
      .filter((chunk) => chunk.embeddingVector?.length && chunk.sessionId !== excludeSessionId)
      .map((chunk) => {
        const vectorScore = cosineSimilarity(vector, chunk.embeddingVector);
        const score = vectorScore * 0.86 + chunk.importance * 0.09 + Math.min(chunk.recencyBoost, 1) * 0.05;
        return { memory: chunkToMemory(chunk), score, source: "indexeddb" as const };
      });
    const legacyResults = legacyRows
      .filter((memory) => memory.embeddingVector?.length && memory.sessionId !== excludeSessionId)
      .map((memory) => ({ memory, score: cosineSimilarity(vector, memory.embeddingVector), source: "indexeddb" as const }))
      .filter((result) => !chunks.some((chunk) => chunk.id === result.memory.id));
    return [...chunkResults, ...legacyResults]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private async ensureQdrantCollection(collection = qdrantCollection): Promise<string | null> {
    const base = envValue("VITE_QDRANT_URL");
    if (!base) return null;
    await fetch(`${base}/collections/${collection}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vectors: { size: embeddingDimensions, distance: "Cosine" } }),
    });
    return base;
  }

  private async upsertQdrant(chunk: MemoryChunk): Promise<void> {
    const base = await this.ensureQdrantCollection();
    if (!base) return;
    await fetch(`${base}/collections/${qdrantCollection}/points?wait=true`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        points: [
          {
            id: chunk.id,
            vector: chunk.embeddingVector,
            payload: chunkPayload(chunk),
          },
        ],
      }),
    });
  }

  private async upsertLegacyQdrant(memory: EpisodicMemory): Promise<void> {
    const base = await this.ensureQdrantCollection(legacyQdrantCollection);
    if (!base) return;
    await fetch(`${base}/collections/${legacyQdrantCollection}/points?wait=true`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        points: [
          {
            id: memory.id,
            vector: memory.embeddingVector,
            payload: memoryPayload(memory),
          },
        ],
      }),
    });
  }

  private async searchQdrant(vector: number[], limit: number, excludeSessionId?: string): Promise<MemorySearchResult[]> {
    const base = envValue("VITE_QDRANT_URL");
    if (!base) return [];
    await this.ensureQdrantCollection();
    const mustNot = excludeSessionId ? [{ key: "sessionId", match: { value: excludeSessionId } }] : [];
    const response = await fetch(`${base}/collections/${qdrantCollection}/points/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vector,
        limit,
        with_payload: true,
        filter: mustNot.length ? { must_not: mustNot } : undefined,
      }),
    });
    if (!response.ok) return [];
    const json = (await safeJson(response)) as { result?: QdrantSearchPoint[] } | null;
    return (json?.result ?? []).map(fromQdrantPoint).filter((result): result is MemorySearchResult => Boolean(result));
  }

  private async upsertChroma(chunk: MemoryChunk): Promise<void> {
    const base = envValue("VITE_CHROMA_URL");
    if (!base) return;
    const collectionId = await this.ensureChromaCollection(base);
    if (!collectionId) return;
    await fetch(`${base}/api/v1/collections/${collectionId}/upsert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: [chunk.id],
        embeddings: [chunk.embeddingVector],
        documents: [chunk.content],
        metadatas: [chunkPayload(chunk)],
      }),
    });
  }

  private async searchChroma(vector: number[], limit: number, excludeSessionId?: string): Promise<MemorySearchResult[]> {
    const base = envValue("VITE_CHROMA_URL");
    if (!base) return [];
    const collectionId = await this.ensureChromaCollection(base);
    if (!collectionId) return [];
    const response = await fetch(`${base}/api/v1/collections/${collectionId}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query_embeddings: [vector],
        n_results: limit,
        where: excludeSessionId ? { sessionId: { "$ne": excludeSessionId } } : undefined,
      }),
    });
    if (!response.ok) return [];
    const json = (await safeJson(response)) as {
      ids?: string[][];
      distances?: number[][];
      documents?: string[][];
      metadatas?: Array<Array<Record<string, unknown>>>;
    } | null;
    const ids = json?.ids?.[0] ?? [];
    const distances = json?.distances?.[0] ?? [];
    const docs = json?.documents?.[0] ?? [];
    const metadatas = json?.metadatas?.[0] ?? [];
    return ids.map((id, index) => {
      const meta = metadatas[index] ?? {};
      const content = docs[index] ?? String(meta.content ?? meta.interactionSummary ?? "");
      return {
        source: "chroma" as const,
        score: 1 - Number(distances[index] ?? 1),
        memory: {
          id,
          timestamp: Number(meta.timestamp ?? Date.now()),
          sessionId: typeof meta.sessionId === "string" ? meta.sessionId : undefined,
          role: "exchange",
          interactionSummary: String(meta.interactionSummary ?? content.slice(0, 900)),
          content,
          model: typeof meta.model === "string" ? meta.model : undefined,
          tags: [],
          embeddingVector: [],
        },
      };
    });
  }

  private async ensureChromaCollection(base: string): Promise<string | null> {
    const existing = await fetch(`${base}/api/v1/collections/${qdrantCollection}`);
    if (existing.ok) {
      const json = (await safeJson(existing)) as { id?: string } | null;
      return json?.id ?? qdrantCollection;
    }
    const created = await fetch(`${base}/api/v1/collections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: qdrantCollection, metadata: { "hnsw:space": "cosine" } }),
    });
    if (!created.ok) return null;
    const json = (await safeJson(created)) as { id?: string } | null;
    return json?.id ?? qdrantCollection;
  }
}

export const memoryVectorStore = new MemoryVectorStore();

export function formatMemorySearchResults(results: MemorySearchResult[]): string {
  if (!results.length) return "";
  return results
    .map((result, index) => {
      const when = new Date(result.memory.timestamp).toLocaleString();
      const content = (result.memory.content ?? result.memory.interactionSummary).replace(/\s+/g, " ").trim();
      return `${index + 1}. ${content.slice(0, 900)}\n   Source: ${result.source}, score ${result.score.toFixed(2)}, ${when}`;
    })
    .join("\n\n");
}
