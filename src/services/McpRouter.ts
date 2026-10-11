import { decryptCredential, nexusDB, NexusSession, StaticRule, VaultSecret } from "../db/nexusDB";
import { ollamaFetch, readOllamaError } from "./OllamaRuntime";
import { runtimeFetch } from "./RemoteRuntime";

export type JsonRpcId = string | number;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: TResult;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  headers?: Record<string, string>;
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface McpToolsListResult {
  tools: McpToolSchema[];
}

export interface StandardToolDefinition {
  serverId: string;
  provider: "openai" | "claude";
  name: string;
  description: string;
  input_schema?: McpToolSchema["inputSchema"];
  function?: {
    name: string;
    description: string;
    parameters: McpToolSchema["inputSchema"];
  };
}

export interface LlmToolCall {
  serverId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpExecutionResult {
  serverId: string;
  toolName: string;
  content: unknown;
}

export interface PreExecutionRoutingContext {
  matchedRules: StaticRule[];
  browserTargetUrl?: string;
  toolHeaders: Record<string, string>;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  session: Pick<NexusSession, "activeModel">;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  model: string;
  provider: "openai" | "anthropic" | "ollama";
  markdown: string;
  raw: unknown;
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

interface OllamaResponse {
  message?: { content?: string };
  response?: string;
}

function envValue(...keys: string[]): string | undefined {
  const env = import.meta.env as Record<string, string | undefined>;
  const fromEnv = keys.map((key) => env[key]).find((value): value is string => Boolean(value));
  if (fromEnv) return fromEnv;
  if (typeof localStorage === "undefined") return undefined;
  if (keys.some((key) => key.includes("OPENAI"))) return localStorage.getItem("NEXUS_OPENAI_API_KEY") ?? undefined;
  if (keys.some((key) => key.includes("ANTHROPIC"))) return localStorage.getItem("NEXUS_ANTHROPIC_API_KEY") ?? undefined;
  return undefined;
}

function normalizeModelId(activeModel: string): { provider: "openai" | "anthropic" | "ollama"; model: string } {
  if (activeModel.startsWith("openai:")) return { provider: "openai", model: activeModel.replace(/^openai:/, "") || "gpt-4o" };
  if (activeModel === "gpt-4o") return { provider: "openai", model: "gpt-4o" };
  if (activeModel.startsWith("anthropic:")) {
    return { provider: "anthropic", model: activeModel.replace(/^anthropic:/, "") || "claude-3-5-sonnet-20241022" };
  }
  if (activeModel.includes("claude-3-5-sonnet")) return { provider: "anthropic", model: activeModel };
  return { provider: "ollama", model: activeModel.replace(/^ollama:/, "") || "llama3" };
}

export interface StreamHandlers {
  onToken: (chunk: string) => void;
  signal?: AbortSignal;
}

export class LLMClient {
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const route = normalizeModelId(request.session.activeModel);
    if (route.provider === "openai") return this.completeOpenAI(request, route.model);
    if (route.provider === "anthropic") return this.completeAnthropic(request, route.model);
    return this.completeOllama(request, route.model);
  }

  /**
   * Streams a completion token-by-token. Falls back to a non-streaming request
   * if the provider/transport does not support streaming, still emitting the
   * full text through onToken so the caller renders identically.
   */
  async stream(request: LLMRequest, handlers: StreamHandlers): Promise<LLMResponse> {
    const route = normalizeModelId(request.session.activeModel);
    try {
      if (route.provider === "ollama") return await this.streamOllama(request, route.model, handlers);
      if (route.provider === "openai") return await this.streamOpenAI(request, route.model, handlers);
      if (route.provider === "anthropic") return await this.streamAnthropic(request, route.model, handlers);
    } catch (error) {
      if (handlers.signal?.aborted) throw error;
      // Fall through to a buffered request below.
    }
    const response = await this.complete(request);
    handlers.onToken(response.markdown);
    return response;
  }

