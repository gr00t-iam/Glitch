export interface RuntimeRequestOptions extends RequestInit {
  retries?: number;
  timeoutMs?: number;
}

export interface ReconnectPlan {
  attempt: number;
  delayMs: number;
}

const defaultTimeoutMs = 15000;
const defaultRetries = 2;

function envValue(key: string): string {
  return ((import.meta.env[key] as string | undefined) ?? "").trim();
}

export function runtimeApiBase(): string {
  return envValue("VITE_NEXUS_API_BASE").replace(/\/$/, "");
}

export function runtimeWsBase(): string {
  return envValue("VITE_NEXUS_WS_BASE").replace(/\/$/, "");
}

export function cdpHttpBase(defaultEndpoint = "/cdp"): string {
  return envValue("VITE_NEXUS_CDP_HTTP_BASE").replace(/\/$/, "") || defaultEndpoint;
}

export function cdpWsBase(): string {
  return envValue("VITE_NEXUS_CDP_WS_BASE").replace(/\/$/, "");
}

export function isRemoteRuntime(): boolean {
  return Boolean(runtimeApiBase() || runtimeWsBase() || cdpWsBase());
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = runtimeApiBase();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function wsUrl(path: string): string {
  if (/^wss?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const configuredBase = runtimeWsBase();
  if (configuredBase) return `${configuredBase}${normalizedPath}`;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${normalizedPath}`;
}

export function reconnectDelay(attempt: number): number {
  const boundedAttempt = Math.min(attempt, 8);
  const jitter = Math.round(Math.random() * 250);
  return Math.min(30000, 500 * 2 ** boundedAttempt + jitter);
}

export async function runtimeFetch(input: string, options: RuntimeRequestOptions = {}): Promise<Response> {
  const { retries = defaultRetries, timeoutMs = defaultTimeoutMs, ...init } = options;
  const url = apiUrl(input);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (init.signal?.aborted) controller.abort();
    init.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok || response.status < 500 || attempt === retries) return response;
      lastError = new Error(`Request failed with HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
    } finally {
      window.clearTimeout(timeout);
      init.signal?.removeEventListener("abort", abortFromCaller);
    }
    await wait(reconnectDelay(attempt));
  }

  throw lastError instanceof Error ? lastError : new Error("Network request failed.");
}

export async function runtimeJson<T>(input: string, options: RuntimeRequestOptions = {}): Promise<T> {
  const response = await runtimeFetch(input, options);
  return (await response.json()) as T;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
