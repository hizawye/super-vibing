import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/workspace";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [globalCommand, setGlobalCommand] = useState("");
  const [execute, setExecute] = useState(true);

  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const snapshots = useWorkspaceStore((state) => state.snapshots);
  const runCommand = useWorkspaceStore((state) => state.runGlobalCommand);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const restoreSnapshot = useWorkspaceStore((state) => state.restoreSnapshot);

  const filteredWorkspaces = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return workspaces;
    }
    return workspaces.filter(
      (workspace) =>
        workspace.branch.toLowerCase().includes(normalized) ||
        workspace.worktreePath.toLowerCase().includes(normalized),
    );
  }, [query, workspaces]);

  if (!open) {
    return null;
  }

  return (
    <div className="palette-overlay" role="presentation" onClick={onClose}>
      <div className="palette-modal" role="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="palette-section">
          <h2>Command Palette</h2>
          <input
            className="text-input"
            placeholder="Filter workspaces"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>

        <div className="palette-section">
          <h3>Jump to Workspace</h3>
          <div className="palette-list">
            {filteredWorkspaces.map((workspace) => (
              <button
                type="button"
                key={workspace.id}
                className={`palette-item ${workspace.id === activeWorkspaceId ? "active" : ""}`}
                onClick={() => {
                  void setActiveWorkspace(workspace.id);
                  onClose();
                }}
              >
                <span>{workspace.branch}</span>
                <small>{workspace.worktreePath}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="palette-section">
          <h3>Restore Snapshot</h3>
          <div className="palette-list">
            {snapshots.slice(0, 8).map((snapshot) => (
              <button
                type="button"
                key={snapshot.id}
                className="palette-item"
                onClick={() => {
                  void restoreSnapshot(snapshot.id);
                  onClose();
                }}
              >
                <span>{snapshot.name}</span>
                <small>{new Date(snapshot.createdAt).toLocaleString()}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="palette-section">
          <h3>Global Command</h3>
          <div className="palette-inline">
            <input
              className="text-input"
              placeholder="npm test"
              value={globalCommand}
              onChange={(event) => setGlobalCommand(event.currentTarget.value)}
            />
            <label className="check-label">
              <input
                type="checkbox"
                checked={execute}
                onChange={(event) => setExecute(event.currentTarget.checked)}
              />
              Enter
            </label>
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => {
                void runCommand(globalCommand, execute);
                onClose();
              }}
            >
              Run
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
