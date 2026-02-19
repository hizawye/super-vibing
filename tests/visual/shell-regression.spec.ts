import { expect, test, type Page } from "@playwright/test";

const E2E_STORAGE_KEY = "super-vibing:e2e-payload";
const E2E_REPO_ROOT = "/tmp/super-vibing-e2e/repo";
const FIXED_TIMESTAMP = "2026-02-19T12:00:00.000Z";

type AppSection = "terminal" | "git" | "worktrees";

interface SeedOptions {
  activeSection?: AppSection;
  paneCount?: number;
}

function buildPaneOrder(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `pane-${index + 1}`);
}

function buildSeedPayload({ activeSection = "terminal", paneCount = 3 }: SeedOptions): unknown {
  const paneOrder = buildPaneOrder(paneCount);
  const panes = Object.fromEntries(
    paneOrder.map((paneId, index) => [
      paneId,
      {
        id: paneId,
        title: `Pane ${index + 1}`,
        cwd: E2E_REPO_ROOT,
        worktreePath: E2E_REPO_ROOT,
        shell: "e2e-shell",
        status: "idle",
        lastSubmittedCommand: "",
      },
    ]),
  );

  return {
    version: 2,
    session: {
      workspaces: [
        {
          id: "workspace-main",
          name: "Workspace 1",
          repoRoot: E2E_REPO_ROOT,
          branch: "main",
          worktreePath: E2E_REPO_ROOT,
          layoutMode: "tiling",
          paneCount,
          paneOrder,
          panes,
          layouts: [],
          zoomedPaneId: null,
          agentAllocation: [],
          createdAt: FIXED_TIMESTAMP,
          updatedAt: FIXED_TIMESTAMP,
        },
      ],
      activeWorkspaceId: "workspace-main",
      activeSection,
      echoInput: false,
      discordPresenceEnabled: false,
      uiPreferences: {
        theme: "apple-dark",
        reduceMotion: true,
        highContrastAssist: false,
        density: "compact",
      },
      agentStartupDefaults: {
        claude: "claude",
        codex: "codex",
        gemini: "gemini",
        cursor: "cursor-agent",
        opencode: "opencode",
      },
    },
    snapshots: [],
    blueprints: [],
  };
}

async function openSeededApp(page: Page, options: SeedOptions = {}): Promise<void> {
  const payload = buildSeedPayload(options);
  await page.addInitScript(
    ({ storageKey, state }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    },
    {
      storageKey: E2E_STORAGE_KEY,
      state: payload,
    },
  );

  await page.goto("/");
  await expect(page.locator("main.app-shell")).toBeVisible();
  await expect(page.getByText("Bootstrapping workspace...")).toHaveCount(0);
}

async function openSectionFromSidebar(page: Page, sectionLabel: "Git" | "Worktrees"): Promise<void> {
  await page.getByRole("button", { name: "Open navigation" }).click();
  const sidebar = page.locator("aside.app-sidebar");
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole("button", { name: sectionLabel, exact: true }).click();
}

test("terminal compact baseline", async ({ page }) => {
  await openSeededApp(page, { activeSection: "terminal", paneCount: 3 });
  await expect(page.locator(".pane-card")).toHaveCount(3);
  await expect(page.locator(".terminal-body .xterm")).toHaveCount(3);
  await expect(page.locator(".terminal-surface")).toHaveScreenshot("terminal-compact-grid.png");
});

test("git control center baseline", async ({ page }) => {
  await openSeededApp(page, { activeSection: "terminal", paneCount: 3 });
  await openSectionFromSidebar(page, "Git");
  await expect(page.getByRole("heading", { name: "Git Control Center" })).toBeVisible();
  await expect(page.locator(".git-row").first()).toBeVisible();
  await expect(page.locator(".git-shell")).toHaveScreenshot("git-control-center.png", {
    mask: [page.locator(".git-tab-btn small")],
  });
});

test("worktree manager baseline", async ({ page }) => {
  await openSeededApp(page, { activeSection: "terminal", paneCount: 3 });
  await openSectionFromSidebar(page, "Worktrees");
  await expect(page.getByRole("heading", { name: "Worktree Manager" })).toBeVisible();
  await expect(page.locator(".worktree-row").first()).toBeVisible();
  await expect(page.locator(".worktree-shell")).toHaveScreenshot("worktree-manager.png", {
    mask: [page.getByText(/Last sync:/)],
  });
});
