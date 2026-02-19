import { expect, type Page } from "@playwright/test";

export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("main.app-shell")).toBeVisible();
  await expect(page.locator("main.app-shell.app-loading")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".top-chrome")).toBeVisible();
}

export async function openSidebar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("aside.app-sidebar.open")).toBeVisible();
}

export async function selectSidebarSection(
  page: Page,
  sectionLabel: RegExp,
  sectionId: string,
): Promise<void> {
  await openSidebar(page);
  await page.locator("aside.app-sidebar.open").getByRole("button", { name: sectionLabel }).click();
  await expect(page.locator(`[data-section-page='${sectionId}']`)).toBeVisible();
}
