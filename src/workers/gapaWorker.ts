import { appendEpisodicMemory, appendMemorySkillCard, normalizeSecretKey, upsertStaticRule, upsertVaultSecret } from "../db/nexusDB";

export interface ExecutionLogEntry {
  stepNumber: number;
  agentId: string;
  thought?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  error?: string;
  tokensUsed: number;
  createdAt: number;
}

export interface GapaWorkerRequest {
  type: "GAPA_REVIEW";
  sessionId: string;
  logs: ExecutionLogEntry[];
  llmEndpoint?: string;
}

export interface PersistenceIntentRequest {
  type: "PERSISTENCE_INTENT";
  requestId: string;
  text: string;
}

export interface PersistenceIntentResult {
  type: "PERSISTENCE_WRITE_RESULT";
  requestId: string;
  handled: boolean;
  badge?: string;
  table?: "vault" | "staticRules" | "episodicMemory";
  summary?: string;
}

export type GapaWorkerMessage = GapaWorkerRequest | PersistenceIntentRequest;

export interface GapaReviewResult {
  type: "GAPA_REVIEW_RESULT";
  sessionId: string;
  prompt: string;
  markdownSkillCard: string;
  memoryMarkdown: string;
  findings: GapaFinding[];
}

export interface GapaFinding {
  severity: "info" | "warning" | "critical";
  category: "tool-error" | "hallucination-risk" | "token-bloat" | "recovery";
  message: string;
}

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const HARDWARE_MEMORY_BADGE = "🔒 Permanently written to hardware memory.";

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 1800);
  } catch {
    return String(value).slice(0, 1800);
  }
}

function buildMetaReviewerPrompt(logs: ExecutionLogEntry[]): string {
  const latestLogs = logs.slice(-15);
  return [
    "You are the Glitch Self-Correcting Meta-Reviewer.",
    "Inspect the last 15 execution steps and return one compact Markdown Local Skill Card.",
    "Requirements:",
    "1. Identify concrete tool errors and the smallest recovery action.",
    "2. Isolate hallucinations by naming claims not grounded in tool output.",
    "3. Prune trivial token bloat and repeated context.",
    "4. Preserve only reusable operating knowledge.",
    "5. Format the output as a Markdown Local Skill Card with: title, triggers, failure pattern, correction, injection prompt, and verification.",
    "6. The card will be saved into MEMORY.md in IndexedDB, so it must be concise and directly reusable.",
    "",
    "Execution logs:",
    latestLogs
      .map((log) =>
        [
          `Step ${log.stepNumber} / agent=${log.agentId} / tokens=${log.tokensUsed}`,
          log.toolName ? `tool=${log.toolName}` : "tool=none",
          log.error ? `error=${log.error}` : "error=none",
          log.thought ? `thought=${log.thought.slice(0, 500)}` : "thought=none",
          `input=${compactJson(log.toolInput)}`,
          `output=${compactJson(log.toolOutput)}`,
        ].join("\n"),
      )
      .join("\n\n---\n\n"),
  ].join("\n");
}

function inferFindings(logs: ExecutionLogEntry[]): GapaFinding[] {
  const findings: GapaFinding[] = [];
  const errors = logs.filter((log) => log.error);
  const highTokenSteps = logs.filter((log) => log.tokensUsed > 2500);
  const ungrounded = logs.filter((log) => log.thought && !log.toolOutput && /confirmed|verified|latest|guaranteed/i.test(log.thought));

  for (const error of errors.slice(-4)) {
    findings.push({
      severity: "warning",
      category: "tool-error",
      message: `Step ${error.stepNumber} failed in ${error.toolName ?? "unknown tool"}: ${error.error}`,
    });
  }

  for (const step of ungrounded.slice(-3)) {
    findings.push({
      severity: "warning",
      category: "hallucination-risk",
      message: `Step ${step.stepNumber} used certainty language without a matching tool result.`,
    });
  }

  if (highTokenSteps.length > 0) {
    findings.push({
      severity: "info",
      category: "token-bloat",
      message: `${highTokenSteps.length} recent step(s) exceeded the 2500-token local pruning threshold.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      category: "recovery",
      message: "No critical drift found; preserve compact successful trajectory context.",
    });
  }

  return findings;
}

function synthesizeSkillCard(sessionId: string, logs: ExecutionLogEntry[], findings: GapaFinding[]): string {
  const failedTools = Array.from(new Set(logs.filter((log) => log.error && log.toolName).map((log) => log.toolName)));
  const triggerKeywords = ["gapa", "self-correction", ...failedTools].filter(Boolean).join(", ");
  const topFinding = findings[0];

  return [
    "## Local Skill Card: GAPA Runtime Correction",
    "",
    `- Session: \`${sessionId}\``,
    `- Triggers: ${triggerKeywords}`,
    `- Failure pattern: ${topFinding.message}`,
    "- Correction: Before continuing, compare the claimed state against the last successful tool output, drop repeated context, and retry only the minimal failed action.",
    "- Injection prompt: Use the last verified checkpoint as source of truth. Treat unverified claims as hypotheses until tool output confirms them.",
    "- Verification: Record the next successful tool response in the trajectory log before marking the subtask unblocked.",
  ].join("\n");
}

async function optionallyAskLlm(endpoint: string, prompt: string): Promise<string | undefined> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, mode: "markdown_skill_card" }),
  });
  if (!response.ok) {
    throw new Error(`GAPA LLM endpoint returned ${response.status}`);
  }
  const data = (await response.json()) as { markdownSkillCard?: string; text?: string };
  return data.markdownSkillCard ?? data.text;
}

