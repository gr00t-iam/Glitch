export type PlanItemStatus = "queued" | "active" | "done" | "rejected";

export interface PlanLockPayload {
  itemId: string;
  lockedBy: string;
  expiresAt: number;
  reason: "policy" | "user" | "auto";
}

export type PlanEvent =
  | { type: "plan:update"; itemId: string; status?: PlanItemStatus; progress?: number; lastUpdated?: number }
  | { type: "plan:lock"; lock: PlanLockPayload }
  | { type: "plan:unlock"; itemId: string }
  | { type: "plan:step-log"; itemId: string; message: string; at: number };

type PlanEventListener = (event: PlanEvent) => void;

class PlanEventBus {
  private listeners = new Set<PlanEventListener>();

  subscribe(listener: PlanEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: PlanEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export const planEventBus = new PlanEventBus();
