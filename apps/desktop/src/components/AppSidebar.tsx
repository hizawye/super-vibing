import { useEffect, useRef } from "react";
import type { AppSection } from "../types";

export interface WorkspaceNavView {
  id: string;
  name: string;
  paneCount: number;
}

interface SectionItem {
  id: AppSection;
  label: string;
  icon: string;
  locked?: boolean;
  hint?: string;
}

interface AppSidebarProps {
  open: boolean;
  activeSection: AppSection;
  workspaces: WorkspaceNavView[];
  activeWorkspaceId: string | null;
  onClose: () => void;
  onSelectSection: (section: AppSection) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onCloseWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: () => void;
}

const PRIMARY_SECTIONS: SectionItem[] = [
  { id: "terminal", label: "Terminal", icon: ">_" },
  { id: "git", label: "Git", icon: "GT" },
  { id: "worktrees", label: "Worktrees", icon: "WT" },
  { id: "kanban", label: "Kanban", icon: "KB", locked: true, hint: "PRO" },
  { id: "agents", label: "Agents", icon: "AI", locked: true, hint: "PRO" },
  { id: "prompts", label: "Prompts", icon: "PR", locked: true, hint: "PRO" },
];

export function AppSidebar({
  open,
  activeSection,
  workspaces,
  activeWorkspaceId,
  onClose,
  onSelectSection,
  onSelectWorkspace,
  onCloseWorkspace,
  onCreateWorkspace,
}: AppSidebarProps) {
  const firstActionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    firstActionRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`sidebar-backdrop ${open ? "open" : ""}`}
        aria-label="Close navigation"
        onClick={onClose}
      />

      <aside className={`app-sidebar ${open ? "open" : ""}`} aria-label="Primary navigation">
        <header className="app-sidebar-header">
          <div className="sidebar-brand">
            <span className="sidebar-brand-dot" aria-hidden="true">
              ⚡
            </span>
            <div className="sidebar-brand-copy">
              <strong>SuperVibing</strong>
              <small>Workspace Navigator</small>
            </div>
          </div>

          <button type="button" className="sidebar-close-btn" aria-label="Close navigation" onClick={onClose}>
            ×
          </button>
        </header>

        <nav className="sidebar-section-nav" aria-label="App sections">
          <p className="sidebar-nav-label">Navigate</p>
          {PRIMARY_SECTIONS.map((item, index) => {
            const active = item.id === activeSection;
            return (
              <button
                key={item.id}
                ref={index === 0 ? firstActionRef : null}
                type="button"
                className={`sidebar-section-item ${active ? "active" : ""} ${item.locked ? "locked" : ""}`}
                aria-current={active ? "page" : undefined}
                aria-disabled={item.locked ? "true" : undefined}
                disabled={item.locked}
                onClick={() => {
                  onSelectSection(item.id);
                }}
              >
                <span className="sidebar-section-main">
                  <span className="sidebar-item-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </span>
                {item.hint ? <small>{item.hint}</small> : null}
              </button>
            );
          })}
        </nav>

        <section className="sidebar-workspace-panel" aria-label="Workspaces">
          <div className="sidebar-panel-head">
            <h2>Workspaces</h2>
            <button type="button" className="workspace-add" aria-label="New workspace" onClick={onCreateWorkspace}>
              +
            </button>
          </div>

          <div className="sidebar-workspace-list">
            {workspaces.map((workspace) => {
              const active = workspace.id === activeWorkspaceId;
              const closable = workspaces.length > 1;

              return (
                <div key={workspace.id} className={`sidebar-workspace-row ${active ? "active" : ""}`}>
                  <button
                    type="button"
                    className="sidebar-workspace-btn"
                    onClick={() => onSelectWorkspace(workspace.id)}
                  >
                    <span className="sidebar-workspace-name">{workspace.name}</span>
                    <span className="sidebar-workspace-count">{workspace.paneCount}</span>
                  </button>

                  {closable ? (
                    <button
                      type="button"
                      className="sidebar-workspace-close"
                      aria-label={`Close ${workspace.name}`}
                      onClick={() => onCloseWorkspace(workspace.id)}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <footer className="sidebar-footer">
          <button
            type="button"
            className={`sidebar-section-item sidebar-settings ${activeSection === "settings" ? "active" : ""}`}
            aria-current={activeSection === "settings" ? "page" : undefined}
            onClick={() => onSelectSection("settings")}
          >
            <span className="sidebar-section-main">
              <span className="sidebar-item-icon" aria-hidden="true">
                S
              </span>
              <span>Settings</span>
            </span>
          </button>
        </footer>
      </aside>
    </>
  );
}
