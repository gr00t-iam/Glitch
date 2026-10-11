import { Download, Square, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

export interface PullRegistryModel {
  name: string;
  size: string;
  vramEstimate: string;
  quantization: string;
  license: string;
  checksum: string;
}

export interface PullModelModalProps {
  open: boolean;
  onClose: () => void;
  onPulled?: (modelName: string) => Promise<void> | void;
  onLog?: (message: string) => void;
}

const registry: PullRegistryModel[] = [
  { name: "llama3.1:8b", size: "4.7 GB", vramEstimate: "~6 GB", quantization: "Q4_K_M", license: "Meta Llama", checksum: "sha256:llama318b" },
  { name: "qwen2.5-coder:7b", size: "4.4 GB", vramEstimate: "~6 GB", quantization: "Q4_K_M", license: "Apache-2.0", checksum: "sha256:qwen25coder7b" },
  { name: "mistral-nemo:12b", size: "7.1 GB", vramEstimate: "~9 GB", quantization: "Q4_K_M", license: "Apache-2.0", checksum: "sha256:mistralnemo12b" },
  { name: "deepseek-coder-v2:16b", size: "8.9 GB", vramEstimate: "~11 GB", quantization: "Q4_K_M", license: "DeepSeek", checksum: "sha256:deepseekcoder16b" },
];

async function* mockPull(modelName: string): AsyncGenerator<{ progress: number; message: string }> {
  const steps = [
    [8, `Resolving ${modelName} metadata...`],
    [22, "Validating license and manifest..."],
    [41, "Downloading model layers..."],
    [67, "Verifying checksum..."],
    [86, "Registering local model..."],
    [100, `${modelName} is ready.`],
  ] as const;
  for (const [progress, message] of steps) {
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    yield { progress, message };
  }
}

export function PullModelModal({ open, onClose, onPulled, onLog }: PullModelModalProps) {
  const [query, setQuery] = useState(() => localStorage.getItem("NEXUS_LAST_PULL_REGISTRY") ?? "");
  const [selected, setSelected] = useState<PullRegistryModel | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [pulling, setPulling] = useState(false);
  const cancelledRef = useRef(false);

  const suggestions = useMemo(() => registry.filter((model) => model.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5), [query]);

  if (!open) return null;

  async function startPull(): Promise<void> {
    const modelName = (selected?.name ?? query).trim();
    if (!/^[\w./:-]+$/.test(modelName)) {
      setError("Use a valid model name: letters, numbers, slash, dot, colon, dash, or underscore.");
      return;
    }
    localStorage.setItem("NEXUS_LAST_PULL_REGISTRY", modelName);
    setError("");
    setPulling(true);
    cancelledRef.current = false;
    setLogs([]);
    for await (const event of mockPull(modelName)) {
      if (cancelledRef.current) break;
      setProgress(event.progress);
      setLogs((current) => [...current, event.message]);
      onLog?.(event.message);
    }
    setPulling(false);
    if (!cancelledRef.current) await onPulled?.(modelName);
  }

  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true" aria-label="Pull Model">
      <section className="settings-modal">
        <header>
          <div>
            <h2>Pull Model</h2>
            <span>Search the local registry or paste a supported model identifier.</span>
          </div>
          <button type="button" aria-label="Close pull model" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <label>
          <span className="field-label">Model Name</span>
          <input
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "pull-model-error" : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
            }}
            placeholder="llama3.1:8b"
          />
        </label>
        {error && <span id="pull-model-error" className="settings-error">{error}</span>}
        <div className="settings-autocomplete" role="listbox" aria-label="Model suggestions">
          {suggestions.map((model) => (
            <button
              type="button"
              role="option"
              aria-selected={selected?.name === model.name}
              key={model.name}
              onClick={() => {
                setSelected(model);
                setQuery(model.name);
              }}
            >
              <strong>{model.name}</strong>
              <span>{model.size} · {model.quantization}</span>
            </button>
          ))}
        </div>
        {selected && (
          <dl className="settings-metadata-preview">
            <div><dt>Size</dt><dd>{selected.size}</dd></div>
            <div><dt>VRAM</dt><dd>{selected.vramEstimate}</dd></div>
            <div><dt>Quantization</dt><dd>{selected.quantization}</dd></div>
            <div><dt>License</dt><dd>{selected.license}</dd></div>
            <div><dt>Checksum</dt><dd>{selected.checksum}</dd></div>
          </dl>
        )}
        <div className="settings-progress"><div style={{ width: `${progress}%` }} /></div>
        <div className="settings-stream-log" role="log" aria-live="polite">
          {logs.length === 0 ? <code>$ pull logs will stream here...</code> : logs.map((line) => <code key={line}>{line}</code>)}
        </div>
        <footer>
          <button type="button" onClick={() => { cancelledRef.current = true; setPulling(false); }}>
            <Square size={14} />
            Cancel
          </button>
          <button className="primary-btn" type="button" onClick={() => void startPull()} disabled={pulling}>
            <Download size={14} />
            {pulling ? "Pulling..." : "Start Pull"}
          </button>
        </footer>
      </section>
    </div>
  );
}
