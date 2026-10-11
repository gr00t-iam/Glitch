import type { LiveSearchResponse } from "./WorkspaceBridge";

export interface AssistantToolIntent {
  name: string;
  arguments: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value)) ?? {};
    } catch {
      return {};
    }
  }
  return asRecord(value) ?? {};
}

/** Detects common provider and legacy tool-call envelopes without evaluating them. */
export function extractAssistantToolIntent(markdown: string): AssistantToolIntent | null {
  const candidate = markdown.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;

  try {
    const root = asRecord(JSON.parse(candidate));
    if (!root) return null;
    const calls = Array.isArray(root.tool_calls) ? root.tool_calls : [];
    const call = asRecord(calls[0]);
    const fn = asRecord(call?.function) ?? asRecord(root.function);
    const name = root.action ?? root.name ?? root.tool ?? fn?.name;
    const args = root.arguments ?? root.args ?? root.parameters ?? fn?.arguments;
    return typeof name === "string" && name.trim()
      ? { name: name.trim(), arguments: parseArguments(args) }
      : null;
  } catch {
    return null;
  }
}

function formatSearchFallback(search: LiveSearchResponse): string {
  if (!search.ok || search.results.length === 0) {
    return "### Search unavailable\n\nI could not retrieve useful web results for this request. Please try again in a moment.";
  }

  const results = search.results.slice(0, 5).map((result, index) => {
    const summary = (result.snippet || result.content || "No summary was provided.").replace(/\s+/g, " ").trim().slice(0, 360);
    return `${index + 1}. [${result.title || "Search result"}](${result.url})\n   ${summary}`;
  });
  return ["### Web search results", "", `I searched for **${search.query}** and found:`, "", ...results].join("\n");
}

/** Converts internal tool syntax into user-facing Markdown before render or persistence. */
export function formatAssistantMarkdown(markdown: string, liveSearch?: LiveSearchResponse | null): string {
  const intent = extractAssistantToolIntent(markdown);
  if (!intent) return markdown.trim() || "Done.";

  if (/^(live_?search|live_web_search|web_search)$/i.test(intent.name) && liveSearch) {
    return formatSearchFallback(liveSearch);
  }

  return [
    "### Action not completed",
    "",
    "The selected AI Brain returned an internal action request instead of a readable response. Nothing was exposed or executed. Please try the request again.",
  ].join("\n");
}

/** Keeps provider/runtime failures conversational and strips structured payloads or secrets. */
export function formatAssistantError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message || extractAssistantToolIntent(message) || /^[\[{]/.test(message.trim())) {
    return "I could not complete that request. Please try again in a moment.";
  }
  const safeMessage = message
    .replace(/([?&](?:token|key|secret|authorization)=)[^&\s]+/gi, "$1[hidden]")
    .replace(/\b(?:sk|api)[-_][A-Za-z0-9_-]{12,}\b/g, "[hidden]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return `I could not complete that request. ${safeMessage || "Please try again in a moment."}`;
}
