import { useEffect, useRef, useState } from "react";
import { useSelfEdit } from "../hooks/useSelfEdit";
import "./BuildStatusPanel.css";

const ICONS: Record<string, string> = {
  status: "•",
  tool_call: "→",
  tool_result: "✓",
  file_changed: "✎",
  done: "✅",
  error: "✖",
};

export function BuildStatusPanel() {
  const { logLines, running, changedFiles, snapshots, runSelfEdit, refreshSnapshots, revertToSnapshot } = useSelfEdit();
  const [instruction, setInstruction] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [logLines]);

  useEffect(() => {
    if (panelOpen) void refreshSnapshots();
  }, [panelOpen, refreshSnapshots]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!instruction.trim() || running) return;
    setPanelOpen(true);
    const text = instruction;
    setInstruction("");
    await runSelfEdit(text);
    await refreshSnapshots();
  };

  return (
    <div className="build-status-panel" data-open={panelOpen}>
      <form className="build-status-input" onSubmit={handleSubmit}>
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Ask Glitch to modify itself... e.g. 'Add a dark mode toggle to the navbar'"
          disabled={running}
        />
        <button type="submit" disabled={running || !instruction.trim()}>
          {running ? "Working..." : "Self-Edit"}
        </button>
        <button type="button" className="ghost" onClick={() => setPanelOpen((v) => !v)}>
          {panelOpen ? "Hide log" : "Show log"}
        </button>
      </form>

      {panelOpen && (
        <div className="build-status-body">
          <div className="build-status-log" ref={logRef}>
            {logLines.length === 0 && <div className="log-line muted">No self-edit activity yet.</div>}
            {logLines.map((line) => (
              <div key={line.id} className={`log-line log-${line.type}`}>
                <span className="log-icon">{ICONS[line.type] ?? "•"}</span>
                <span className="log-message">{line.message}</span>
              </div>
            ))}
            {running && <div className="log-line log-status pulsing">▍</div>}
          </div>

          <div className="build-status-sidebar">
            <div className="sidebar-section">
              <h4>Changed files</h4>
              {changedFiles.length === 0 ? (
                <p className="muted">None yet.</p>
              ) : (
                <ul>
                  {changedFiles.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="sidebar-section">
              <h4>Rollback points</h4>
              {snapshots.length === 0 ? (
                <p className="muted">No snapshots yet.</p>
              ) : (
                <ul className="snapshot-list">
                  {snapshots.slice(0, 6).map((snap) => (
                    <li key={snap.id}>
                      <div className="snapshot-meta">
                        <span>{new Date(snap.createdAt).toLocaleTimeString()}</span>
                        <span className="snapshot-instruction" title={snap.instruction}>
                          {snap.instruction.slice(0, 40)}
                        </span>
                      </div>
                      <button className="revert-button" onClick={() => revertToSnapshot(snap.id)}>
                        Revert
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
