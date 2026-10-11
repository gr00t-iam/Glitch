import { Save, Square, X } from "lucide-react";
import { useRef, useState } from "react";

export interface ModelSandboxModalProps {
  modelId: string;
  modelName: string;
  vramEstimate?: string;
  onClose: () => void;
  onSnapshot?: (modelId: string, logs: string[]) => void;
}

async function* runMockSandbox(modelName: string, prompt: string): AsyncGenerator<string> {
  const steps = [
    `Allocating sandbox runtime for ${modelName}...`,
    "Loading tokenizer and context window...",
    `Prompt: ${prompt}`,
    "Generating isolated response stream...",
    "Sandbox response: Ready for local agent workflows.",
    "Integrity: no runtime write access requested.",
  ];
  for (const step of steps) {
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    yield step;
  }
}

export function ModelSandboxModal({ modelId, modelName, vramEstimate, onClose, onSnapshot }: ModelSandboxModalProps) {
  const [prompt, setPrompt] = useState("Reply with one sentence confirming you are ready.");
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const cancelledRef = useRef(false);

  async function startTest(): Promise<void> {
    setRunning(true);
    cancelledRef.current = false;
    setLogs([]);
    for await (const line of runMockSandbox(modelName, prompt)) {
      if (cancelledRef.current) break;
      setLogs((current) => [...current, line]);
    }
    setRunning(false);
  }

  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Sandbox test ${modelName}`}>
      <section className="settings-modal">
        <header>
          <div>
            <h2>Sandbox Test</h2>
            <span>{modelName} · {vramEstimate ?? "VRAM estimate pending"}</span>
          </div>
          <button type="button" aria-label="Close sandbox test" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <label>
          <span className="field-label">Test Prompt</span>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} />
        </label>
        <div className="settings-stream-log" role="log" aria-live="polite">
          {logs.length === 0 ? <code>$ waiting for sandbox test...</code> : logs.map((line) => <code key={line}>{line}</code>)}
        </div>
        <footer>
          <button
            type="button"
            onClick={() => {
              cancelledRef.current = true;
              setRunning(false);
            }}
          >
            <Square size={14} />
            Cancel
          </button>
          <button type="button" onClick={() => onSnapshot?.(modelId, logs)} disabled={logs.length === 0}>
            <Save size={14} />
            Save Snapshot
          </button>
          <button className="primary-btn" type="button" onClick={() => void startTest()} disabled={running || !prompt.trim()}>
            {running ? "Running..." : "Run Test"}
          </button>
        </footer>
      </section>
    </div>
  );
}
