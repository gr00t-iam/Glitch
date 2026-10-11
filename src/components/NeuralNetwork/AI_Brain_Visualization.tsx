import { useEffect, useState } from "react";
import { LivingBrainCanvas } from "./LivingBrainCanvas";

export interface AIBrainVisualizationProps {
  neuronActivity?: number[];
  className?: string;
  compact?: boolean;
}

const initialActivity = [0.16, 0.31, 0.48, 0.72, 0.91, 0.58, 0.84, 0.39, 0.67, 0.95, 0.26, 0.76];

/** Full-bleed right-rail visualization with a lightweight simulated activity feed. */
export function AI_Brain_Visualization({ neuronActivity, className = "", compact = false }: AIBrainVisualizationProps) {
  const [simulatedActivity, setSimulatedActivity] = useState(initialActivity);

  useEffect(() => {
    if (neuronActivity?.length) return;

    const timer = window.setInterval(() => {
      setSimulatedActivity((values) =>
        values.map((value, index) => {
          const pulse = Math.sin(Date.now() / 620 + index * 0.83) * 0.18;
          return Math.max(0.08, Math.min(1, value * 0.72 + 0.22 + pulse));
        }),
      );
    }, 850);

    return () => window.clearInterval(timer);
  }, [neuronActivity]);

  return (
    <div className={`ai-brain-visualization ${compact ? "compact" : ""} ${className}`} role="region" aria-label="AI Brain Visualization">
      <LivingBrainCanvas compact={compact} neuronActivity={neuronActivity?.length ? neuronActivity : simulatedActivity} />
    </div>
  );
}

export default AI_Brain_Visualization;
