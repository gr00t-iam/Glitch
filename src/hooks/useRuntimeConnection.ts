import { useCallback, useEffect, useRef, useState } from "react";
import { runtimeClient, type ConnectionEvent, type ConnectionStatus } from "../services/browserRuntime/runtimeClient";

export interface UseRuntimeConnectionOptions {
  startAutoConnectOnMount?: boolean;
}

export function useRuntimeConnection({ startAutoConnectOnMount = false }: UseRuntimeConnectionOptions = {}) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [logs, setLogs] = useState<ConnectionEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const append = useCallback((event: ConnectionEvent) => {
    setLogs((current) => [...current.slice(-49), event]);
    if (event.status) setStatus(event.status);
  }, []);

  const connect = useCallback(async () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    for await (const event of runtimeClient.connectWithRetry({ signal: abort.signal })) append(event);
  }, [append]);

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    append({ type: "status", status: "disconnected", message: "Runtime connection stopped.", at: Date.now() });
  }, [append]);

  const startRuntime = useCallback(async () => {
    append({ type: "status", status: "starting", message: "Starting local runtime.", at: Date.now() });
    const result = await runtimeClient.startLocalRuntime();
    append({ type: result.started ? "log" : "error", status: result.started ? "starting" : "error", message: result.message ?? (result.started ? "Runtime start requested." : "Runtime did not start."), at: Date.now() });
  }, [append]);

  useEffect(() => {
    if (startAutoConnectOnMount) void connect();
    return () => abortRef.current?.abort();
  }, [connect, startAutoConnectOnMount]);

  return { status, logs, connect, disconnect, startRuntime };
}
