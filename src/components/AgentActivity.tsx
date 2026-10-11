import { useEffect, useState } from "react";
import { FilePen, Sparkles, TerminalSquare } from "lucide-react";
import { onWorkspaceChanged } from "../services/WorkspaceBridge";

type ActivityKind = "terminal" | "file" | "skill" | "generic";

interface Activity {
  kind: ActivityKind;
  label: string;
}

function classify(reason: string): Activity {
  const r = reason.toLowerCase();
  if (r.startsWith("ran:")) {
    const command = reason.slice(4).trim();
    return { kind: "terminal", label: `Running ${command.slice(0, 42) || "command"}` };
  }
  if (r.startsWith("wrote") || r.startsWith("deleted") || r.startsWith("created") || r.startsWith("renamed")) {
    return { kind: "file", label: "Modifying local files" };
  }
  if (r.startsWith("staged") || r.startsWith("reverted")) {
    return { kind: "file", label: "Updating workspace changes" };
  }
  if (r.includes("skill")) {
    return { kind: "skill", label: "Invoking a skill" };
  }
  return { kind: "generic", label: "Working" };
}

/**
 * Sleek inline indicator shown in the chat stream while the agent is acting
 * on the machine. It listens to the WorkspaceBridge's `workspace-changed`
 * events (terminal runs, file writes, staging) and auto-dismisses when idle.
 */
export function AgentActivity() {
  const [activity, setActivity] = useState<Activity | null>(null);

  useEffect(() => {
    let timer = 0;
    const unsubscribe = onWorkspaceChanged((reason) => {
      setActivity(classify(reason));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setActivity(null), 2600);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  if (!activity) return null;
  const Icon = activity.kind === "terminal" ? TerminalSquare : activity.kind === "file" ? FilePen : Sparkles;

  return (
    <div className="agent-activity" aria-live="polite">
      <div className={`agent-activity-chip ${activity.kind}`}>
        <span className="spark">
          <Icon size={14} />
        </span>
        <span>{activity.label}</span>
        <span className="pulse-dots">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
