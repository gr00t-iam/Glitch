import { apiUrl, runtimeFetch } from "./RemoteRuntime";

export interface OllamaRuntimeTarget {
  baseUrl: string;
  label: string;
}

export interface OllamaProgressEvent {
  status?: string;
  completed?: number;
  total?: number;
  error?: string;
}

const runtimeTargets: OllamaRuntimeTarget[] = [
  ...(import.meta.env.VITE_OLLAMA_BASE_URL ? [{ baseUrl: import.meta.env.VITE_OLLAMA_BASE_URL as string, label: "configured Ollama bridge" }] : []),
  { baseUrl: "/ollama", label: "built-in local bridge" },
  { baseUrl: "http://127.0.0.1:11434", label: "local Ollama" },
  { baseUrl: "http://localhost:11434", label: "local Ollama" },
];

export async function findOllamaRuntime(): Promise<OllamaRuntimeTarget> {
  for (const target of runtimeTargets) {
    try {
      const response = await fetchWithTimeout(`${target.baseUrl}/api/tags`, { method: "GET" }, 1800);
      if (response.ok) return target;
      if (response.status === 404 && target.baseUrl === "/ollama") continue;
    } catch (error) {
      console.debug("Ollama runtime check failed", target.label, error);
    }
  }

  throw new Error(
    [
      "Local model engine is not reachable.",
      "Open Ollama and make sure it is listening on port 11434, then try again.",
    ].join(" "),
  );
}

export async function ollamaFetch(path: string, init?: RequestInit): Promise<Response> {
  const runtime = await findOllamaRuntime();
  const targetUrl = runtime.baseUrl.startsWith("/") ? apiUrl(`${runtime.baseUrl}${path}`) : `${runtime.baseUrl}${path}`;
  return runtimeFetch(targetUrl, { ...init, retries: 2, timeoutMs: 120000 });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url.startsWith("/") ? apiUrl(url) : url, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function readOllamaError(response: Response): Promise<string> {
  try {
    const data = (await response.clone().json()) as { error?: string; message?: string };
    return data.error ?? data.message ?? `Local model engine returned HTTP ${response.status}`;
  } catch {
    try {
      const text = await response.text();
      return text.trim() || `Local model engine returned HTTP ${response.status}`;
    } catch {
      return `Local model engine returned HTTP ${response.status}`;
    }
  }
}

export function normalizeModelIdentifier(input: string): string {
  const value = input.trim();
  if (!value) return value;

  const huggingFaceUrl = value.match(/^https?:\/\/(?:www\.)?huggingface\.co\/([^/]+\/[^/?#]+)(?:\/resolve\/[^/]+\/([^?#]+))?/i);
  if (huggingFaceUrl) {
    const repo = huggingFaceUrl[1];
    const fileName = huggingFaceUrl[2];
    if (!fileName) return `hf.co/${repo}`;

    const quantTag = decodeURIComponent(fileName).match(/\b((?:I?Q\d|KQ\d)(?:_[A-Z0-9]+)+|BF16|F16|FP16)\b/i)?.[1];
    return quantTag ? `hf.co/${repo}:${quantTag}` : `hf.co/${repo}`;
  }

  if (/^[\w.-]+\/[\w.-]+(?::[\w.-]+)?$/.test(value) && !value.startsWith("hf.co/")) {
    return `hf.co/${value}`;
  }

  return value;
}
