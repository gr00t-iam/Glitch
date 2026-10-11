import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";

export interface ContextTrackerState {
  contextPercent: number;
  lastUpdated: string;
}

export interface ContextTrackerValue extends ContextTrackerState {
  setContext: (data: Partial<ContextTrackerState>) => void;
}

declare global {
  interface Window {
    __legacyContextTop?: Partial<ContextTrackerState>;
  }
}

const ContextStore = createContext<ContextTrackerValue | null>(null);

function readLegacyContext(): ContextTrackerState {
  const legacy = window.__legacyContextTop;
  if (legacy && typeof legacy.contextPercent === "number") {
    console.warn("[Glitch] window.__legacyContextTop is deprecated. Use ContextStoreProvider/useContextTracker instead.");
    return {
      contextPercent: Math.max(0, Math.min(100, legacy.contextPercent)),
      lastUpdated: legacy.lastUpdated ?? new Date().toISOString(),
    };
  }
  return { contextPercent: 0, lastUpdated: new Date().toISOString() };
}

export function ContextStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContextTrackerState>(() => readLegacyContext());
  const setContext = useCallback((data: Partial<ContextTrackerState>) => {
    setState((current) => ({
      contextPercent: Math.max(0, Math.min(100, data.contextPercent ?? current.contextPercent)),
      lastUpdated: data.lastUpdated ?? new Date().toISOString(),
    }));
  }, []);
  const value = useMemo<ContextTrackerValue>(
    () => ({
      ...state,
      setContext,
    }),
    [setContext, state],
  );

  return <ContextStore.Provider value={value}>{children}</ContextStore.Provider>;
}

export function useContextTracker(): ContextTrackerValue {
  const context = useContext(ContextStore);
  if (!context) throw new Error("useContextTracker must be used inside ContextStoreProvider.");
  return context;
}
