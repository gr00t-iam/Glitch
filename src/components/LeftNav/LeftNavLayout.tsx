import { lazy, Suspense, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ActivityLogPanel, type ActivityLogEntry } from "../ActivityLog";
import type { RuntimeLogEntry, SubAgentProfile } from "../AdminHub";
import { AssigneesPanel, PlanItemCard, type PlanItemCardProps } from "../ExecutionPlan";
import { AgentRail } from "../SubAgents";
import { ThreadsList, type ThreadListItem } from "../Threads";
import type { LocalModelInfo } from "../AdminHub";
import { ResourcePanel } from "../ResourcePanel";

const AIBrainVisualization = lazy(() =>
  import("../NeuralNetwork/AI_Brain_Visualization").then((module) => ({ default: module.AI_Brain_Visualization })),
);

export interface LeftNavCostSummary {
  tokensUsed: number;
  tokenPercent: number;
}

export interface LeftNavLayoutProps {
  collapsed: boolean;
  threads: ThreadListItem[];
  activeSessionId?: string;
  localModels: LocalModelInfo[];
  planItems: PlanItemCardProps[];
  activityEntries: ActivityLogEntry[];
  cost: LeftNavCostSummary;
  tokenVelocity: number;
  subAgents: SubAgentProfile[];
  runtimeLogs: RuntimeLogEntry[];
  modelDisplayName: (modelId: string, localModels: LocalModelInfo[]) => string;
  onCollapse: () => void;
  onThreadOpen: (sessionId: string) => void;
  onThreadRename: (thread: ThreadListItem) => void;
  onThreadDelete: (sessionId: string) => void;
  onThreadPin: (sessionId: string) => void;
  onThreadArchive: (sessionId: string) => void;
  onNewThread: () => void;
  onActivityClear: (restored?: ActivityLogEntry[]) => void;
  onAgentPause: (agentId: string) => void;
  onAgentResume: (agentId: string) => void;
  onAgentContextLimitChange: (agentId: string, contextLimit: number) => void;
}

const sectionLabels = ["Threads", "Execution Plan", "Activity Log", "Cost Tracker", "Sub-Agent Rail"];

export function LeftNavLayout({
  collapsed,
  threads,
  activeSessionId,
  localModels,
  planItems,
  activityEntries,
  cost,
  tokenVelocity,
  subAgents,
  runtimeLogs,
  modelDisplayName,
  onCollapse,
  onThreadOpen,
  onThreadRename,
  onThreadDelete,
  onThreadPin,
  onThreadArchive,
  onNewThread,
  onActivityClear,
  onAgentPause,
  onAgentResume,
  onAgentContextLimitChange,
}: LeftNavLayoutProps) {
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const sectionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleSectionKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      onCollapse();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const nextIndex = event.key === "ArrowDown"
      ? Math.min(sectionLabels.length - 1, activeSectionIndex + 1)
      : Math.max(0, activeSectionIndex - 1);
    setActiveSectionIndex(nextIndex);
    sectionRefs.current[nextIndex]?.focus();
  }

  if (collapsed) {
    return (
      <nav className="left-nav-layout collapsed" role="navigation" aria-label="Collapsed NexusHarness navigation">
        <AgentRail collapsed agents={subAgents} logs={runtimeLogs} onPause={onAgentPause} onResume={onAgentResume} onContextLimitChange={onAgentContextLimitChange} />
      </nav>
    );
  }

  return (
    <nav className="left-nav-layout" role="navigation" aria-label="NexusHarness left navigation" onKeyDown={handleSectionKeyDown}>
      {sectionLabels.map((label, index) => (
        <button
          key={label}
          ref={(element) => { sectionRefs.current[index] = element; }}
          type="button"
          className={`left-nav-section-tab ${activeSectionIndex === index ? "active" : ""}`}
          aria-expanded={activeSectionIndex === index}
          onClick={() => setActiveSectionIndex(index)}
        >
          {label}
        </button>
      ))}

      <section className="left-nav-section" role="region" aria-label={sectionLabels[activeSectionIndex]}>
        {activeSectionIndex === 0 && (
          <>
            <button className="new-chat-btn" type="button" onClick={onNewThread}>New chat</button>
            <ThreadsList
              activeSessionId={activeSessionId}
              localModels={localModels}
              modelDisplayName={modelDisplayName}
              onArchive={onThreadArchive}
              onDelete={onThreadDelete}
              onPin={onThreadPin}
              onRename={onThreadRename}
              onSelect={onThreadOpen}
              sessions={threads}
            />
            <div className="left-nav-neural-indicator" aria-label="Ambient AI brain activity">
              <Suspense fallback={<span className="left-nav-neural-loading" aria-hidden="true" />}>
                <AIBrainVisualization compact />
              </Suspense>
            </div>
          </>
        )}
        {activeSectionIndex === 1 && (
          <div className="plan-section-stack">
            {planItems.map((item) => (
              <div key={item.id}>
                <AssigneesPanel
                  itemId={item.id}
                  activeAssignee={item.assignedTo}
                  assignees={[
                    { id: "You", name: "You", reason: "user" },
                    { id: "AI Helper", name: "AI Helper", reason: "auto" },
                    { id: "Policy", name: "Policy", reason: "policy" },
                  ]}
                  onReassign={() => item.onClaim?.(item.id)}
                />
                <PlanItemCard {...item} />
              </div>
            ))}
          </div>
        )}
        {activeSectionIndex === 2 && <ActivityLogPanel entries={activityEntries} onClear={onActivityClear} />}
        {activeSectionIndex === 3 && (
          <ResourcePanel tokenVelocity={tokenVelocity} tokensUsed={cost.tokensUsed} tokenPercent={cost.tokenPercent} />
        )}
        {activeSectionIndex === 4 && (
          <AgentRail agents={subAgents} logs={runtimeLogs} onPause={onAgentPause} onResume={onAgentResume} onContextLimitChange={onAgentContextLimitChange} />
        )}
      </section>
    </nav>
  );
}
