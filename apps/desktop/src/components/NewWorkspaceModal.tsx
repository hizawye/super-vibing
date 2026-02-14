import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@supervibing/ui";
import { pickDirectory } from "../lib/tauri";
import type { AgentAllocation } from "../types";

export interface WorkspaceCreationInput {
  name: string;
  directory: string;
  paneCount: number;
  agentAllocation: AgentAllocation[];
}

interface NewWorkspaceModalProps {
  open: boolean;
  defaultDirectory: string;
  agentDefaults: AgentAllocation[];
  onClose: () => void;
  onSubmit: (input: WorkspaceCreationInput) => void;
}

const LAYOUT_OPTIONS = [1, 2, 4, 6, 8, 10, 12, 14, 16];

function sanitizeAgentCount(count: number): number {
  return Math.max(0, Math.min(16, count));
}

export function NewWorkspaceModal({
  open,
  defaultDirectory,
  agentDefaults,
  onClose,
  onSubmit,
}: NewWorkspaceModalProps) {
  const freshAgentDefaults = useMemo(
    () => agentDefaults.map((item) => ({ ...item })),
    [agentDefaults],
  );
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState(defaultDirectory);
  const [paneCount, setPaneCount] = useState(1);
  const [allocation, setAllocation] = useState<AgentAllocation[]>(freshAgentDefaults);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [pathPickerPending, setPathPickerPending] = useState(false);
  const [pathPickerError, setPathPickerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setName("");
    setDirectory(defaultDirectory);
    setPaneCount(1);
    setAllocation(freshAgentDefaults);
    setAgentsOpen(false);
    setPathPickerPending(false);
    setPathPickerError(null);
  }, [defaultDirectory, freshAgentDefaults, open]);

  const assignedAgents = useMemo(
    () => allocation.reduce((total, item) => total + (item.enabled ? item.count : 0), 0),
    [allocation],
  );

  const handleBrowseDirectory = async () => {
    setPathPickerError(null);
    setPathPickerPending(true);
    try {
      const preferredPath = directory.trim() || defaultDirectory.trim();
      const selected = await pickDirectory(preferredPath);
      if (selected && selected.trim().length > 0) {
        setDirectory(selected);
      }
    } catch (error) {
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message.trim()
        : "Failed to open directory picker.";
      setPathPickerError(message);
    } finally {
      setPathPickerPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        onClose();
      }
    }}
    >
      <DialogContent className="workspace-modal" aria-label="New Workspace">
        <DialogHeader className="workspace-modal-head">
          <DialogTitle>New Workspace</DialogTitle>
          <DialogDescription className="settings-caption">Create a workspace and optional agent allocation.</DialogDescription>
        </DialogHeader>

        <div className="workspace-modal-section">
          <label className="input-label" htmlFor="workspace-name">
            Name
          </label>
          <Input
            id="workspace-name"
            className="text-input"
            placeholder="Workspace"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </div>

        <div className="workspace-modal-section">
          <h3>Layout</h3>
          <div className="layout-grid">
            {LAYOUT_OPTIONS.map((count) => (
              <Button
                key={count}
                type="button"
                variant="subtle"
                className={`layout-card ${paneCount === count ? "active" : ""}`}
                onClick={() => setPaneCount(count)}
              >
                <span>{count}</span>
              </Button>
            ))}
          </div>
        </div>

        <div className="workspace-modal-section">
          <label className="input-label" htmlFor="workspace-directory">
            Directory
          </label>
          <div className="directory-row">
            <Input
              id="workspace-directory"
              className="text-input"
              placeholder="/path/to/project"
              value={directory}
              onChange={(event) => {
                setDirectory(event.currentTarget.value);
                if (pathPickerError) {
                  setPathPickerError(null);
                }
              }}
            />
            <Button
              type="button"
              variant="subtle"
              className="subtle-btn"
              disabled={pathPickerPending}
              onClick={() => void handleBrowseDirectory()}
            >
              {pathPickerPending ? "Opening..." : "Browse"}
            </Button>
            <Button
              type="button"
              variant="subtle"
              className="subtle-btn"
              onClick={() => {
                setDirectory(defaultDirectory);
                if (pathPickerError) {
                  setPathPickerError(null);
                }
              }}
            >
              Reset
            </Button>
          </div>
          {pathPickerError ? <p className="workspace-modal-error" role="alert">{pathPickerError}</p> : null}
        </div>

        <div className="workspace-modal-section">
          <Button
            type="button"
            variant="subtle"
            className="expand-toggle"
            onClick={() => setAgentsOpen((previous) => !previous)}
          >
            AI Agents <small>optional</small>
          </Button>

          {agentsOpen ? (
            <div className="agent-panel">
              <div className="agent-panel-toolbar">
                <Button
                  type="button"
                  variant="subtle"
                  className="subtle-btn"
                  onClick={() => {
                    setAllocation((current) => current.map((item) => ({ ...item, enabled: true })));
                  }}
                >
                  Select All
                </Button>
                <Button
                  type="button"
                  variant="subtle"
                  className="subtle-btn"
                  onClick={() => {
                    setAllocation((current) =>
                      current.map((item) => ({
                        ...item,
                        enabled: true,
                        count: 1,
                      })),
                    );
                  }}
                >
                  1 Each
                </Button>
                <Button
                  type="button"
                  variant="subtle"
                  className="subtle-btn"
                  onClick={() => {
                    setAllocation((current) => {
                      const total = current.length;
                      const base = Math.floor(paneCount / total);
                      const remainder = paneCount % total;
                      return current.map((item, index) => {
                        const count = base + (index < remainder ? 1 : 0);
                        return {
                          ...item,
                          enabled: count > 0,
                          count,
                        };
                      });
                    });
                  }}
                >
                  Fill Evenly
                </Button>
              </div>

              <div className="agent-list">
                {allocation.map((agent) => (
                  <div key={agent.profile} className="agent-row">
                    <label className="agent-toggle">
                      <Checkbox
                        checked={agent.enabled}
                        onCheckedChange={(checked) => {
                          const isChecked = checked === true;
                          setAllocation((current) =>
                            current.map((item) =>
                              item.profile === agent.profile
                                ? {
                                    ...item,
                                    enabled: isChecked,
                                    count: isChecked && item.count === 0 ? 1 : item.count,
                                  }
                                : item,
                            ),
                          );
                        }}
                      />
                      <span>{agent.label}</span>
                    </label>

                    <div className="count-stepper">
                      <Button
                        type="button"
                        variant="subtle"
                        className="stepper-btn"
                        onClick={() => {
                          setAllocation((current) =>
                            current.map((item) =>
                              item.profile === agent.profile
                                ? {
                                    ...item,
                                    enabled: true,
                                    count: sanitizeAgentCount(item.count - 1),
                                  }
                                : item,
                            ),
                          );
                        }}
                      >
                        -
                      </Button>
                      <span>{agent.count}</span>
                      <Button
                        type="button"
                        variant="subtle"
                        className="stepper-btn"
                        onClick={() => {
                          setAllocation((current) =>
                            current.map((item) =>
                              item.profile === agent.profile
                                ? {
                                    ...item,
                                    enabled: true,
                                    count: sanitizeAgentCount(item.count + 1),
                                  }
                                : item,
                            ),
                          );
                        }}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <p className="agent-caption">{assignedAgents} agent sessions assigned across {paneCount} panes.</p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="workspace-modal-actions">
          <Button type="button" variant="subtle" className="subtle-btn" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            className="primary-btn"
            onClick={() => {
              onSubmit({
                name: name.trim() || "",
                directory: directory.trim() || defaultDirectory,
                paneCount,
                agentAllocation: allocation,
              });
              onClose();
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
