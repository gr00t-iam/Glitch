import { Copy, Download } from "lucide-react";
import type { ConnectionEvent } from "../../services/browserRuntime/runtimeClient";

export interface ConnectionLogProps {
  logs: ConnectionEvent[];
}

export function maskDiagnosticLine(value: string): string {
  return value
    .replace(/token=[^&\s]+/gi, "token=[redacted]")
    .replace(/"ephemeralToken"\s*:\s*"[^"]+"/gi, "\"ephemeralToken\":\"[redacted]\"")
    .replace(/(sk-|ghp_|github_pat_)[A-Za-z0-9_:-]+/g, "[redacted secret]")
    .replace(/([?&][^=\s]+)=([^&\s]+)/g, "$1=[redacted]");
}

export function ConnectionLog({ logs }: ConnectionLogProps) {
  const masked = logs.map((log) => `${new Date(log.at).toLocaleTimeString()} ${log.type}: ${maskDiagnosticLine(log.message)}`);
  function download(): void {
    const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), logs: masked }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nexusharness-browser-diagnostics.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="connection-log" role="log" aria-live="polite" aria-label="Runtime connection logs">
      <div className="connection-log-actions">
        <button type="button" onClick={() => void navigator.clipboard.writeText(masked.join("\n"))}><Copy size={13} /> Copy</button>
        <button type="button" onClick={download}><Download size={13} /> Download</button>
      </div>
      <div className="connection-log-lines">
        {masked.length === 0 ? <code>No runtime connection logs yet.</code> : masked.map((line) => <code key={line}>{line}</code>)}
      </div>
    </section>
  );
}