  private async streamOllama(request: LLMRequest, model: string, handlers: StreamHandlers): Promise<LLMResponse> {
    const configuredEndpoint = envValue("VITE_OLLAMA_CHAT_URL", "OLLAMA_CHAT_URL");
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: handlers.signal,
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: true,
        options: { temperature: request.temperature ?? 0.2, num_predict: request.maxTokens ?? 800 },
      }),
    };
    const response = configuredEndpoint ? await runtimeFetch(configuredEndpoint, { ...init, retries: 1, timeoutMs: 120000 }) : await ollamaFetch("/api/chat", init);
    if (!response.ok || !response.body) throw new Error(await readOllamaError(response));
    let markdown = "";
    await readByLine(response.body, (line) => {
      if (!line.trim()) return;
      try {
        const json = JSON.parse(line) as OllamaResponse;
        const token = json.message?.content ?? json.response ?? "";
        if (token) {
          markdown += token;
          handlers.onToken(token);
        }
      } catch {
        /* ignore partial lines */
      }
    });
    return { model, provider: "ollama", markdown, raw: null };
  }

  private async streamOpenAI(request: LLMRequest, model: string, handlers: StreamHandlers): Promise<LLMResponse> {
    const endpoint = envValue("VITE_OPENAI_CHAT_URL", "OPENAI_CHAT_URL") ?? "https://api.openai.com/v1/chat/completions";
    const apiKey = envValue("VITE_OPENAI_API_KEY", "OPENAI_API_KEY");
    if (!apiKey && endpoint.includes("api.openai.com")) throw new Error("OpenAI key is missing. Add it in Settings & Core Runtime, or choose a local model.");
    const response = await runtimeFetch(endpoint, {
      method: "POST",
      signal: handlers.signal,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 800,
        stream: true,
      }),
    });
    if (!response.ok || !response.body) throw new Error(`OpenAI request failed with HTTP ${response.status}`);
    let markdown = "";
    await readSse(response.body, (data) => {
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const token = json.choices?.[0]?.delta?.content ?? "";
        if (token) {
          markdown += token;
          handlers.onToken(token);
        }
      } catch {
        /* ignore */
      }
    });
    return { model, provider: "openai", markdown, raw: null };
  }

  private async streamAnthropic(request: LLMRequest, model: string, handlers: StreamHandlers): Promise<LLMResponse> {
    const endpoint = envValue("VITE_ANTHROPIC_MESSAGES_URL", "ANTHROPIC_MESSAGES_URL") ?? "https://api.anthropic.com/v1/messages";
    const apiKey = envValue("VITE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY");
    if (!apiKey && endpoint.includes("api.anthropic.com")) throw new Error("Anthropic key is missing. Add it in Settings & Core Runtime, or choose a local model.");
    const systemPrompt = request.messages.find((message) => message.role === "system")?.content;
    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }));
    const response = await runtimeFetch(endpoint, {
      method: "POST",
      signal: handlers.signal,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
        ...(endpoint.includes("api.anthropic.com") ? { "anthropic-dangerous-direct-browser-access": "true" } : {}),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 800,
        stream: true,
      }),
    });
    if (!response.ok || !response.body) throw new Error(`Anthropic request failed with HTTP ${response.status}`);
    let markdown = "";
    await readSse(response.body, (data) => {
      try {
        const json = JSON.parse(data) as { type?: string; delta?: { text?: string } };
        if (json.type === "content_block_delta" && json.delta?.text) {
          markdown += json.delta.text;
          handlers.onToken(json.delta.text);
        }
      } catch {
        /* ignore */
      }
    });
    return { model, provider: "anthropic", markdown, raw: null };
  }

  private async completeOpenAI(request: LLMRequest, model: string): Promise<LLMResponse> {
    const endpoint = envValue("VITE_OPENAI_CHAT_URL", "OPENAI_CHAT_URL") ?? "https://api.openai.com/v1/chat/completions";
    const apiKey = envValue("VITE_OPENAI_API_KEY", "OPENAI_API_KEY");
    if (!apiKey && endpoint.includes("api.openai.com")) throw new Error("OpenAI key is missing. Add it in Settings & Core Runtime, or choose a local model.");

    const response = await runtimeFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 800,
      }),
    });
    const json = (await response.json()) as OpenAIResponse;
    if (!response.ok) throw new Error(`OpenAI request failed with HTTP ${response.status}`);
    return { model, provider: "openai", markdown: json.choices?.[0]?.message?.content ?? "", raw: json };
  }

  private async completeAnthropic(request: LLMRequest, model: string): Promise<LLMResponse> {
    const endpoint = envValue("VITE_ANTHROPIC_MESSAGES_URL", "ANTHROPIC_MESSAGES_URL") ?? "https://api.anthropic.com/v1/messages";
    const apiKey = envValue("VITE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY");
    if (!apiKey && endpoint.includes("api.anthropic.com")) throw new Error("Anthropic key is missing. Add it in Settings & Core Runtime, or choose a local model.");

    const systemPrompt = request.messages.find((message) => message.role === "system")?.content;
    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }));

    const response = await runtimeFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 800,
      }),
    });
    const json = (await response.json()) as AnthropicResponse;
    if (!response.ok) throw new Error(`Anthropic request failed with HTTP ${response.status}`);
    return { model, provider: "anthropic", markdown: json.content?.find((content) => content.type === "text")?.text ?? "", raw: json };
  }

  private async completeOllama(request: LLMRequest, model: string): Promise<LLMResponse> {
    const configuredEndpoint = envValue("VITE_OLLAMA_CHAT_URL", "OLLAMA_CHAT_URL");
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens ?? 800,
        },
      }),
    };
    const response = configuredEndpoint ? await runtimeFetch(configuredEndpoint, { ...init, retries: 1, timeoutMs: 120000 }) : await ollamaFetch("/api/chat", init);
    if (!response.ok) throw new Error(await readOllamaError(response));
    const json = (await response.json()) as OllamaResponse;
    return { model, provider: "ollama", markdown: json.message?.content ?? json.response ?? "", raw: json };
  }
}

