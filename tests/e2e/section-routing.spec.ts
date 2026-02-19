import { expect, test } from "@playwright/test";
import { selectSidebarSection, waitForAppReady } from "./helpers";

test("syncs section route with sidebar navigation and browser history", async ({ page }) => {
  await page.goto("/worktrees");
  await waitForAppReady(page);

  await expect(page).toHaveURL(/\/worktrees$/);
  await expect(page.locator("[data-section-page='worktrees']")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worktree Manager" })).toBeVisible();

  await selectSidebarSection(page, /Git/i, "git");
  await expect(page).toHaveURL(/\/git$/);

  await selectSidebarSection(page, /Settings/i, "settings");
  await expect(page).toHaveURL(/\/settings$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/git$/);
  await expect(page.locator("[data-section-page='git']")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/worktrees$/);
  await expect(page.locator("[data-section-page='worktrees']")).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/git$/);
  await expect(page.locator("[data-section-page='git']")).toBeVisible();
});
