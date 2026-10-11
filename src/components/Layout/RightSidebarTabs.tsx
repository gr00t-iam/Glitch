import { CheckCircle2, FolderOpen, Search } from "lucide-react";

export type RightSidebarTab = "browser" | "files" | "review";

export interface RightSidebarTabsProps {
  activeTab: RightSidebarTab;
  onChange: (tab: RightSidebarTab) => void;
}

const tabs = [
  { id: "browser" as const, label: "Live Browser", Icon: Search },
  { id: "files" as const, label: "File Explorer", Icon: FolderOpen },
  { id: "review" as const, label: "Code Review", Icon: CheckCircle2 },
];

export function RightSidebarTabs({ activeTab, onChange }: RightSidebarTabsProps) {
  return (
    <div className="control-center-tabs" role="tablist" aria-label="Execution modules">
      {tabs.map(({ id, label, Icon }) => (
        <button
          className={activeTab === id ? "active" : ""}
          id={`right-sidebar-tab-${id}`}
          key={id}
          role="tab"
          type="button"
          aria-controls={`right-sidebar-panel-${id}`}
          aria-selected={activeTab === id}
          onClick={() => onChange(id)}
        >
          <Icon size={15} aria-hidden="true" />
          <span className="control-center-tab-label">{label}</span>
        </button>
      ))}
    </div>
  );
}

export default RightSidebarTabs;
