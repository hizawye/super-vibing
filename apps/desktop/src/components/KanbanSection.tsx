import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Checkbox, Input, Textarea } from "@supervibing/ui";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "../store/workspace";
import type { KanbanRunCompletionStatus, KanbanTask, KanbanTaskStatus } from "../types";

const KANBAN_COLUMNS: Array<{ status: KanbanTaskStatus; title: string }> = [
  { status: "todo", title: "Todo" },
  { status: "in_progress", title: "In Progress" },
  { status: "review", title: "Review" },
  { status: "done", title: "Done" },
];

function nextKanbanStatus(current: KanbanTaskStatus, delta: -1 | 1): KanbanTaskStatus | null {
  const index = KANBAN_COLUMNS.findIndex((column) => column.status === current);
  if (index < 0) {
    return null;
  }
  const next = KANBAN_COLUMNS[index + delta];
  return next?.status ?? null;
}

function runStatusBadgeLabel(status: string): string {
  switch (status) {
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return status;
  }
}

export function KanbanSection() {
  const { tasks, runs, runLogs, workspaces, activeWorkspaceId } = useWorkspaceStore(
    useShallow((state) => ({
      tasks: state.kanbanTasks,
      runs: state.kanbanRuns,
      runLogs: state.kanbanRunLogs,
      workspaces: state.workspaces,
      activeWorkspaceId: state.activeWorkspaceId,
    })),
  );

  const createKanbanTask = useWorkspaceStore((state) => state.createKanbanTask);
  const moveKanbanTask = useWorkspaceStore((state) => state.moveKanbanTask);
  const startKanbanTaskRun = useWorkspaceStore((state) => state.startKanbanTaskRun);
  const completeKanbanRun = useWorkspaceStore((state) => state.completeKanbanRun);
  const markKanbanTaskDone = useWorkspaceStore((state) => state.markKanbanTaskDone);
  const refreshKanbanRunLogs = useWorkspaceStore((state) => state.refreshKanbanRunLogs);

  const defaultWorkspaceId = useMemo(
    () => activeWorkspaceId ?? workspaces[0]?.id ?? "",
    [activeWorkspaceId, workspaces],
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [command, setCommand] = useState("");
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId);
  const paneOptions = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId)?.paneOrder ?? [],
    [workspaceId, workspaces],
  );
  const [paneId, setPaneId] = useState<string>(paneOptions[0] ?? "");
  const [createBranch, setCreateBranch] = useState(false);
  const [createWorktree, setCreateWorktree] = useState(false);
  const [openAfterCreate, setOpenAfterCreate] = useState(true);
  const [branchName, setBranchName] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId && defaultWorkspaceId) {
      setWorkspaceId(defaultWorkspaceId);
    }
  }, [defaultWorkspaceId, workspaceId]);

  useEffect(() => {
    const firstPane = paneOptions[0] ?? "";
    if (!paneOptions.includes(paneId)) {
      setPaneId(firstPane);
    }
  }, [paneId, paneOptions]);

  const runsById = useMemo(
    () => Object.fromEntries(runs.map((run) => [run.id, run])),
    [runs],
  );
  const runningRunByTaskId = useMemo(() => {
    const entries = runs
      .filter((run) => run.status === "running")
      .map((run) => [run.taskId, run.id]);
    return Object.fromEntries(entries);
  }, [runs]);

  const tasksByColumn = useMemo(
    () =>
      KANBAN_COLUMNS.map((column) => ({
        ...column,
        tasks: tasks.filter((task) => task.status === column.status),
      })),
    [tasks],
  );

  async function handleCreateTask(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const preRun = createBranch || createWorktree
        ? {
          createBranch,
          branchName: branchName.trim(),
          baseRef: baseRef.trim() || undefined,
          createWorktree,
          openAfterCreate,
        }
        : null;
      await createKanbanTask({
        title,
        description,
        command,
        workspaceId,
        paneId,
        preRun,
      });
      setTitle("");
      setDescription("");
      setCommand("");
      setCreateBranch(false);
      setCreateWorktree(false);
      setOpenAfterCreate(true);
      setBranchName("");
      setBaseRef("");
    } catch (taskError) {
      setError(String(taskError));
    } finally {
      setSubmitting(false);
    }
  }

  async function completeRun(runId: string, status: KanbanRunCompletionStatus): Promise<void> {
    setError(null);
    try {
      await completeKanbanRun(runId, status);
    } catch (runError) {
      setError(String(runError));
    }
  }

  function taskLocation(task: KanbanTask): string {
    const workspace = workspaces.find((item) => item.id === task.workspaceId);
    if (!workspace) {
      return `${task.workspaceId} · ${task.paneId}`;
    }
    const paneTitle = workspace.panes[task.paneId]?.title ?? task.paneId;
    return `${workspace.name} · ${paneTitle}`;
  }

  return (
    <section className="section-surface section-surface--body kanban-shell">
      <header className="kanban-head">
        <div>
          <h2>Kanban</h2>
          <p>Queue tasks per pane, run commands, and stream run logs while agents work.</p>
        </div>
      </header>

      <section className="kanban-create">
        <div className="kanban-create-grid">
          <label className="kanban-field">
            <span className="input-label">Task title</span>
            <Input className="text-input" value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
          </label>
          <label className="kanban-field">
            <span className="input-label">Workspace</span>
            <select className="text-input" value={workspaceId} onChange={(event) => setWorkspaceId(event.currentTarget.value)}>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
          </label>
          <label className="kanban-field">
            <span className="input-label">Pane</span>
            <select className="text-input" value={paneId} onChange={(event) => setPaneId(event.currentTarget.value)}>
              {paneOptions.map((paneKey) => (
                <option key={paneKey} value={paneKey}>{paneKey}</option>
              ))}
            </select>
          </label>
          <label className="kanban-field kanban-field-full">
            <span className="input-label">Command</span>
            <Input className="text-input" value={command} onChange={(event) => setCommand(event.currentTarget.value)} />
          </label>
          <label className="kanban-field kanban-field-full">
            <span className="input-label">Description</span>
            <Textarea
              className="text-input"
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              rows={2}
            />
          </label>
        </div>

        <div className="kanban-pre-run">
          <label className="check-label">
            <Checkbox checked={createBranch} onCheckedChange={(value) => setCreateBranch(Boolean(value))} />
            Create/switch branch before run
          </label>
          <label className="check-label">
            <Checkbox checked={createWorktree} onCheckedChange={(value) => setCreateWorktree(Boolean(value))} />
            Create worktree before run
          </label>
          <label className="check-label">
            <Checkbox checked={openAfterCreate} onCheckedChange={(value) => setOpenAfterCreate(Boolean(value))} />
            Open worktree as workspace
          </label>
          <label className="kanban-field">
            <span className="input-label">Branch</span>
            <Input className="text-input" value={branchName} onChange={(event) => setBranchName(event.currentTarget.value)} />
          </label>
          <label className="kanban-field">
            <span className="input-label">Base ref</span>
            <Input className="text-input" value={baseRef} onChange={(event) => setBaseRef(event.currentTarget.value)} />
          </label>
          <Button type="button" variant="primary" className="primary-btn" disabled={submitting} onClick={() => {
            void handleCreateTask();
          }}
          >
            {submitting ? "Creating..." : "Create task"}
          </Button>
        </div>
        {error ? <p className="kanban-error">{error}</p> : null}
      </section>

      <section className="kanban-board">
        {tasksByColumn.map((column) => (
          <article key={column.status} className="kanban-column">
            <header className="kanban-column-head">
              <h3>{column.title}</h3>
              <Badge>{column.tasks.length}</Badge>
            </header>

            <div className="kanban-card-list">
              {column.tasks.map((task) => {
                const lastRun = task.lastRunId ? runsById[task.lastRunId] : undefined;
                const activeRunId = runningRunByTaskId[task.id];
                const activeRun = activeRunId ? runsById[activeRunId] : undefined;
                const logText = task.lastRunId ? (runLogs[task.lastRunId] ?? "") : "";

                return (
                  <article key={task.id} className="kanban-card">
                    <div className="kanban-card-head">
                      <strong>{task.title}</strong>
                      {lastRun ? (
                        <Badge variant={lastRun.status === "failed" ? "outline" : "secondary"}>
                          {runStatusBadgeLabel(lastRun.status)}
                        </Badge>
                      ) : null}
                    </div>
                    {task.description ? <p className="kanban-card-description">{task.description}</p> : null}
                    <p className="kanban-card-meta">{taskLocation(task)}</p>
                    <code className="kanban-card-command">{task.command}</code>
                    {logText ? <pre className="kanban-log-preview">{logText}</pre> : null}

                    <div className="kanban-card-actions">
                      <Button
                        type="button"
                        variant="subtle"
                        className="subtle-btn"
                        disabled={!nextKanbanStatus(task.status, -1)}
                        onClick={() => {
                          const prev = nextKanbanStatus(task.status, -1);
                          if (prev) {
                            void moveKanbanTask(task.id, prev);
                          }
                        }}
                      >
                        Back
                      </Button>
                      <Button
                        type="button"
                        variant="subtle"
                        className="subtle-btn"
                        disabled={!nextKanbanStatus(task.status, 1)}
                        onClick={() => {
                          const next = nextKanbanStatus(task.status, 1);
                          if (next) {
                            void moveKanbanTask(task.id, next);
                          }
                        }}
                      >
                        Forward
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        className="primary-btn"
                        disabled={Boolean(activeRun)}
                        onClick={() => {
                          void startKanbanTaskRun(task.id);
                        }}
                      >
                        {activeRun ? "Running..." : "Run"}
                      </Button>
                      <Button
                        type="button"
                        variant="subtle"
                        className="subtle-btn"
                        onClick={() => {
                          if (task.lastRunId) {
                            void refreshKanbanRunLogs(task.lastRunId);
                          }
                        }}
                        disabled={!task.lastRunId}
                      >
                        Refresh Logs
                      </Button>
                      {activeRun ? (
                        <>
                          <Button type="button" variant="subtle" className="subtle-btn" onClick={() => {
                            void completeRun(activeRun.id, "succeeded");
                          }}
                          >
                            Mark Success
                          </Button>
                          <Button type="button" variant="subtle" className="subtle-btn" onClick={() => {
                            void completeRun(activeRun.id, "failed");
                          }}
                          >
                            Mark Failed
                          </Button>
                        </>
                      ) : null}
                      <Button
                        type="button"
                        variant="subtle"
                        className="subtle-btn"
                        onClick={() => {
                          void markKanbanTaskDone(task.id);
                        }}
                        disabled={task.status === "done"}
                      >
                        Done
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
