import { ReactNode, useEffect, useRef } from "react";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The trigger element (usually a button). Rendered inside the anchor so it doesn't count as an outside click. */
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  /** Open below ("down", default) or above ("up") the trigger. */
  direction?: "up" | "down";
  label?: string;
  cardClassName?: string;
}

/**
 * A lightweight anchored popover. The card is absolutely positioned directly
 * below the trigger (no portal, no Popper) and closes on outside-click or Escape.
 */
export function Popover({ open, onClose, trigger, children, align = "right", direction = "down", label, cardClassName }: PopoverProps) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div className="popover-anchor" ref={anchorRef}>
      {trigger}
      {open && (
        <div className={`popover-card ${align} ${direction} ${cardClassName ?? ""}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
