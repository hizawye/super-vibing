import { useEffect, useMemo, useState } from "react";
import { getAgentDefaults } from "../store/workspace";
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
  onClose: () => void;
  onSubmit: (input: WorkspaceCreationInput) => void;
}

const LAYOUT_OPTIONS = [1, 2, 4, 6, 8, 10, 12, 14, 16];

function sanitizeAgentCount(count: number): number {
  return Math.max(0, Math.min(16, count));
}

export function NewWorkspaceModal({ open, defaultDirectory, onClose, onSubmit }: NewWorkspaceModalProps) {
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState(defaultDirectory);
  const [paneCount, setPaneCount] = useState(1);
  const [allocation, setAllocation] = useState<AgentAllocation[]>(() => getAgentDefaults());
  const [agentsOpen, setAgentsOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setName("");
    setDirectory(defaultDirectory);
    setPaneCount(1);
    setAllocation(getAgentDefaults());
    setAgentsOpen(false);
  }, [defaultDirectory, open]);

  const assignedAgents = useMemo(
    () => allocation.reduce((total, item) => total + (item.enabled ? item.count : 0), 0),
    [allocation],
  );

  if (!open) {
    return null;
  }

  return (
    <div className="workspace-modal-overlay" role="presentation" onClick={onClose}>
      <div className="workspace-modal" role="dialog" aria-label="New Workspace" onClick={(event) => event.stopPropagation()}>
        <div className="workspace-modal-head">
          <h2>New Workspace</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            x
          </button>
        </div>

        <div className="workspace-modal-section">
          <label className="input-label" htmlFor="workspace-name">
            Name
          </label>
          <input
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
              <button
                key={count}
                type="button"
                className={`layout-card ${paneCount === count ? "active" : ""}`}
                onClick={() => setPaneCount(count)}
              >
                <span>{count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="workspace-modal-section">
          <label className="input-label" htmlFor="workspace-directory">
            Directory
          </label>
          <div className="directory-row">
            <input
              id="workspace-directory"
              className="text-input"
              placeholder="/path/to/project"
              value={directory}
              onChange={(event) => setDirectory(event.currentTarget.value)}
            />
            <button type="button" className="subtle-btn" onClick={() => setDirectory(defaultDirectory)}>
              Reset
            </button>
          </div>
        </div>

        <div className="workspace-modal-section">
          <button
            type="button"
            className="expand-toggle"
            onClick={() => setAgentsOpen((previous) => !previous)}
          >
            AI Agents <small>optional</small>
          </button>

          {agentsOpen ? (
            <div className="agent-panel">
              <div className="agent-panel-toolbar">
                <button
                  type="button"
                  className="subtle-btn"
                  onClick={() => {
                    setAllocation((current) => current.map((item) => ({ ...item, enabled: true })));
                  }}
                >
                  Select All
                </button>
                <button
                  type="button"
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
                </button>
                <button
                  type="button"
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
                </button>
              </div>

              <div className="agent-list">
                {allocation.map((agent) => (
                  <div key={agent.profile} className="agent-row">
                    <label className="agent-toggle">
                      <input
                        type="checkbox"
                        checked={agent.enabled}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setAllocation((current) =>
                            current.map((item) =>
                              item.profile === agent.profile
                                ? {
                                    ...item,
                                    enabled: checked,
                                    count: checked && item.count === 0 ? 1 : item.count,
                                  }
                                : item,
                            ),
                          );
                        }}
                      />
                      <span>{agent.label}</span>
                    </label>

                    <div className="count-stepper">
                      <button
                        type="button"
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
                      </button>
                      <span>{agent.count}</span>
                      <button
                        type="button"
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
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <p className="agent-caption">{assignedAgents} agent sessions assigned across {paneCount} panes.</p>
            </div>
          ) : null}
        </div>

        <div className="workspace-modal-actions">
          <button type="button" className="subtle-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
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
          </button>
        </div>
      </div>
    </div>
  );
}
