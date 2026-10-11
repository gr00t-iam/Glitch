import { useCallback, useRef, useState } from "react";
import Dexie, { type Table } from "dexie";

export interface SelfEditLogLine {
  id: string;
  type: "status" | "tool_call" | "tool_result" | "file_changed" | "done" | "error";
  message: string;
  timestamp: number;
}

export interface SnapshotRecord {
  id: string;
  createdAt: string;
  instruction: string;
  files: string[];
}

// Reuses the `dexie` dependency already in package.json to survive a dev-server
// restart triggered by the AI editing vite.config.ts or another backend file.
class SelfEditDB extends Dexie {
  logs!: Table<SelfEditLogLine, string>;
  constructor() {
    super("nexus-self-edit");
    this.version(1).stores({ logs: "id, timestamp" });
  }
}
const db = new SelfEditDB();

export function useSelfEdit() {
  const [logLines, setLogLines] = useState<SelfEditLogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const appendLine = useCallback((line: Omit<SelfEditLogLine, "id" | "timestamp">) => {
    const entry: SelfEditLogLine = { ...line, id: crypto.randomUUID(), timestamp: Date.now() };
    setLogLines((prev) => [...prev, entry]);
    void db.logs.put(entry);
  }, []);

  const runSelfEdit = useCallback(
    async (instruction: string) => {
      setRunning(true);
      setChangedFiles([]);
      appendLine({ type: "status", message: `> ${instruction}` });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/self-edit/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instruction }),
          signal: controller.signal,
        });

        if (!response.body) throw new Error("No response stream from server.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Basic reconnect: if the stream drops mid-run (e.g. backend hot-reload
        // restarted the dev server), retry once after a short delay.
        let retriedAfterDrop = false;

        const pump = async (): Promise<void> => {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const chunk of events) {
            const line = chunk.replace(/^data: /, "").trim();
            if (!line) continue;
            const event = JSON.parse(line);
            handleEvent(event);
          }
          return pump();
        };

        const handleEvent = (event: { type: string; message?: string; path?: string; changedFiles?: string[]; summary?: string }) => {
          if (event.type === "file_changed" && event.path) {
            setChangedFiles((prev) => [...new Set([...prev, event.path!])]);
          }
          if (event.type === "done") {
            appendLine({ type: "done", message: event.summary ?? "Done." });
            setChangedFiles(event.changedFiles ?? []);
          } else {
            appendLine({ type: event.type as SelfEditLogLine["type"], message: event.message ?? JSON.stringify(event) });
          }
        };

        try {
          await pump();
        } catch (streamError) {
          if (!retriedAfterDrop) {
            retriedAfterDrop = true;
            appendLine({ type: "status", message: "Connection dropped (likely a hot-reload). Reconnecting..." });
            await new Promise((r) => setTimeout(r, 1200));
            return runSelfEdit(instruction);
          }
          throw streamError;
        }
      } catch (error) {
        appendLine({ type: "error", message: error instanceof Error ? error.message : "Self-edit failed." });
      } finally {
        setRunning(false);
      }
    },
    [appendLine],
  );

  const refreshSnapshots = useCallback(async () => {
    const res = await fetch("/api/self-edit/snapshots");
    const data = await res.json();
    setSnapshots(data.snapshots ?? []);
  }, []);

  const revertToSnapshot = useCallback(
    async (snapshotId: string) => {
      appendLine({ type: "status", message: `Reverting to snapshot ${snapshotId}...` });
      const res = await fetch("/api/self-edit/revert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshotId }),
      });
      const data = await res.json();
      if (data.ok) {
        appendLine({ type: "done", message: `Reverted: ${data.restored.join(", ")}` });
      } else {
        appendLine({ type: "error", message: data.error ?? "Revert failed." });
      }
    },
    [appendLine],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { logLines, running, changedFiles, snapshots, runSelfEdit, refreshSnapshots, revertToSnapshot, stop };
}