function parsePersistenceIntent(text: string):
  | { table: "vault"; secretKey: string; secretValue: string; summary: string }
  | { table: "staticRules"; triggerKeyword: string; expectedBehavior: string; targetUrl: string; summary: string }
  | { table: "episodicMemory"; interactionSummary: string; summary: string }
  | undefined {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const isMemoryCommand = /^(remember|save|always look up)\b/i.test(trimmed);
  if (!isMemoryCommand) return undefined;

  const secretMatch =
    trimmed.match(/(?:remember|save)\s+([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*(?:=|:|is|as)\s*(.+)$/i) ??
    trimmed.match(/(?:remember|save)\s+(.+?)\s+(?:password|token|api key|secret)\s*(?:=|:|is|as)\s*(.+)$/i);
  if (secretMatch) {
    const secretKey = normalizeSecretKey(secretMatch[1]);
    const secretValue = secretMatch[2].trim().replace(/^["']|["']$/g, "");
    if (secretKey && secretValue) return { table: "vault", secretKey, secretValue, summary: `${secretKey} saved to vault.` };
  }

  const urlMatch = trimmed.match(/\bhttps?:\/\/[^\s)]+/i);
  if (lower.startsWith("always look up") || urlMatch) {
    const withoutCommand = trimmed.replace(/^(remember|save|always look up)\s+/i, "").trim();
    const triggerKeyword = inferRuleKeyword(withoutCommand);
    const targetUrl = urlMatch?.[0] ?? inferTargetUrl(triggerKeyword);
    return {
      table: "staticRules",
      triggerKeyword,
      expectedBehavior: `When the prompt mentions "${triggerKeyword}", open ${targetUrl} before answering.`,
      targetUrl,
      summary: `${triggerKeyword} mapped to ${targetUrl}.`,
    };
  }

  const interactionSummary = trimmed.replace(/^(remember|save)\s+/i, "").trim();
  if (interactionSummary) return { table: "episodicMemory", interactionSummary, summary: "Interaction summary saved." };
  return undefined;
}

function inferRuleKeyword(value: string): string {
  const urlStripped = value.replace(/\bhttps?:\/\/[^\s)]+/i, "").replace(/\b(to|at|on|using|for|when|i|say|ask|about)\b/gi, " ");
  const words = urlStripped
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !["look", "always", "open", "navigate"].includes(word));
  return words[0] ?? "automation";
}

function inferTargetUrl(triggerKeyword: string): string {
  if (/weather|forecast|temperature/i.test(triggerKeyword)) return "http://wttr.in";
  return `https://www.google.com/search?q=${encodeURIComponent(triggerKeyword)}`;
}

async function handlePersistenceIntent(request: PersistenceIntentRequest): Promise<PersistenceIntentResult> {
  const intent = parsePersistenceIntent(request.text);
  if (!intent) return { type: "PERSISTENCE_WRITE_RESULT", requestId: request.requestId, handled: false };

  if (intent.table === "vault") {
    await upsertVaultSecret(intent.secretKey, intent.secretValue);
    return { type: "PERSISTENCE_WRITE_RESULT", requestId: request.requestId, handled: true, badge: HARDWARE_MEMORY_BADGE, table: "vault", summary: intent.summary };
  }

  if (intent.table === "staticRules") {
    await upsertStaticRule({
      triggerKeyword: intent.triggerKeyword,
      expectedBehavior: intent.expectedBehavior,
      targetUrl: intent.targetUrl,
    });
    return {
      type: "PERSISTENCE_WRITE_RESULT",
      requestId: request.requestId,
      handled: true,
      badge: HARDWARE_MEMORY_BADGE,
      table: "staticRules",
      summary: intent.summary,
    };
  }

  await appendEpisodicMemory(intent.interactionSummary);
  return {
    type: "PERSISTENCE_WRITE_RESULT",
    requestId: request.requestId,
    handled: true,
    badge: HARDWARE_MEMORY_BADGE,
    table: "episodicMemory",
    summary: intent.summary,
  };
}

ctx.addEventListener("message", (event: MessageEvent<GapaWorkerMessage>) => {
  const request = event.data;
  if (request.type === "PERSISTENCE_INTENT") {
    void handlePersistenceIntent(request)
      .then((result) => ctx.postMessage(result))
      .catch((error: unknown) => {
        ctx.postMessage({
          type: "PERSISTENCE_WRITE_ERROR",
          requestId: request.requestId,
          error: error instanceof Error ? error.message : "Unknown persistence write error",
        });
      });
    return;
  }

  if (request.type !== "GAPA_REVIEW") return;

  void (async () => {
    const logs = request.logs.slice(-15);
    const prompt = buildMetaReviewerPrompt(logs);
    const findings = inferFindings(logs);
    let markdownSkillCard = synthesizeSkillCard(request.sessionId, logs, findings);

    if (request.llmEndpoint) {
      try {
        markdownSkillCard = (await optionallyAskLlm(request.llmEndpoint, prompt)) ?? markdownSkillCard;
      } catch (error) {
        findings.unshift({
          severity: "warning",
          category: "tool-error",
          message: error instanceof Error ? error.message : "GAPA LLM endpoint failed.",
        });
      }
    }

    const memorySkill = await appendMemorySkillCard(markdownSkillCard, ["gapa", "MEMORY.md", "self-correction"]);
    const result: GapaReviewResult = {
      type: "GAPA_REVIEW_RESULT",
      sessionId: request.sessionId,
      prompt,
      markdownSkillCard,
      memoryMarkdown: memorySkill.systemPromptSnippet,
      findings,
    };
    ctx.postMessage(result);
  })().catch((error: unknown) => {
    ctx.postMessage({
      type: "GAPA_REVIEW_ERROR",
      sessionId: request.sessionId,
      error: error instanceof Error ? error.message : "Unknown GAPA worker error",
    });
  });
});
