import type { AppSection } from "../types";

export interface WorkspaceTabView {
  id: string;
  name: string;
  paneCount: number;
}

interface TopChromeProps {
  activeSection: AppSection;
  workspaces: WorkspaceTabView[];
  activeWorkspaceId: string | null;
  onSectionButtonClick: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onCloseWorkspace: (workspaceId: string) => void;
  onOpenWorkspaceModal: () => void;
  onOpenSettings: () => void;
}

function titleForSection(section: AppSection): string {
  switch (section) {
    case "terminal":
      return "Terminal";
    case "kanban":
      return "Kanban";
    case "agents":
      return "Agents";
    case "prompts":
      return "Prompts";
    case "settings":
      return "Settings";
    default:
      return "Terminal";
  }
}

export function TopChrome({
  activeSection,
  workspaces,
  activeWorkspaceId,
  onSectionButtonClick,
  onSelectWorkspace,
  onCloseWorkspace,
  onOpenWorkspaceModal,
  onOpenSettings,
}: TopChromeProps) {
  return (
    <header className="top-chrome">
      <div className="top-chrome-left">
        <div className="brand-dot" aria-hidden="true">
          ⚡
        </div>

        <button type="button" className="section-pill" onClick={onSectionButtonClick}>
          {titleForSection(activeSection)}
        </button>

        <div className="workspace-tabs" role="tablist" aria-label="Workspaces">
          {workspaces.map((workspace) => {
            const active = workspace.id === activeWorkspaceId;
            const closable = workspaces.length > 1;

            return (
              <div key={workspace.id} className={`workspace-tab-shell ${active ? "active" : ""}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="workspace-tab"
                  onClick={() => onSelectWorkspace(workspace.id)}
                >
                  <span className="workspace-tab-name">{workspace.name}</span>
                  <span className="workspace-tab-count">{workspace.paneCount}</span>
                </button>
                {closable ? (
                  <button
                    type="button"
                    className="workspace-tab-close"
                    aria-label={`Close ${workspace.name}`}
                    onClick={() => onCloseWorkspace(workspace.id)}
                  >
                    x
                  </button>
                ) : null}
              </div>
            );
          })}

          <button type="button" className="workspace-add" aria-label="New workspace" onClick={onOpenWorkspaceModal}>
            +
          </button>
        </div>
      </div>

      <button type="button" className="chrome-icon-btn" aria-label="Settings" onClick={onOpenSettings}>
        ⚙
      </button>
    </header>
  );
}
