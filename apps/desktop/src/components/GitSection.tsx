import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
  Textarea,
} from "@supervibing/ui";
import {
  ghIssueComment,
  ghIssueDetail,
  ghIssueEditAssignees,
  ghIssueEditLabels,
  ghListIssues,
  ghListPrs,
  ghListRuns,
  ghListWorkflows,
  ghPrCheckout,
  ghPrComment,
  ghPrDetail,
  ghPrMergeSquash,
  ghRunCancel,
  ghRunDetail,
  ghRunRerunFailed,
  gitCheckoutBranch,
  gitCommit,
  gitCreateBranch,
  gitDeleteBranch,
  gitDiff,
  gitFetch,
  gitListBranches,
  gitPull,
  gitPush,
  gitStagePaths,
  gitStatus,
  gitUnstagePaths,
  gitDiscardPaths,
} from "../lib/tauri";
import { useGitViewStore, type GitFocusZone, type GitPanelId } from "../store/gitView";
import type {
  GitBranchInfo,
  GitHubIssueSummary,
  GitHubPrSummary,
  GitHubRunSummary,
  GitHubWorkflowSummary,
  GitStatusSnapshot,
  WorktreeEntry,
} from "../types";
import { GitActionConfirmModal } from "./git/GitActionConfirmModal";

interface GitSectionProps {
  active: boolean;
  repoRoot: string | null;
  branch: string | null;
  worktreePath: string | null;
  worktreeEntries: WorktreeEntry[];
  onRefreshWorktrees: () => Promise<void>;
  onImportWorktree: (worktreePath: string) => Promise<void>;
  onOpenWorktreeManager: () => void;
}

interface GitRow {
  id: string;
  title: string;
  subtitle: string;
  badges?: string[];
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

const PANEL_ORDER: GitPanelId[] = ["status", "branches", "worktrees", "prs", "issues", "actions"];
const PANEL_LABELS: Record<GitPanelId, string> = {
  status: "Status",
  branches: "Branches",
  worktrees: "Worktrees",
  prs: "PRs",
  issues: "Issues",
  actions: "Actions",
};
const LOCAL_POLL_MS = 5_000;
const GITHUB_POLL_MS = 20_000;

function panelRecord<T>(initial: T): Record<GitPanelId, T> {
  return {
    status: initial,
    branches: initial,
    worktrees: initial,
    prs: initial,
    issues: initial,
    actions: initial,
  };
}

function formatDetail(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Never";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString();
}

function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return true;
  }

  return target.isContentEditable;
}

