import { useMemo, useState } from "react";
import { Button, Checkbox, Input, ScrollArea } from "@supervibing/ui";
import type { WorktreeCreateMode, WorktreeEntry } from "../types";

interface WorktreeManagerSectionProps {
  repoRoot: string | null;
  loading: boolean;
  error: string | null;
  entries: WorktreeEntry[];
  lastLoadedAt: string | null;
  lastActionMessage: string | null;
  onRefresh: () => Promise<void>;
  onCreate: (input: {
    mode: WorktreeCreateMode;
    branch: string;
    baseRef?: string;
    openAfterCreate?: boolean;
  }) => Promise<void>;
  onImport: (worktreePath: string) => Promise<void>;
  onRemove: (input: { worktreePath: string; force: boolean; deleteBranch: boolean }) => Promise<void>;
  onPrune: (dryRun: boolean) => Promise<void>;
  isWorktreeOpen: (worktreePath: string) => boolean;
}

export function WorktreeManagerSection({
  repoRoot,
  loading,
  error,
  entries,
  lastLoadedAt,
  lastActionMessage,
  onRefresh,
  onCreate,
  onImport,
  onRemove,
  onPrune,
  isWorktreeOpen,
}: WorktreeManagerSectionProps) {
  const [mode, setMode] = useState<WorktreeCreateMode>("newBranch");
  const [branch, setBranch] = useState("");
  const [baseRef, setBaseRef] = useState("HEAD");
  const [openAfterCreate, setOpenAfterCreate] = useState(true);
  const [pendingRemovePath, setPendingRemovePath] = useState<string | null>(null);
  const [removeForce, setRemoveForce] = useState(false);
  const [removeDeleteBranch, setRemoveDeleteBranch] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.worktreePath.localeCompare(b.worktreePath)),
    [entries],
  );

  const run = async (key: string, task: () => Promise<void>) => {
    setActionError(null);
    setWorking(key);
    try {
      await task();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setWorking((current) => (current === key ? null : current));
    }
  };

  return (
    <section className="section-surface section-surface--headed">
      <header className="section-head">
        <h2>Worktree Manager</h2>
        <p>Manage git worktrees for the active repository without auto-opening all tabs.</p>
      </header>

      <div className="settings-shell worktree-shell">
        <section className="settings-block worktree-block">
          <div className="worktree-toolbar">
            <div>
              <h3>Repository Scope</h3>
              <p className="settings-caption">{repoRoot ?? "No git repository detected for active workspace."}</p>
              {lastLoadedAt ? <small className="settings-caption">Last sync: {new Date(lastLoadedAt).toLocaleString()}</small> : null}
            </div>
            <div className="worktree-toolbar-actions">
              <Button type="button" variant="subtle" onClick={() => void run("refresh", onRefresh)} disabled={working !== null}>
                Refresh
              </Button>
              <Button type="button" variant="subtle" onClick={() => void run("prune-dry", async () => onPrune(true))} disabled={working !== null || !repoRoot}>
                Prune (Dry Run)
              </Button>
              <Button type="button" variant="subtle" onClick={() => void run("prune", async () => onPrune(false))} disabled={working !== null || !repoRoot}>
                Prune
              </Button>
            </div>
          </div>
          {lastActionMessage ? <p className="worktree-message">{lastActionMessage}</p> : null}
          {error ? <p className="worktree-error">{error}</p> : null}
          {actionError ? <p className="worktree-error">{actionError}</p> : null}
        </section>

        <section className="settings-block worktree-block">
          <h3>Create Worktree</h3>
          <div className="worktree-create-grid">
            <div className="density-toggle" role="group" aria-label="Create mode">
              <Button
                type="button"
                variant="subtle"
                className={`layout-mode-btn ${mode === "newBranch" ? "active" : ""}`}
                onClick={() => setMode("newBranch")}
              >
                New Branch
              </Button>
              <Button
                type="button"
                variant="subtle"
                className={`layout-mode-btn ${mode === "existingBranch" ? "active" : ""}`}
                onClick={() => setMode("existingBranch")}
              >
                Existing Branch
              </Button>
            </div>

            <label className="input-label" htmlFor="worktree-branch-input">Branch</label>
            <Input
              id="worktree-branch-input"
              className="text-input"
              placeholder="feature/my-task"
              value={branch}
              onChange={(event) => setBranch(event.currentTarget.value)}
            />

            {mode === "newBranch" ? (
              <>
                <label className="input-label" htmlFor="worktree-base-ref">Base Ref</label>
                <Input
                  id="worktree-base-ref"
                  className="text-input"
                  placeholder="HEAD"
                  value={baseRef}
                  onChange={(event) => setBaseRef(event.currentTarget.value)}
                />
              </>
            ) : null}

            <label className="check-label">
              <Checkbox
                checked={openAfterCreate}
                onCheckedChange={(checked) => setOpenAfterCreate(checked === true)}
              />
              Open workspace after create
            </label>

            <Button
              type="button"
              variant="primary"
              disabled={working !== null || !repoRoot || branch.trim().length === 0}
              onClick={() =>
                void run("create", async () => {
                  await onCreate({
                    mode,
                    branch: branch.trim(),
                    baseRef: mode === "newBranch" ? baseRef.trim() || "HEAD" : undefined,
                    openAfterCreate,
                  });
                  setBranch("");
                })
              }
            >
              Create Worktree
            </Button>
          </div>
        </section>

        <section className="settings-block worktree-block">
          <h3>Discovered Worktrees</h3>
          {loading ? <p className="settings-caption">Loading worktrees...</p> : null}
          {!loading && sortedEntries.length === 0 ? <p className="settings-caption">No worktrees found for this repository.</p> : null}

          <ScrollArea className="worktree-list">
            {sortedEntries.map((entry) => {
              const isOpen = isWorktreeOpen(entry.worktreePath);
              const removePending = pendingRemovePath === entry.worktreePath;
              const removeDisabled = entry.isMainWorktree;

              return (
                <div key={entry.worktreePath} className="worktree-row">
                  <div className="worktree-meta">
                    <strong>{entry.branch}</strong>
                    <small>{entry.worktreePath}</small>
                    <div className="worktree-tags">
                      {entry.isMainWorktree ? <span className="top-workspace-pill">main</span> : null}
                      {entry.isDetached ? <span className="top-workspace-pill">detached</span> : null}
                      {entry.isLocked ? <span className="top-workspace-pill">locked</span> : null}
                      {entry.isPrunable ? <span className="top-workspace-pill">prunable</span> : null}
                      {entry.isDirty ? <span className="top-workspace-pill">dirty</span> : null}
                      {isOpen ? <span className="top-workspace-pill">open</span> : null}
                    </div>
                  </div>

                  <div className="worktree-row-actions">
                    <Button
                      type="button"
                      variant="subtle"
                      disabled={working !== null}
                      onClick={() => void run(`open:${entry.worktreePath}`, async () => onImport(entry.worktreePath))}
                    >
                      {isOpen ? "Switch" : "Open"}
                    </Button>
                    <Button
                      type="button"
                      variant="subtle"
                      disabled={working !== null || removeDisabled}
                      onClick={() => {
                        setPendingRemovePath((current) => (current === entry.worktreePath ? null : entry.worktreePath));
                        setRemoveForce(false);
                        setRemoveDeleteBranch(false);
                      }}
                    >
                      Remove
                    </Button>
                  </div>

                  {removePending ? (
                    <div className="worktree-remove-confirm">
                      <label className="check-label">
                        <Checkbox
                          checked={removeForce}
                          onCheckedChange={(checked) => setRemoveForce(checked === true)}
                        />
                        Force remove if dirty
                      </label>
                      <label className="check-label">
                        <Checkbox
                          checked={removeDeleteBranch}
                          onCheckedChange={(checked) => setRemoveDeleteBranch(checked === true)}
                        />
                        Delete branch after remove
                      </label>
                      <div className="worktree-remove-actions">
                        <Button type="button" variant="subtle" onClick={() => setPendingRemovePath(null)}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="primary"
                          onClick={() =>
                            void run(`remove:${entry.worktreePath}`, async () => {
                              await onRemove({
                                worktreePath: entry.worktreePath,
                                force: removeForce,
                                deleteBranch: removeDeleteBranch,
                              });
                              setPendingRemovePath(null);
                            })
                          }
                        >
                          Confirm Remove
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </ScrollArea>
        </section>
      </div>
    </section>
  );
}
