import { useEffect, useMemo, useState } from "react";
import { PaneGrid } from "./components/PaneGrid";
import { CommandPalette } from "./components/CommandPalette";
import { useWorkspaceStore } from "./store/workspace";

function App() {
  const initialized = useWorkspaceStore((state) => state.initialized);
  const bootstrapping = useWorkspaceStore((state) => state.bootstrapping);
  const paneCount = useWorkspaceStore((state) => state.paneCount);
  const paneOrder = useWorkspaceStore((state) => state.paneOrder);
  const layouts = useWorkspaceStore((state) => state.layouts);
  const zoomedPaneId = useWorkspaceStore((state) => state.zoomedPaneId);
  const echoInput = useWorkspaceStore((state) => state.echoInput);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const snapshots = useWorkspaceStore((state) => state.snapshots);
  const blueprints = useWorkspaceStore((state) => state.blueprints);
  const paletteOpen = useWorkspaceStore((state) => state.paletteOpen);

  const bootstrap = useWorkspaceStore((state) => state.bootstrap);
  const setPaneCount = useWorkspaceStore((state) => state.setPaneCount);
  const setLayouts = useWorkspaceStore((state) => state.setLayouts);
  const toggleZoom = useWorkspaceStore((state) => state.toggleZoom);
  const setEchoInput = useWorkspaceStore((state) => state.setEchoInput);
  const createWorktree = useWorkspaceStore((state) => state.createWorktree);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const setPaletteOpen = useWorkspaceStore((state) => state.setPaletteOpen);
  const saveSnapshot = useWorkspaceStore((state) => state.saveSnapshot);
  const restoreSnapshot = useWorkspaceStore((state) => state.restoreSnapshot);
  const createBlueprint = useWorkspaceStore((state) => state.createBlueprint);
  const launchBlueprint = useWorkspaceStore((state) => state.launchBlueprint);

  const [repoRootInput, setRepoRootInput] = useState("");
  const [branchInput, setBranchInput] = useState("");
  const [baseBranchInput, setBaseBranchInput] = useState("main");

  const [snapshotName, setSnapshotName] = useState("");
  const [blueprintName, setBlueprintName] = useState("");
  const [blueprintPathsInput, setBlueprintPathsInput] = useState("");
  const [blueprintAutorunInput, setBlueprintAutorunInput] = useState("");

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isPaletteShortcut) {
        return;
      }

      event.preventDefault();
      setPaletteOpen(!useWorkspaceStore.getState().paletteOpen);
    };

    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [setPaletteOpen]);

  if (!initialized || bootstrapping) {
    return (
      <main className="app-shell app-loading">
        <p>Bootstrapping workspace...</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <h1>SuperVibing</h1>
          <p>
            Branch: <strong>{activeWorkspace?.branch ?? "unknown"}</strong> | Worktree: {" "}
            <code>{activeWorkspace?.worktreePath ?? "n/a"}</code>
          </p>
        </div>

        <div className="toolbar-row">
          <label className="toolbar-label" htmlFor="pane-count">
            Panes ({paneCount})
          </label>
          <input
            id="pane-count"
            type="range"
            min={1}
            max={16}
            value={paneCount}
            onChange={(event) => {
              void setPaneCount(Number(event.currentTarget.value));
            }}
          />
          <label className="check-label">
            <input
              type="checkbox"
              checked={echoInput}
              onChange={(event) => setEchoInput(event.currentTarget.checked)}
            />
            Echo Input
          </label>
          <button type="button" className="toolbar-btn" onClick={() => setPaletteOpen(true)}>
            Cmd/Ctrl+K
          </button>
        </div>
      </header>

      <section className="control-grid">
        <div className="panel">
          <h2>Worktree Manager</h2>
          <div className="field-grid">
            <input
              className="text-input"
              placeholder="Repo root"
              value={repoRootInput}
              onChange={(event) => setRepoRootInput(event.currentTarget.value)}
            />
            <input
              className="text-input"
              placeholder="Branch"
              value={branchInput}
              onChange={(event) => setBranchInput(event.currentTarget.value)}
            />
            <input
              className="text-input"
              placeholder="Base branch (optional)"
              value={baseBranchInput}
              onChange={(event) => setBaseBranchInput(event.currentTarget.value)}
            />
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => {
                void createWorktree(repoRootInput, branchInput, baseBranchInput || undefined);
                setBranchInput("");
              }}
            >
              Create Worktree
            </button>
          </div>
          <div className="chips-row">
            {workspaces.map((workspace) => (
              <button
                type="button"
                key={workspace.id}
                className={`chip ${workspace.id === activeWorkspaceId ? "active" : ""}`}
                onClick={() => {
                  void setActiveWorkspace(workspace.id);
                }}
              >
                {workspace.branch}
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Snapshots</h2>
          <div className="field-grid">
            <input
              className="text-input"
              placeholder="Snapshot name"
              value={snapshotName}
              onChange={(event) => setSnapshotName(event.currentTarget.value)}
            />
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => {
                const fallbackName = `Snapshot ${new Date().toLocaleString()}`;
                void saveSnapshot(snapshotName.trim() || fallbackName);
                setSnapshotName("");
              }}
            >
              Save Snapshot
            </button>
          </div>
          <div className="chips-row">
            {snapshots.slice(0, 8).map((snapshot) => (
              <button
                type="button"
                key={snapshot.id}
                className="chip"
                onClick={() => {
                  void restoreSnapshot(snapshot.id);
                }}
              >
                {snapshot.name}
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Quick Launch Blueprints</h2>
          <div className="field-grid">
            <input
              className="text-input"
              placeholder="Blueprint name"
              value={blueprintName}
              onChange={(event) => setBlueprintName(event.currentTarget.value)}
            />
            <input
              className="text-input"
              placeholder="Paths (comma-separated)"
              value={blueprintPathsInput}
              onChange={(event) => setBlueprintPathsInput(event.currentTarget.value)}
            />
            <input
              className="text-input"
              placeholder="Autorun commands (comma-separated)"
              value={blueprintAutorunInput}
              onChange={(event) => setBlueprintAutorunInput(event.currentTarget.value)}
            />
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => {
                const paths = blueprintPathsInput
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean);
                const commands = blueprintAutorunInput
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean);
                void createBlueprint(blueprintName.trim() || "Blueprint", paths, commands);
              }}
            >
              Save Blueprint
            </button>
          </div>
          <div className="chips-row">
            {blueprints.slice(0, 8).map((blueprint) => (
              <button
                type="button"
                key={blueprint.id}
                className="chip"
                onClick={() => {
                  void launchBlueprint(blueprint.id);
                }}
              >
                {blueprint.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid-shell">
        <PaneGrid
          paneIds={paneOrder}
          layouts={layouts}
          zoomedPaneId={zoomedPaneId}
          onLayoutsChange={(next) => setLayouts(next)}
          onToggleZoom={toggleZoom}
        />
      </section>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </main>
  );
}

export default App;