export function GitSection({
  active,
  repoRoot,
  branch,
  worktreePath,
  worktreeEntries,
  onRefreshWorktrees,
  onImportWorktree,
  onOpenWorktreeManager,
}: GitSectionProps) {
  const activePanel = useGitViewStore((state) => state.activePanel);
  const focusZone = useGitViewStore((state) => state.focusZone);
  const cursorByPanel = useGitViewStore((state) => state.cursorByPanel);
  const setActivePanel = useGitViewStore((state) => state.setActivePanel);
  const setFocusZone = useGitViewStore((state) => state.setFocusZone);
  const cycleFocusZone = useGitViewStore((state) => state.cycleFocusZone);
  const moveCursor = useGitViewStore((state) => state.moveCursor);
  const setCursor = useGitViewStore((state) => state.setCursor);

  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [prs, setPrs] = useState<GitHubPrSummary[]>([]);
  const [issues, setIssues] = useState<GitHubIssueSummary[]>([]);
  const [workflows, setWorkflows] = useState<GitHubWorkflowSummary[]>([]);
  const [runs, setRuns] = useState<GitHubRunSummary[]>([]);
  const [detailText, setDetailText] = useState<string>("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [loadingByPanel, setLoadingByPanel] = useState(panelRecord(false));
  const [errorByPanel, setErrorByPanel] = useState(panelRecord<string | null>(null));
  const [lastSyncByPanel, setLastSyncByPanel] = useState(panelRecord<string | null>(null));
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitMessageDraft, setCommitMessageDraft] = useState("");
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [newBranchNameDraft, setNewBranchNameDraft] = useState("");
  const [newBranchBaseRefDraft, setNewBranchBaseRefDraft] = useState("HEAD");
  const [prDialogOpen, setPrDialogOpen] = useState(false);
  const [prCommentDraft, setPrCommentDraft] = useState("");
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [issueCommentDraft, setIssueCommentDraft] = useState("");
  const [issueAddLabelsDraft, setIssueAddLabelsDraft] = useState("");
  const [issueRemoveLabelsDraft, setIssueRemoveLabelsDraft] = useState("");
  const [issueAddAssigneesDraft, setIssueAddAssigneesDraft] = useState("");
  const [issueRemoveAssigneesDraft, setIssueRemoveAssigneesDraft] = useState("");

  const setPanelLoading = useCallback((panel: GitPanelId, loading: boolean) => {
    setLoadingByPanel((current) => ({ ...current, [panel]: loading }));
  }, []);

  const setPanelError = useCallback((panel: GitPanelId, error: string | null) => {
    setErrorByPanel((current) => ({ ...current, [panel]: error }));
  }, []);

  const setPanelSync = useCallback((panel: GitPanelId) => {
    setLastSyncByPanel((current) => ({ ...current, [panel]: new Date().toISOString() }));
  }, []);

  const refreshStatusAndBranches = useCallback(async () => {
    if (!repoRoot) {
      setStatus(null);
      setBranches([]);
      return;
    }

    setPanelLoading("status", true);
    setPanelLoading("branches", true);
    setPanelError("status", null);
    setPanelError("branches", null);

    try {
      const [nextStatus, nextBranches] = await Promise.all([
        gitStatus({ repoRoot }),
        gitListBranches({ repoRoot }),
      ]);
      setStatus(nextStatus);
      setBranches(nextBranches);
      setPanelSync("status");
      setPanelSync("branches");
    } catch (error) {
      const message = String(error);
      setPanelError("status", message);
      setPanelError("branches", message);
    } finally {
      setPanelLoading("status", false);
      setPanelLoading("branches", false);
    }
  }, [repoRoot, setPanelError, setPanelLoading, setPanelSync]);

  const refreshWorktreesPanel = useCallback(async () => {
    if (!repoRoot) {
      return;
    }

    setPanelLoading("worktrees", true);
    setPanelError("worktrees", null);
    try {
      await onRefreshWorktrees();
      setPanelSync("worktrees");
    } catch (error) {
      setPanelError("worktrees", String(error));
    } finally {
      setPanelLoading("worktrees", false);
    }
  }, [onRefreshWorktrees, repoRoot, setPanelError, setPanelLoading, setPanelSync]);

  const refreshPrs = useCallback(async () => {
    if (!repoRoot) {
      setPrs([]);
      return;
    }

    setPanelLoading("prs", true);
    setPanelError("prs", null);
    try {
      setPrs(await ghListPrs({ repoRoot, limit: 50 }));
      setPanelSync("prs");
    } catch (error) {
      setPanelError("prs", String(error));
    } finally {
      setPanelLoading("prs", false);
    }
  }, [repoRoot, setPanelError, setPanelLoading, setPanelSync]);

  const refreshIssues = useCallback(async () => {
    if (!repoRoot) {
      setIssues([]);
      return;
    }

    setPanelLoading("issues", true);
    setPanelError("issues", null);
    try {
      setIssues(await ghListIssues({ repoRoot, limit: 50 }));
      setPanelSync("issues");
    } catch (error) {
      setPanelError("issues", String(error));
    } finally {
      setPanelLoading("issues", false);
    }
  }, [repoRoot, setPanelError, setPanelLoading, setPanelSync]);

  const refreshActions = useCallback(async () => {
    if (!repoRoot) {
      setWorkflows([]);
      setRuns([]);
      return;
    }

    setPanelLoading("actions", true);
    setPanelError("actions", null);
    try {
      const [nextWorkflows, nextRuns] = await Promise.all([
        ghListWorkflows({ repoRoot, limit: 30 }),
        ghListRuns({ repoRoot, limit: 50 }),
      ]);
      setWorkflows(nextWorkflows);
      setRuns(nextRuns);
      setPanelSync("actions");
    } catch (error) {
      setPanelError("actions", String(error));
    } finally {
      setPanelLoading("actions", false);
    }
  }, [repoRoot, setPanelError, setPanelLoading, setPanelSync]);

  const refreshActivePanel = useCallback(async () => {
    if (activePanel === "status" || activePanel === "branches") {
      await refreshStatusAndBranches();
      return;
    }
    if (activePanel === "worktrees") {
      await refreshWorktreesPanel();
      return;
    }
    if (activePanel === "prs") {
      await refreshPrs();
      return;
    }
    if (activePanel === "issues") {
      await refreshIssues();
      return;
    }
    await refreshActions();
  }, [
    activePanel,
    refreshActions,
    refreshIssues,
    refreshPrs,
    refreshStatusAndBranches,
    refreshWorktreesPanel,
  ]);

  useEffect(() => {
    if (!active || !repoRoot) {
      return;
    }

    void refreshStatusAndBranches();
    void refreshWorktreesPanel();
    void refreshPrs();
    void refreshIssues();
    void refreshActions();
  }, [
    active,
    repoRoot,
    refreshActions,
    refreshIssues,
    refreshPrs,
    refreshStatusAndBranches,
    refreshWorktreesPanel,
  ]);

  useEffect(() => {
    if (!active || !repoRoot) {
      return;
    }

    const localTimer = window.setInterval(() => {
      void refreshStatusAndBranches();
      void refreshWorktreesPanel();
    }, LOCAL_POLL_MS);
    const githubTimer = window.setInterval(() => {
      void refreshPrs();
      void refreshIssues();
      void refreshActions();
    }, GITHUB_POLL_MS);

    return () => {
      window.clearInterval(localTimer);
      window.clearInterval(githubTimer);
    };
  }, [
    active,
    repoRoot,
    refreshActions,
    refreshIssues,
    refreshPrs,
    refreshStatusAndBranches,
    refreshWorktreesPanel,
  ]);

  const sortedWorktrees = useMemo(
    () => [...worktreeEntries].sort((a, b) => a.worktreePath.localeCompare(b.worktreePath)),
    [worktreeEntries],
  );

  const rows = useMemo<GitRow[]>(() => {
    if (activePanel === "status") {
      return (status?.files ?? []).map((file) => ({
        id: file.path,
        title: file.path,
        subtitle: `code ${file.code}`,
        badges: [
          file.staged ? "staged" : "",
          file.unstaged ? "unstaged" : "",
          file.untracked ? "untracked" : "",
        ].filter(Boolean),
      }));
    }

    if (activePanel === "branches") {
      return branches.map((item) => ({
        id: item.name,
        title: item.name,
        subtitle: item.subject || item.commit || "no commit info",
        badges: [
          item.isCurrent ? "current" : "",
          item.upstream ? `upstream:${item.upstream}` : "",
        ].filter(Boolean),
      }));
    }

    if (activePanel === "worktrees") {
      return sortedWorktrees.map((entry) => ({
        id: entry.worktreePath,
        title: entry.branch,
        subtitle: entry.worktreePath,
        badges: [
          entry.isMainWorktree ? "main" : "",
          entry.isDetached ? "detached" : "",
          entry.isLocked ? "locked" : "",
          entry.isDirty ? "dirty" : "",
          entry.isPrunable ? "prunable" : "",
        ].filter(Boolean),
      }));
    }

    if (activePanel === "prs") {
      return prs.map((pr) => ({
        id: `pr-${pr.number}`,
        title: `#${pr.number} ${pr.title}`,
        subtitle: `${pr.state} · ${pr.headRefName} -> ${pr.baseRefName}`,
        badges: [pr.isDraft ? "draft" : "", pr.author?.login ? `@${pr.author.login}` : ""].filter(Boolean),
      }));
    }

    if (activePanel === "issues") {
      return issues.map((issue) => ({
        id: `issue-${issue.number}`,
        title: `#${issue.number} ${issue.title}`,
        subtitle: `${issue.state} · updated ${new Date(issue.updatedAt).toLocaleString()}`,
        badges: [
          issue.author?.login ? `@${issue.author.login}` : "",
          ...issue.labels.slice(0, 2).map((label) => label.name),
        ].filter(Boolean),
      }));
    }

    return runs.map((run) => ({
      id: `run-${run.databaseId}`,
      title: `${run.workflowName}: ${run.displayTitle}`,
      subtitle: `${run.status}${run.conclusion ? `/${run.conclusion}` : ""} · ${run.event}`,
      badges: [run.headBranch ?? "", run.number ? `#${run.number}` : ""].filter(Boolean),
    }));
  }, [activePanel, branches, issues, prs, runs, sortedWorktrees, status?.files]);

  const cursor = cursorByPanel[activePanel] ?? 0;

  useEffect(() => {
    if (rows.length === 0) {
      if (cursor !== 0) {
        setCursor(activePanel, 0);
      }
      return;
    }

    if (cursor > rows.length - 1) {
      setCursor(activePanel, rows.length - 1);
    }
  }, [activePanel, cursor, rows.length, setCursor]);

  const selectedStatusFile = activePanel === "status" ? status?.files[cursor] ?? null : null;
  const selectedBranch = activePanel === "branches" ? branches[cursor] ?? null : null;
  const selectedWorktree = activePanel === "worktrees" ? sortedWorktrees[cursor] ?? null : null;
  const selectedPr = activePanel === "prs" ? prs[cursor] ?? null : null;
  const selectedIssue = activePanel === "issues" ? issues[cursor] ?? null : null;
  const selectedRun = activePanel === "actions" ? runs[cursor] ?? null : null;

  const currentError = errorByPanel[activePanel];
  const currentLoading = loadingByPanel[activePanel];

  const defaultDetail = useMemo(() => {
    if (!repoRoot) {
      return "No repository selected. Open a workspace that points to a git repository.";
    }

    if (activePanel === "status") {
      if (!selectedStatusFile) {
        return "Select a file to inspect status or show diff.";
      }
      return [
        `Path: ${selectedStatusFile.path}`,
        `Code: ${selectedStatusFile.code}`,
        `Staged: ${selectedStatusFile.staged}`,
        `Unstaged: ${selectedStatusFile.unstaged}`,
        `Untracked: ${selectedStatusFile.untracked}`,
      ].join("\n");
    }

    if (activePanel === "branches") {
      if (!selectedBranch) {
        return "Select a branch to checkout, create, or delete.";
      }
      return [
        `Branch: ${selectedBranch.name}`,
        `Current: ${selectedBranch.isCurrent}`,
        `Upstream: ${selectedBranch.upstream ?? "none"}`,
        `Commit: ${selectedBranch.commit || "n/a"}`,
        `Subject: ${selectedBranch.subject || "n/a"}`,
      ].join("\n");
    }

    if (activePanel === "worktrees") {
      if (!selectedWorktree) {
        return "Select a worktree to open as a workspace.";
      }
      return [
        `Branch: ${selectedWorktree.branch}`,
        `Path: ${selectedWorktree.worktreePath}`,
        `Main: ${selectedWorktree.isMainWorktree}`,
        `Dirty: ${selectedWorktree.isDirty}`,
        `Locked: ${selectedWorktree.isLocked}`,
        `Prunable: ${selectedWorktree.isPrunable}`,
      ].join("\n");
    }

    if (activePanel === "prs") {
      if (!selectedPr) {
        return "Select a pull request to inspect details.";
      }
      return [
        `PR #${selectedPr.number}`,
        selectedPr.title,
        `${selectedPr.headRefName} -> ${selectedPr.baseRefName}`,
        `${selectedPr.state}${selectedPr.isDraft ? " (draft)" : ""}`,
        selectedPr.url,
      ].join("\n");
    }

    if (activePanel === "issues") {
      if (!selectedIssue) {
        return "Select an issue to inspect details.";
      }
      return [
        `Issue #${selectedIssue.number}`,
        selectedIssue.title,
        `${selectedIssue.state} · ${selectedIssue.author?.login ?? "unknown author"}`,
        selectedIssue.url,
      ].join("\n");
    }

    if (!selectedRun) {
      return [
        "Select an actions run to inspect details.",
        "",
        `Known workflows: ${workflows.length}`,
      ].join("\n");
    }
    return [
      `Run #${selectedRun.databaseId}`,
      selectedRun.workflowName,
      `${selectedRun.status}${selectedRun.conclusion ? `/${selectedRun.conclusion}` : ""}`,
      `${selectedRun.event} · ${selectedRun.headBranch ?? "detached"}`,
      selectedRun.url,
    ].join("\n");
  }, [
    activePanel,
    repoRoot,
    selectedBranch,
    selectedIssue,
    selectedPr,
    selectedRun,
    selectedStatusFile,
    selectedWorktree,
    workflows.length,
  ]);

  const detailValue = detailText.trim().length > 0 ? detailText : defaultDetail;

  useEffect(() => {
    setDetailText("");
  }, [activePanel, cursor]);

  const withBusyAction = useCallback(async (panel: GitPanelId, task: () => Promise<string | void>) => {
    setBusyAction(true);
    setPanelError(panel, null);
    try {
      const result = await task();
      if (typeof result === "string" && result.trim().length > 0) {
        setFeedback(result);
      }
    } catch (error) {
      setPanelError(panel, String(error));
      setFeedback(null);
    } finally {
      setBusyAction(false);
    }
  }, [setPanelError]);

  const openPrDetail = useCallback(async (number: number) => {
    if (!repoRoot) {
      return;
    }
    await withBusyAction("prs", async () => {
      const detail = await ghPrDetail({ repoRoot, number });
      setDetailText(formatDetail(detail));
      setFocusZone("detail");
    });
  }, [repoRoot, setFocusZone, withBusyAction]);

  const openIssueDetail = useCallback(async (number: number) => {
    if (!repoRoot) {
      return;
    }
    await withBusyAction("issues", async () => {
      const detail = await ghIssueDetail({ repoRoot, number });
      setDetailText(formatDetail(detail));
      setFocusZone("detail");
    });
  }, [repoRoot, setFocusZone, withBusyAction]);

  const openRunDetail = useCallback(async (runId: number) => {
    if (!repoRoot) {
      return;
    }
    await withBusyAction("actions", async () => {
      const detail = await ghRunDetail({ repoRoot, runId });
      setDetailText(formatDetail(detail));
      setFocusZone("detail");
    });
  }, [repoRoot, setFocusZone, withBusyAction]);

  const toggleSelectedStatusFile = useCallback(async () => {
    if (!repoRoot || !selectedStatusFile) {
      return;
    }

    await withBusyAction("status", async () => {
      const response =
        selectedStatusFile.staged && !selectedStatusFile.unstaged
          ? await gitUnstagePaths({ repoRoot, paths: [selectedStatusFile.path] })
          : await gitStagePaths({ repoRoot, paths: [selectedStatusFile.path] });
      await refreshStatusAndBranches();
      return response.output;
    });
  }, [repoRoot, refreshStatusAndBranches, selectedStatusFile, withBusyAction]);

  const showSelectedStatusDiff = useCallback(async () => {
    if (!repoRoot || !selectedStatusFile) {
      return;
    }

    await withBusyAction("status", async () => {
      const staged = selectedStatusFile.staged && !selectedStatusFile.unstaged;
      const response = await gitDiff({
        repoRoot,
        path: selectedStatusFile.path,
        staged,
      });
      setDetailText(response.patch || "(no diff)");
      setFocusZone("detail");
    });
  }, [repoRoot, selectedStatusFile, setFocusZone, withBusyAction]);

  const openCommitDialog = useCallback(() => {
    setCommitMessageDraft("");
    setCommitDialogOpen(true);
  }, []);

  const submitCommit = useCallback(async () => {
    if (!repoRoot) {
      return;
    }
    const message = commitMessageDraft.trim();
    if (message.length === 0) {
      return;
    }

    await withBusyAction("status", async () => {
      const response = await gitCommit({ repoRoot, message });
      await refreshStatusAndBranches();
      await refreshPrs();
      return response.output;
    });
    setCommitDialogOpen(false);
    setCommitMessageDraft("");
  }, [commitMessageDraft, refreshPrs, refreshStatusAndBranches, repoRoot, withBusyAction]);

  const quickBranchAction = useCallback(() => {
    if (!repoRoot) {
      return;
    }

    setBranchDialogOpen(true);
  }, [repoRoot]);

  const checkoutSelectedBranch = useCallback(async () => {
    if (!repoRoot || !selectedBranch || selectedBranch.isCurrent) {
      return;
    }

    await withBusyAction("branches", async () => {
      const response = await gitCheckoutBranch({ repoRoot, branch: selectedBranch.name });
      await refreshStatusAndBranches();
      return response.output;
    });
    setBranchDialogOpen(false);
  }, [refreshStatusAndBranches, repoRoot, selectedBranch, withBusyAction]);

  const createBranchFromDialog = useCallback(async () => {
    if (!repoRoot) {
      return;
    }
    const branchName = newBranchNameDraft.trim();
    if (branchName.length === 0) {
      return;
    }

    await withBusyAction("branches", async () => {
      const response = await gitCreateBranch({
        repoRoot,
        branch: branchName,
        baseRef: newBranchBaseRefDraft.trim() || undefined,
        checkout: true,
      });
      await refreshStatusAndBranches();
      return response.output;
    });
    setBranchDialogOpen(false);
    setNewBranchNameDraft("");
    setNewBranchBaseRefDraft("HEAD");
  }, [newBranchBaseRefDraft, newBranchNameDraft, refreshStatusAndBranches, repoRoot, withBusyAction]);

  const quickPrAction = useCallback(() => {
    if (!repoRoot || !selectedPr) {
      return;
    }

    setPrDialogOpen(true);
  }, [repoRoot, selectedPr]);

  const checkoutSelectedPr = useCallback(async () => {
    if (!repoRoot || !selectedPr) {
      return;
    }

    await withBusyAction("prs", async () => {
      const response = await ghPrCheckout({ repoRoot, number: selectedPr.number });
      await refreshStatusAndBranches();
      return response.output;
    });
    setPrDialogOpen(false);
  }, [refreshStatusAndBranches, repoRoot, selectedPr, withBusyAction]);

  const commentOnSelectedPr = useCallback(async () => {
    if (!repoRoot || !selectedPr) {
      return;
    }
    const comment = prCommentDraft.trim();
    if (comment.length === 0) {
      return;
    }

    await withBusyAction("prs", async () => {
      const response = await ghPrComment({
        repoRoot,
        number: selectedPr.number,
        body: comment,
      });
      return response.output;
    });
    setPrCommentDraft("");
    setPrDialogOpen(false);
  }, [prCommentDraft, repoRoot, selectedPr, withBusyAction]);

  const quickIssueAction = useCallback(() => {
    if (!repoRoot || !selectedIssue) {
      return;
    }
    setIssueDialogOpen(true);
  }, [repoRoot, selectedIssue]);

  const commentOnSelectedIssue = useCallback(async () => {
    if (!repoRoot || !selectedIssue) {
      return;
    }
    const comment = issueCommentDraft.trim();
    if (comment.length === 0) {
      return;
    }

    await withBusyAction("issues", async () => {
      const response = await ghIssueComment({
        repoRoot,
        number: selectedIssue.number,
        body: comment,
      });
      return response.output;
    });
    setIssueCommentDraft("");
    setIssueDialogOpen(false);
  }, [issueCommentDraft, repoRoot, selectedIssue, withBusyAction]);

  const editSelectedIssueLabels = useCallback(async () => {
    if (!repoRoot || !selectedIssue) {
      return;
    }
    const addLabels = parseCsvList(issueAddLabelsDraft);
    const removeLabels = parseCsvList(issueRemoveLabelsDraft);
    if (addLabels.length === 0 && removeLabels.length === 0) {
      return;
    }

    await withBusyAction("issues", async () => {
      const response = await ghIssueEditLabels({
        repoRoot,
        number: selectedIssue.number,
        addLabels,
        removeLabels,
      });
      await refreshIssues();
      return response.output;
    });
    setIssueAddLabelsDraft("");
    setIssueRemoveLabelsDraft("");
    setIssueDialogOpen(false);
  }, [issueAddLabelsDraft, issueRemoveLabelsDraft, refreshIssues, repoRoot, selectedIssue, withBusyAction]);

  const editSelectedIssueAssignees = useCallback(async () => {
    if (!repoRoot || !selectedIssue) {
      return;
    }
    const addAssignees = parseCsvList(issueAddAssigneesDraft);
    const removeAssignees = parseCsvList(issueRemoveAssigneesDraft);
    if (addAssignees.length === 0 && removeAssignees.length === 0) {
      return;
    }

    await withBusyAction("issues", async () => {
      const response = await ghIssueEditAssignees({
        repoRoot,
        number: selectedIssue.number,
        addAssignees,
        removeAssignees,
      });
      await refreshIssues();
      return response.output;
    });
    setIssueAddAssigneesDraft("");
    setIssueRemoveAssigneesDraft("");
    setIssueDialogOpen(false);
  }, [
    issueAddAssigneesDraft,
    issueRemoveAssigneesDraft,
    refreshIssues,
    repoRoot,
    selectedIssue,
    withBusyAction,
  ]);

  const runDefaultAction = useCallback(async () => {
    if (activePanel === "status" && selectedStatusFile) {
      await showSelectedStatusDiff();
      return;
    }
    if (activePanel === "branches" && selectedBranch && !selectedBranch.isCurrent && repoRoot) {
      await withBusyAction("branches", async () => {
        const response = await gitCheckoutBranch({
          repoRoot,
          branch: selectedBranch.name,
        });
        await refreshStatusAndBranches();
        return response.output;
      });
      return;
    }
    if (activePanel === "worktrees" && selectedWorktree) {
      await withBusyAction("worktrees", async () => {
        await onImportWorktree(selectedWorktree.worktreePath);
      });
      return;
    }
    if (activePanel === "prs" && selectedPr) {
      await openPrDetail(selectedPr.number);
      return;
    }
    if (activePanel === "issues" && selectedIssue) {
      await openIssueDetail(selectedIssue.number);
      return;
    }
    if (activePanel === "actions" && selectedRun) {
      await openRunDetail(selectedRun.databaseId);
    }
  }, [
    activePanel,
    onImportWorktree,
    openIssueDetail,
    openPrDetail,
    openRunDetail,
    refreshStatusAndBranches,
    repoRoot,
    selectedBranch,
    selectedIssue,
    selectedPr,
    selectedRun,
    selectedStatusFile,
    selectedWorktree,
    showSelectedStatusDiff,
    withBusyAction,
  ]);

  const runDestructiveAction = useCallback(() => {
    if (!repoRoot) {
      return;
    }

    if (activePanel === "status" && selectedStatusFile) {
      setConfirmState({
        title: "Discard File Changes",
        message: `Discard local changes for ${selectedStatusFile.path}?`,
        confirmLabel: "Discard",
        onConfirm: async () => {
          const response = await gitDiscardPaths({
            repoRoot,
            paths: [selectedStatusFile.path],
            force: true,
          });
          setFeedback(response.output);
          await refreshStatusAndBranches();
        },
      });
      return;
    }

    if (activePanel === "branches" && selectedBranch && !selectedBranch.isCurrent) {
      setConfirmState({
        title: "Delete Branch",
        message: `Delete branch ${selectedBranch.name}?`,
        confirmLabel: "Delete",
        onConfirm: async () => {
          const response = await gitDeleteBranch({
            repoRoot,
            branch: selectedBranch.name,
            force: false,
          });
          setFeedback(response.output);
          await refreshStatusAndBranches();
        },
      });
      return;
    }

    if (activePanel === "prs" && selectedPr) {
      setConfirmState({
        title: "Squash Merge Pull Request",
        message: `Squash merge PR #${selectedPr.number}?`,
        confirmLabel: "Squash Merge",
        onConfirm: async () => {
          const response = await ghPrMergeSquash({
            repoRoot,
            number: selectedPr.number,
            deleteBranch: false,
          });
          setFeedback(response.output);
          await refreshPrs();
          await refreshStatusAndBranches();
        },
      });
      return;
    }

    if (activePanel === "actions" && selectedRun) {
      setConfirmState({
        title: "Cancel Workflow Run",
        message: `Cancel run #${selectedRun.databaseId}?`,
        confirmLabel: "Cancel Run",
        onConfirm: async () => {
          const response = await ghRunCancel({
            repoRoot,
            runId: selectedRun.databaseId,
          });
          setFeedback(response.output);
          await refreshActions();
        },
      });
    }
  }, [
    activePanel,
    refreshActions,
    refreshPrs,
    refreshStatusAndBranches,
    repoRoot,
    selectedBranch,
    selectedPr,
    selectedRun,
    selectedStatusFile,
  ]);

  const rerunSelectedRun = useCallback(async () => {
    if (!repoRoot || !selectedRun) {
      return;
    }

    await withBusyAction("actions", async () => {
      const response = await ghRunRerunFailed({
        repoRoot,
        runId: selectedRun.databaseId,
      });
      await refreshActions();
      return response.output;
    });
  }, [refreshActions, repoRoot, selectedRun, withBusyAction]);

  const runFetch = useCallback(async () => {
    if (!repoRoot) {
      return;
    }
    await withBusyAction("status", async () => {
      const response = await gitFetch({ repoRoot });
      await refreshStatusAndBranches();
      await refreshPrs();
      return response.output;
    });
  }, [refreshPrs, refreshStatusAndBranches, repoRoot, withBusyAction]);

  const runPull = useCallback(async () => {
    if (!repoRoot) {
      return;
    }
    await withBusyAction("status", async () => {
      const response = await gitPull({ repoRoot });
      await refreshStatusAndBranches();
      await refreshPrs();
      return response.output;
    });
  }, [refreshPrs, refreshStatusAndBranches, repoRoot, withBusyAction]);

  const runPush = useCallback(async () => {
    if (!repoRoot) {
      return;
    }
    await withBusyAction("status", async () => {
      const response = await gitPush({ repoRoot });
      await refreshStatusAndBranches();
      await refreshPrs();
      return response.output;
    });
  }, [refreshPrs, refreshStatusAndBranches, repoRoot, withBusyAction]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const listener = (event: KeyboardEvent) => {
      if (!active) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        cycleFocusZone();
        return;
      }

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveCursor(activePanel, 1, rows.length);
        return;
      }

      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveCursor(activePanel, -1, rows.length);
        return;
      }

      if (event.key === "g") {
        event.preventDefault();
        setCursor(activePanel, 0);
        return;
      }

      if (event.key === "G") {
        event.preventDefault();
        if (rows.length > 0) {
          setCursor(activePanel, rows.length - 1);
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        void runDefaultAction();
        return;
      }

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refreshActivePanel();
        return;
      }

      if (event.key.toLowerCase() === "s" && activePanel === "status") {
        event.preventDefault();
        void toggleSelectedStatusFile();
        return;
      }

      if (event.key.toLowerCase() === "d" && activePanel === "status") {
        event.preventDefault();
        void showSelectedStatusDiff();
        return;
      }

      if (event.key.toLowerCase() === "c" && activePanel === "status") {
        event.preventDefault();
        openCommitDialog();
        return;
      }

      if (event.key.toLowerCase() === "b" && activePanel === "branches") {
        event.preventDefault();
        void quickBranchAction();
        return;
      }

      if (event.key.toLowerCase() === "p" && activePanel === "prs") {
        event.preventDefault();
        void quickPrAction();
        return;
      }

      if (event.key.toLowerCase() === "i" && activePanel === "issues") {
        event.preventDefault();
        void quickIssueAction();
        return;
      }

      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        setActivePanel("actions");
        return;
      }

      if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        runDestructiveAction();
        return;
      }

      if (event.key.toLowerCase() === "u" && activePanel === "actions") {
        event.preventDefault();
        void rerunSelectedRun();
      }
    };

    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
    };
  }, [
    active,
    activePanel,
    cycleFocusZone,
    moveCursor,
    openCommitDialog,
    quickBranchAction,
    quickIssueAction,
    quickPrAction,
    refreshActivePanel,
    rows.length,
    rerunSelectedRun,
    runDefaultAction,
    runDestructiveAction,
    setActivePanel,
    setCursor,
    showSelectedStatusDiff,
    toggleSelectedStatusFile,
  ]);

  const setFocusWithPanel = (panel: GitPanelId, zone: GitFocusZone) => {
    setActivePanel(panel);
    setFocusZone(zone);
  };

  if (!repoRoot) {
    return (
      <section className="section-surface section-surface--headed">
        <header className="section-head">
          <h2>Git</h2>
          <p>Open a workspace with a git repository to inspect and control source state.</p>
        </header>
      </section>
    );
  }

  return (
    <section className="section-surface section-surface--headed git-shell">
      <header className="section-head">
        <h2>Git Control Center</h2>
        <p>Keyboard-first git and GitHub workflow controls for the active workspace repository.</p>
      </header>

      <div className="git-toolbar">
        <div className="git-toolbar-meta">
          <Badge>repo {repoRoot}</Badge>
          {branch ? <Badge>branch {branch}</Badge> : null}
          {worktreePath ? <Badge>worktree {worktreePath}</Badge> : null}
          <Badge>focus {focusZone}</Badge>
        </div>
        <div className="git-toolbar-actions">
          <Button type="button" variant="subtle" className="subtle-btn" onClick={() => void runFetch()}>
            Fetch
          </Button>
          <Button type="button" variant="subtle" className="subtle-btn" onClick={() => void runPull()}>
            Pull
          </Button>
          <Button type="button" variant="subtle" className="subtle-btn" onClick={() => void runPush()}>
            Push
          </Button>
          <Button type="button" variant="subtle" className="subtle-btn" onClick={() => void refreshActivePanel()}>
            Refresh
          </Button>
          <Button type="button" variant="subtle" className="subtle-btn" onClick={onOpenWorktreeManager}>
            Worktree Manager
          </Button>
        </div>
      </div>

      {feedback ? <p className="worktree-message">{feedback}</p> : null}
      {currentError ? <p className="worktree-error">{currentError}</p> : null}

      <div className="git-layout">
        <aside className={`git-pane git-pane-tabs ${focusZone === "tabs" ? "is-focused" : ""}`}>
          {PANEL_ORDER.map((panel) => (
            <Button
              key={panel}
              type="button"
              variant="subtle"
              className={`git-tab-btn ${panel === activePanel ? "active" : ""}`}
              onClick={() => setFocusWithPanel(panel, "list")}
            >
              <span>{PANEL_LABELS[panel]}</span>
              {loadingByPanel[panel] ? <small>syncing</small> : <small>{formatTimestamp(lastSyncByPanel[panel])}</small>}
            </Button>
          ))}
        </aside>

        <section className={`git-pane git-pane-list ${focusZone === "list" ? "is-focused" : ""}`}>
          <div className="git-list-head">
            <strong>{PANEL_LABELS[activePanel]}</strong>
            <small>{rows.length} items</small>
          </div>
          <ScrollArea className="git-list-body" role="listbox" aria-label={`${PANEL_LABELS[activePanel]} list`}>
            {rows.length === 0 ? <p className="settings-caption">No items.</p> : null}
            {rows.map((row, index) => (
              <Button
                key={row.id}
                type="button"
                variant="subtle"
                role="option"
                aria-selected={index === cursor}
                className={`git-row ${index === cursor ? "active" : ""}`}
                onClick={() => {
                  setCursor(activePanel, index);
                  setFocusZone("list");
                }}
              >
                <span className="git-row-title">{row.title}</span>
                <small className="git-row-subtitle">{row.subtitle}</small>
                {row.badges?.length ? (
                  <span className="git-row-badges">
                    {row.badges.map((badge) => (
                      <Badge key={badge}>
                        {badge}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </Button>
            ))}
          </ScrollArea>
        </section>

        <section className={`git-pane git-pane-detail ${focusZone === "detail" ? "is-focused" : ""}`}>
          <div className="git-list-head">
            <strong>Details</strong>
            <small>{currentLoading || busyAction ? "working..." : "ready"}</small>
          </div>
          <pre className="git-detail-text">{detailValue}</pre>
          {activePanel === "status" ? (
            <div className="git-detail-actions">
              <Button type="button" variant="subtle" className="subtle-btn" onClick={openCommitDialog}>
                Commit…
              </Button>
            </div>
          ) : null}
          {activePanel === "branches" ? (
            <div className="git-detail-actions">
              <Button type="button" variant="subtle" className="subtle-btn" onClick={quickBranchAction}>
                Branch actions…
              </Button>
            </div>
          ) : null}
          {activePanel === "prs" ? (
            <div className="git-detail-actions">
              <Button type="button" variant="subtle" className="subtle-btn" onClick={quickPrAction}>
                PR actions…
              </Button>
            </div>
          ) : null}
          {activePanel === "issues" ? (
            <div className="git-detail-actions">
              <Button type="button" variant="subtle" className="subtle-btn" onClick={quickIssueAction}>
                Issue actions…
              </Button>
            </div>
          ) : null}
          {activePanel === "actions" && selectedRun ? (
            <div className="git-detail-actions">
              <Button type="button" variant="subtle" className="subtle-btn" onClick={() => void openRunDetail(selectedRun.databaseId)}>
                Open
              </Button>
              <Button type="button" variant="subtle" className="subtle-btn" onClick={() => void rerunSelectedRun()}>
                Rerun Failed
              </Button>
              <Button type="button" variant="subtle" className="subtle-btn" onClick={runDestructiveAction}>
                Cancel
              </Button>
            </div>
          ) : null}
        </section>
      </div>

      <div className="git-shortcuts">
        <small>
          Keys: j/k move, g/G first-last, tab focus cycle, enter default, r refresh, s stage, d diff, c commit,
          b branch menu, p PR menu, i issue menu, a actions tab, u rerun selected run, x destructive confirm.
        </small>
      </div>

      <Dialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
        <DialogContent className="workspace-modal git-confirm-modal">
          <DialogHeader className="workspace-modal-head">
            <DialogTitle>Commit staged changes</DialogTitle>
            <DialogDescription className="settings-caption">Provide a commit message for current staged changes.</DialogDescription>
          </DialogHeader>
          <div className="workspace-modal-section">
            <label className="input-label" htmlFor="git-commit-message">Message</label>
            <Input
              id="git-commit-message"
              className="text-input"
              placeholder="feat: describe change"
              value={commitMessageDraft}
              onChange={(event) => setCommitMessageDraft(event.currentTarget.value)}
            />
          </div>
          <DialogFooter className="workspace-modal-actions">
            <Button type="button" variant="subtle" className="subtle-btn" onClick={() => setCommitDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              className="primary-btn"
              disabled={commitMessageDraft.trim().length === 0 || busyAction}
              onClick={() => {
                void submitCommit();
              }}
            >
              Commit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={branchDialogOpen} onOpenChange={setBranchDialogOpen}>
        <DialogContent className="workspace-modal git-confirm-modal">
          <DialogHeader className="workspace-modal-head">
            <DialogTitle>Branch actions</DialogTitle>
            <DialogDescription className="settings-caption">Checkout, create, or delete branches for this repository.</DialogDescription>
          </DialogHeader>
          <div className="workspace-modal-section">
            <p className="settings-caption">
              Selected: {selectedBranch ? selectedBranch.name : "No branch selected"}
            </p>
            <div className="settings-inline-actions">
              <Button
                type="button"
                variant="subtle"
                className="subtle-btn"
                disabled={!selectedBranch || selectedBranch.isCurrent || busyAction}
                onClick={() => {
                  void checkoutSelectedBranch();
                }}
              >
                Checkout selected
              </Button>
              <Button
                type="button"
                variant="subtle"
                className="subtle-btn"
                disabled={!selectedBranch || selectedBranch.isCurrent || busyAction}
                onClick={() => {
                  if (!selectedBranch) {
                    return;
                  }
                  setConfirmState({
                    title: "Delete Branch",
                    message: `Delete branch ${selectedBranch.name}? This cannot be undone.`,
                    confirmLabel: "Delete",
                    onConfirm: async () => {
                      const response = await gitDeleteBranch({
                        repoRoot,
                        branch: selectedBranch.name,
                        force: false,
                      });
                      setFeedback(response.output);
                      await refreshStatusAndBranches();
                    },
                  });
                  setBranchDialogOpen(false);
                }}
              >
                Delete selected
              </Button>
            </div>
          </div>
          <div className="workspace-modal-section">
            <h3>Create and checkout branch</h3>
            <label className="input-label" htmlFor="git-create-branch-name">Branch</label>
            <Input
              id="git-create-branch-name"
              className="text-input"
              placeholder="feature/my-branch"
              value={newBranchNameDraft}
              onChange={(event) => setNewBranchNameDraft(event.currentTarget.value)}
            />
            <label className="input-label" htmlFor="git-create-branch-base">Base ref</label>
            <Input
              id="git-create-branch-base"
              className="text-input"
              placeholder="HEAD"
              value={newBranchBaseRefDraft}
              onChange={(event) => setNewBranchBaseRefDraft(event.currentTarget.value)}
            />
          </div>
          <DialogFooter className="workspace-modal-actions">
            <Button type="button" variant="subtle" className="subtle-btn" onClick={() => setBranchDialogOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              className="primary-btn"
              disabled={newBranchNameDraft.trim().length === 0 || busyAction}
              onClick={() => {
                void createBranchFromDialog();
              }}
            >
              Create branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={prDialogOpen} onOpenChange={setPrDialogOpen}>
        <DialogContent className="workspace-modal git-confirm-modal">
          <DialogHeader className="workspace-modal-head">
            <DialogTitle>Pull request actions</DialogTitle>
            <DialogDescription className="settings-caption">Run PR commands against the selected pull request.</DialogDescription>
          </DialogHeader>
          <div className="workspace-modal-section">
            <p className="settings-caption">
              Selected PR: {selectedPr ? `#${selectedPr.number} ${selectedPr.title}` : "No PR selected"}
            </p>
            <div className="settings-inline-actions">
              <Button
                type="button"
                variant="subtle"
                className="subtle-btn"
                disabled={!selectedPr || busyAction}
                onClick={() => {
                  if (!selectedPr) {
                    return;
                  }
                  void openPrDetail(selectedPr.number);
                  setPrDialogOpen(false);
                }}
              >
                Open details
              </Button>
              <Button
                type="button"
                variant="subtle"
                className="subtle-btn"
                disabled={!selectedPr || busyAction}
                onClick={() => {
                  void checkoutSelectedPr();
                }}
              >
                Checkout PR
              </Button>
              <Button
                type="button"
                variant="subtle"
                className="subtle-btn"
                disabled={!selectedPr || busyAction}
                onClick={() => {
                  if (!selectedPr) {
                    return;
                  }
                  setConfirmState({
                    title: "Squash Merge Pull Request",
                    message: `Merge PR #${selectedPr.number} with squash strategy?`,
                    confirmLabel: "Squash Merge",
                    onConfirm: async () => {
                      const response = await ghPrMergeSquash({
                        repoRoot,
                        number: selectedPr.number,
                        deleteBranch: false,
                      });
                      setFeedback(response.output);
                      await refreshPrs();
                      await refreshStatusAndBranches();
                    },
                  });
                  setPrDialogOpen(false);
                }}
              >
                Squash merge
              </Button>
            </div>
          </div>
          <div className="workspace-modal-section">
            <label className="input-label" htmlFor="git-pr-comment">Comment</label>
            <Textarea
              id="git-pr-comment"
              className="text-input"
              rows={4}
              placeholder="Write a PR comment"
              value={prCommentDraft}
              onChange={(event) => setPrCommentDraft(event.currentTarget.value)}
            />
          </div>
          <DialogFooter className="workspace-modal-actions">
            <Button type="button" variant="subtle" className="subtle-btn" onClick={() => setPrDialogOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              className="primary-btn"
              disabled={!selectedPr || prCommentDraft.trim().length === 0 || busyAction}
              onClick={() => {
                void commentOnSelectedPr();
              }}
            >
              Comment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={issueDialogOpen} onOpenChange={setIssueDialogOpen}>
        <DialogContent className="workspace-modal git-confirm-modal">
          <DialogHeader className="workspace-modal-head">
            <DialogTitle>Issue actions</DialogTitle>
            <DialogDescription className="settings-caption">Comment and update labels/assignees for the selected issue.</DialogDescription>
          </DialogHeader>
          <div className="workspace-modal-section">
            <p className="settings-caption">
              Selected issue: {selectedIssue ? `#${selectedIssue.number} ${selectedIssue.title}` : "No issue selected"}
            </p>
            <div className="settings-inline-actions">
              <Button
                type="button"
                variant="subtle"
                className="subtle-btn"
                disabled={!selectedIssue || busyAction}
                onClick={() => {
                  if (!selectedIssue) {
                    return;
                  }
                  void openIssueDetail(selectedIssue.number);
                  setIssueDialogOpen(false);
                }}
              >
                Open details
              </Button>
            </div>
          </div>
          <div className="workspace-modal-section">
            <label className="input-label" htmlFor="git-issue-comment">Comment</label>
            <Textarea
              id="git-issue-comment"
              className="text-input"
              rows={4}
              placeholder="Write an issue comment"
              value={issueCommentDraft}
              onChange={(event) => setIssueCommentDraft(event.currentTarget.value)}
            />
            <div className="settings-inline-actions">
              <Button
                type="button"
                variant="primary"
                className="primary-btn"
                disabled={!selectedIssue || issueCommentDraft.trim().length === 0 || busyAction}
                onClick={() => {
                  void commentOnSelectedIssue();
                }}
              >
                Add comment
              </Button>
            </div>
          </div>
          <div className="workspace-modal-section">
            <label className="input-label" htmlFor="git-issue-add-labels">Add labels (comma separated)</label>
            <Input
              id="git-issue-add-labels"
              className="text-input"
              value={issueAddLabelsDraft}
              onChange={(event) => setIssueAddLabelsDraft(event.currentTarget.value)}
            />
            <label className="input-label" htmlFor="git-issue-remove-labels">Remove labels (comma separated)</label>
            <Input
              id="git-issue-remove-labels"
              className="text-input"
              value={issueRemoveLabelsDraft}
              onChange={(event) => setIssueRemoveLabelsDraft(event.currentTarget.value)}
            />
            <div className="settings-inline-actions">
              <Button
                type="button"
                variant="subtle"
                className="subtle-btn"
                disabled={busyAction || (parseCsvList(issueAddLabelsDraft).length === 0 && parseCsvList(issueRemoveLabelsDraft).length === 0)}
                onClick={() => {
                  void editSelectedIssueLabels();
                }}
              >
                Apply labels
              </Button>
            </div>
          </div>
          <div className="workspace-modal-section">
            <label className="input-label" htmlFor="git-issue-add-assignees">Add assignees (comma separated)</label>
            <Input
              id="git-issue-add-assignees"
              className="text-input"
              value={issueAddAssigneesDraft}
              onChange={(event) => setIssueAddAssigneesDraft(event.currentTarget.value)}
            />
            <label className="input-label" htmlFor="git-issue-remove-assignees">Remove assignees (comma separated)</label>
            <Input
              id="git-issue-remove-assignees"
              className="text-input"
              value={issueRemoveAssigneesDraft}
              onChange={(event) => setIssueRemoveAssigneesDraft(event.currentTarget.value)}
            />
          </div>
          <DialogFooter className="workspace-modal-actions">
            <Button type="button" variant="subtle" className="subtle-btn" onClick={() => setIssueDialogOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              className="primary-btn"
              disabled={busyAction || (parseCsvList(issueAddAssigneesDraft).length === 0 && parseCsvList(issueRemoveAssigneesDraft).length === 0)}
              onClick={() => {
                void editSelectedIssueAssignees();
              }}
            >
              Apply assignees
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GitActionConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        confirmLabel={confirmState?.confirmLabel ?? "Confirm"}
        busy={confirmBusy}
        onCancel={() => {
          if (confirmBusy) {
            return;
          }
          setConfirmState(null);
        }}
        onConfirm={() => {
          if (!confirmState) {
            return;
          }
          setConfirmBusy(true);
          void confirmState.onConfirm()
            .catch((error) => {
              setPanelError(activePanel, String(error));
            })
            .finally(() => {
              setConfirmBusy(false);
              setConfirmState(null);
            });
        }}
      />
    </section>
  );
}
