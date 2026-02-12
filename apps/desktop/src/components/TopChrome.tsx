import type { ReactNode } from "react";
import type { AppSection } from "../types";

interface TopChromeProps {
  activeSection: AppSection;
  activeWorkspaceName: string | null;
  onToggleSidebar: () => void;
  onOpenCommandPalette: () => void;
  terminalTitle?: string | null;
  terminalSubtitle?: ReactNode;
  terminalControls?: ReactNode;
}

function titleForSection(section: AppSection): string {
  switch (section) {
    case "terminal":
      return "Terminal";
    case "worktrees":
      return "Worktrees";
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

function subtitleForSection(section: AppSection, workspaceName: string | null): string {
  if (section === "terminal") {
    return workspaceName ? `Active workspace: ${workspaceName}` : "No workspace active";
  }

  if (section === "settings") {
    return "Appearance, accessibility, and shortcuts";
  }

  if (section === "worktrees") {
    return "Create, import, and clean up git worktrees";
  }

  return "Coming soon";
}

export function TopChrome({
  activeSection,
  activeWorkspaceName,
  onToggleSidebar,
  onOpenCommandPalette,
  terminalTitle,
  terminalSubtitle,
  terminalControls,
}: TopChromeProps) {
  const workspaceLabel = activeWorkspaceName ?? "No workspace";
  const hasTerminalControls = activeSection === "terminal" && Boolean(terminalControls);
  const fallbackSubtitle = subtitleForSection(activeSection, activeWorkspaceName);
  const terminalTitleText = terminalTitle ?? workspaceLabel;
  const showCommandPalette = !hasTerminalControls;

  return (
    <header className={`top-chrome ${hasTerminalControls ? "top-chrome-terminal top-chrome-minimal" : ""}`}>
      <div className="top-chrome-row">
        <div className="top-chrome-left">
          <button type="button" className="mobile-nav-toggle" aria-label="Open navigation" onClick={onToggleSidebar}>
            <span aria-hidden="true">☰</span>
          </button>

          <div className="top-chrome-context">
            {hasTerminalControls ? (
              <h1 className="top-terminal-title">
                <span className="top-terminal-name">{terminalTitleText}</span>
              </h1>
            ) : (
              <>
                <h1>
                  <span>{titleForSection(activeSection)}</span>
                  <span className="top-section-dot" aria-hidden="true" />
                  <span className="top-workspace-pill">{workspaceLabel}</span>
                </h1>
                <p>{fallbackSubtitle}</p>
              </>
            )}
          </div>
        </div>

        {hasTerminalControls ? <div className="top-chrome-controls">{terminalControls}</div> : null}

        {showCommandPalette ? (
          <button
            type="button"
            className="top-command-btn"
            aria-label="Open command palette"
            onClick={onOpenCommandPalette}
          >
            <span>Command Palette</span>
            <kbd>Ctrl/Cmd + P</kbd>
          </button>
        ) : null}
      </div>

      {!hasTerminalControls && terminalSubtitle ? (
        <div className="top-chrome-subtitle">{terminalSubtitle}</div>
      ) : null}
    </header>
  );
}