export class McpRouter {
  private servers = new Map<string, McpServerConfig>();
  private toolIndex = new Map<string, { server: McpServerConfig; schema: McpToolSchema }>();
  private secureToolHeaders: Record<string, string> = {};

  constructor(initialServers: McpServerConfig[] = []) {
    for (const server of initialServers) this.registerServer(server);
  }

  registerServer(server: McpServerConfig): void {
    this.servers.set(server.id, server);
  }

  unregisterServer(serverId: string): void {
    this.servers.delete(serverId);
    for (const [key, indexed] of this.toolIndex) {
      if (indexed.server.id === serverId) this.toolIndex.delete(key);
    }
  }

  async preparePromptExecution(userPrompt: string): Promise<PreExecutionRoutingContext> {
    const [staticRules, vaultSecrets] = await Promise.all([nexusDB.staticRules.toArray(), nexusDB.vault.toArray()]);
    const matchedRules = matchStaticRules(userPrompt, staticRules);
    const toolHeaders = await buildSecretHeaders(vaultSecrets);

    this.secureToolHeaders = toolHeaders;
    return {
      matchedRules,
      browserTargetUrl: matchedRules.find((rule) => rule.targetUrl)?.targetUrl,
      toolHeaders: maskHeaderValues(toolHeaders),
    };
  }

  async refreshTools(provider: "openai" | "claude" = "openai"): Promise<StandardToolDefinition[]> {
    const definitions: StandardToolDefinition[] = [];
    for (const server of this.servers.values()) {
      await this.initialize(server);
      const result = await this.rpc<McpToolsListResult>(server, "tools/list", {});
      for (const schema of result.tools) {
        this.toolIndex.set(`${server.id}:${schema.name}`, { server, schema });
        definitions.push(this.toProviderTool(server.id, schema, provider));
      }
    }
    return definitions;
  }

  async executeToolCall(call: LlmToolCall): Promise<McpExecutionResult> {
    const indexed = this.toolIndex.get(`${call.serverId}:${call.name}`);
    if (!indexed) throw new Error(`App action ${call.serverId}:${call.name} is not registered.`);
    const result = await this.rpc(indexed.server, "tools/call", { name: call.name, arguments: call.arguments });
    return { serverId: call.serverId, toolName: call.name, content: result };
  }

  private async initialize(server: McpServerConfig): Promise<void> {
    await this.rpc(server, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { roots: { listChanged: true }, sampling: {} },
      clientInfo: { name: "Glitch", version: "0.1.0" },
    });
  }

  private toProviderTool(serverId: string, schema: McpToolSchema, provider: "openai" | "claude"): StandardToolDefinition {
    const name = `${serverId}_${schema.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const description = schema.description ?? `App action ${schema.name} from ${serverId}`;
    if (provider === "claude") return { serverId, provider, name, description, input_schema: schema.inputSchema };
    return { serverId, provider, name, description, function: { name, description, parameters: schema.inputSchema } };
  }

  private async rpc<TResult>(server: McpServerConfig, method: string, params?: unknown): Promise<TResult> {
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...server.headers,
        ...this.secureToolHeaders,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params } satisfies JsonRpcRequest),
    });
    if (!response.ok) throw new Error(`${server.name} returned HTTP ${response.status}`);
    const json = (await response.json()) as JsonRpcResponse<TResult>;
    if (json.error) throw new Error(`${server.name} ${method} failed: ${json.error.message}`);
    if (json.result === undefined) throw new Error(`${server.name} ${method} returned no result.`);
    return json.result;
  }
}

async function readByLine(body: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      onLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) onLine(buffer);
}

async function readSse(body: ReadableStream<Uint8Array>, onData: (data: string) => void): Promise<void> {
  await readByLine(body, (line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) onData(trimmed.slice(5).trim());
  });
}

function matchStaticRules(userPrompt: string, rules: StaticRule[]): StaticRule[] {
  const normalizedPrompt = userPrompt.toLowerCase();
  return rules.filter((rule) => {
    const keyword = rule.triggerKeyword.trim().toLowerCase();
    if (!keyword) return false;
    return normalizedPrompt.includes(keyword);
  });
}

async function buildSecretHeaders(vaultSecrets: VaultSecret[]): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const secret of vaultSecrets) {
    const headerName = `x-nexus-secret-${secret.secretKey.toLowerCase().replace(/_/g, "-")}`;
    try {
      headers[headerName] = await decryptCredential(secret.secretValue);
    } catch {
      headers[headerName] = secret.secretValue;
    }
  }
  return headers;
}

function maskHeaderValues(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(headers).map((key) => [key, "••••••••"]));
}
// streaming + MCP routing layer
