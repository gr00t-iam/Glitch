export interface HealthInfo {
  status: "ok" | "starting" | "error";
  version?: string;
  pid?: number;
  wsUrl?: string;
  ephemeralToken?: string;
  message?: string;
}

export interface RuntimeStartResult {
  started: boolean;
  pid?: number;
  port?: number;
  message?: string;
}

export type ConnectionStatus = "idle" | "starting" | "connecting" | "connected" | "disconnected" | "error" | "dry-run";

export interface ConnectionEvent {
  type: "status" | "log" | "error";
  status?: ConnectionStatus;
  message: string;
  at: number;
}

export interface ConnectWithRetryOptions {
  healthUrl?: string;
  signal?: AbortSignal;
  maxAttempts?: number;
}

const baseDelayMs = 500;
const maxDelayMs = 30_000;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function backoff(attempt: number): number {
  const jitter = 0.5 + Math.random();
  return Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) * jitter;
}

export class RuntimeClient {
  async startLocalRuntime(): Promise<RuntimeStartResult> {
    try {
      const response = await fetch("/start", { method: "POST" });
      if (!response.ok) throw new Error(`Runtime start failed with HTTP ${response.status}`);
      return (await response.json()) as RuntimeStartResult;
    } catch (error) {
      return { started: false, message: error instanceof Error ? error.message : "Runtime start failed." };
    }
  }

  async waitForHealth(url: string, timeoutMs = 30_000, intervalMs = 1000): Promise<HealthInfo> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const response = await fetch(`${url.replace(/\/$/, "")}/health`);
      const health = (await response.json()) as HealthInfo;
      if (health.status === "ok") return health;
      await delay(intervalMs);
    }
    throw new Error("Timed out waiting for runtime health.");
  }

  async connectWebSocket(wsUrl: string, token: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const url = new URL(wsUrl);
      url.searchParams.set("version", "1");
      url.searchParams.set("token", token);
      const socket = new WebSocket(url.toString(), ["glitch.runtime.v1"]);
      socket.addEventListener("open", () => resolve(socket), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket handshake failed.")), { once: true });
    });
  }

  async *connectWithRetry(options: ConnectWithRetryOptions = {}): AsyncGenerator<ConnectionEvent, void, void> {
    const healthUrl = options.healthUrl ?? window.location.origin;
    const maxAttempts = options.maxAttempts ?? 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (options.signal?.aborted) return;
      yield { type: "status", status: "connecting", message: `Checking runtime health (attempt ${attempt + 1}).`, at: Date.now() };
      try {
        const health = await this.waitForHealth(healthUrl, 5000, 750);
        if (!health.wsUrl || !health.ephemeralToken) {
          yield { type: "log", status: "connected", message: "Runtime health is OK. Browser preview will attach through CDP.", at: Date.now() };
          return;
        }
        await this.connectWebSocket(health.wsUrl, health.ephemeralToken);
        yield { type: "status", status: "connected", message: "Runtime WebSocket connected.", at: Date.now() };
        return;
      } catch (error) {
        const waitMs = Math.round(backoff(attempt));
        yield { type: "error", status: "disconnected", message: `${error instanceof Error ? error.message : "Connection failed."} Retrying in ${waitMs}ms.`, at: Date.now() };
        await delay(waitMs, options.signal);
      }
    }
    yield { type: "status", status: "error", message: "Runtime connection attempts exhausted.", at: Date.now() };
  }
}

export const runtimeClient = new RuntimeClient();
