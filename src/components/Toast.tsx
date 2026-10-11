import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
  timeout: number;
}

interface ToastContextValue {
  push: (message: string, tone?: ToastTone, timeout?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneIcon: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message: string, tone: ToastTone = "info", timeout = 4200) => {
    const id = `toast_${crypto.randomUUID()}`;
    setToasts((current) => [...current.slice(-4), { id, tone, message, timeout }]);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const Icon = toneIcon[toast.tone];
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.timeout);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div className={`toast toast-${toast.tone}`}>
      <Icon size={17} />
      <span>{toast.message}</span>
      <button aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        <X size={14} />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) return { push: () => undefined };
  return context;
}
