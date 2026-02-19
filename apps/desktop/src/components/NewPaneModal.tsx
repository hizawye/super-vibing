import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
} from "@supervibing/ui";
import type { WorktreeEntry } from "../types";

export interface PaneWorktreeModalSubmitInput {
  mode: "existing" | "create";
  worktreePath: string;
  branch: string;
  baseRef: string;
}

interface NewPaneModalProps {
  open: boolean;
  mode: "create" | "reassign";
  repoRoot: string | null;
  entries: WorktreeEntry[];
  loading: boolean;
  error: string | null;
  initialWorktreePath: string;
  paneId: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSubmit: (input: PaneWorktreeModalSubmitInput) => Promise<void> | void;
}

type SelectionMode = "existing" | "create";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function NewPaneModal({
  open,
  mode,
  repoRoot,
  entries,
  loading,
  error,
  initialWorktreePath,
  paneId,
  onClose,
  onRefresh,
  onSubmit,
}: NewPaneModalProps) {
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("existing");
  const [query, setQuery] = useState("");
  const [selectedWorktreePath, setSelectedWorktreePath] = useState(initialWorktreePath);
  const [branch, setBranch] = useState("");
  const [baseRef, setBaseRef] = useState("HEAD");
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.worktreePath.localeCompare(b.worktreePath)),
    [entries],
  );

  const filteredEntries = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return sortedEntries;
    }

    return sortedEntries.filter((entry) =>
      `${entry.branch} ${entry.worktreePath}`.toLowerCase().includes(search));
  }, [query, sortedEntries]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectionMode("existing");
    setQuery("");
    setBranch("");
    setBaseRef("HEAD");
    setActionError(null);
    setWorking(false);
    setSelectedWorktreePath(initialWorktreePath);
    void onRefresh();
  }, [initialWorktreePath, onRefresh, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const hasSelection = sortedEntries.some(
      (entry) => normalizePath(entry.worktreePath) === normalizePath(selectedWorktreePath),
    );
    if (hasSelection) {
      return;
    }

    const fallback = sortedEntries[0]?.worktreePath ?? initialWorktreePath;
    setSelectedWorktreePath(fallback);
  }, [initialWorktreePath, open, selectedWorktreePath, sortedEntries]);

  const canSubmitExisting = selectedWorktreePath.trim().length > 0;
  const canSubmitCreate = branch.trim().length > 0 && Boolean(repoRoot);
  const submitDisabled = working || (selectionMode === "existing" ? !canSubmitExisting : !canSubmitCreate);
  const title = mode === "reassign" ? "Change Pane Worktree" : "Create Worktree Pane";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        onClose();
      }
    }}
    >
      <DialogContent className="workspace-modal pane-worktree-modal" aria-label={title}>
        <DialogHeader className="workspace-modal-head">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="settings-caption">Choose an existing worktree or create a branch worktree.</DialogDescription>
        </DialogHeader>

        <div className="workspace-modal-section">
          <div className="worktree-toolbar">
            <div>
              <h3>Repository Scope</h3>
              <p className="settings-caption">{repoRoot ?? "No git repository detected for active workspace."}</p>
              {paneId ? <p className="settings-caption">Target pane: {paneId}</p> : null}
            </div>
            <div className="worktree-toolbar-actions">
              <Button
                type="button"
                variant="subtle"
                onClick={() => {
                  void onRefresh();
                }}
                disabled={working || loading}
              >
                Refresh
              </Button>
            </div>
          </div>
          {error ? <p className="worktree-error">{error}</p> : null}
          {actionError ? <p className="worktree-error">{actionError}</p> : null}
        </div>

        <div className="workspace-modal-section">
          <h3>Worktree Source</h3>
          <div className="density-toggle" role="group" aria-label="Worktree source">
            <Button
              type="button"
              variant="subtle"
              className={`layout-mode-btn ${selectionMode === "existing" ? "active" : ""}`}
              onClick={() => setSelectionMode("existing")}
            >
              Existing Worktree
            </Button>
            <Button
              type="button"
              variant="subtle"
              className={`layout-mode-btn ${selectionMode === "create" ? "active" : ""}`}
              onClick={() => setSelectionMode("create")}
              disabled={!repoRoot}
            >
              Create Branch Worktree
            </Button>
          </div>

          {selectionMode === "existing" ? (
            <>
              <Input
                className="text-input"
                placeholder="Search branch or path"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <ScrollArea className="pane-worktree-list" role="listbox" aria-label="Available worktrees">
                {loading ? <p className="settings-caption">Loading worktrees...</p> : null}
                {!loading && filteredEntries.length === 0 ? (
                  <p className="settings-caption">No worktrees available.</p>
                ) : null}
                {filteredEntries.map((entry) => {
                  const active = normalizePath(entry.worktreePath) === normalizePath(selectedWorktreePath);
                  return (
                    <Button
                      key={entry.worktreePath}
                      type="button"
                      role="option"
                      aria-selected={active}
                      variant="subtle"
                      className={`pane-worktree-option ${active ? "active" : ""}`}
                      onClick={() => setSelectedWorktreePath(entry.worktreePath)}
                    >
                      <span>{entry.branch}</span>
                      <small>{entry.worktreePath}</small>
                    </Button>
                  );
                })}
              </ScrollArea>
            </>
          ) : (
            <div className="worktree-create-grid">
              <label className="input-label" htmlFor="pane-worktree-branch">Branch</label>
              <Input
                id="pane-worktree-branch"
                className="text-input"
                placeholder="feature/my-pane"
                value={branch}
                onChange={(event) => setBranch(event.currentTarget.value)}
              />

              <label className="input-label" htmlFor="pane-worktree-base-ref">Base Ref</label>
              <Input
                id="pane-worktree-base-ref"
                className="text-input"
                placeholder="HEAD"
                value={baseRef}
                onChange={(event) => setBaseRef(event.currentTarget.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter className="workspace-modal-actions">
          <Button type="button" variant="subtle" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={submitDisabled}
            onClick={() => {
              setActionError(null);
              setWorking(true);
              void Promise.resolve(
                onSubmit({
                  mode: selectionMode,
                  worktreePath: selectedWorktreePath,
                  branch: branch.trim(),
                  baseRef: baseRef.trim() || "HEAD",
                }),
              ).then(() => {
                setWorking(false);
              }).catch((submitError) => {
                setActionError(String(submitError));
                setWorking(false);
              });
            }}
          >
            {mode === "reassign" ? "Apply Worktree" : "Create Pane"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
