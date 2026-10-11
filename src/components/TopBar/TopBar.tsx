import { ReactNode, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export interface TopBarProps {
  left: ReactNode;
  visibleActions: ReactNode;
  overflowActions: ReactNode;
}

export function TopBar({ left, visibleActions, overflowActions }: TopBarProps) {
  const [open, setOpen] = useState(false);
  return (
    <header className="command-bar topbar" role="banner">
      <div>{left}</div>
      <div className="command-actions">
        {visibleActions}
        <div className="topbar-overflow-anchor">
          <button className="icon-btn" type="button" aria-label="More workspace controls" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
            <MoreHorizontal size={16} />
          </button>
          {open && (
            <div className="topbar-overflow-menu" role="menu">
              {overflowActions}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

