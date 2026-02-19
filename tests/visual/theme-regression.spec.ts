import { expect, test, type Page } from "@playwright/test";

async function openSettings(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("main.app-shell")).toBeVisible();
  await expect(page.getByText("Bootstrapping workspace...")).toHaveCount(0);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Appearance and Accessibility" })).toBeVisible();
}

async function captureThemeBaseline(
  page: Page,
  options: { themeLabel: "Dark" | "Light"; themeId: "apple-dark" | "apple-light"; screenshot: string },
): Promise<void> {
  await openSettings(page);
  await page.locator(".density-toggle").getByRole("button", { name: "Compact" }).click();
  await page.getByRole("radio", { name: new RegExp(`^${options.themeLabel}`) }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", options.themeId);
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator(".section-surface--headed")).toHaveScreenshot(options.screenshot);
}

test("dark compact theme baseline", async ({ page }) => {
  await captureThemeBaseline(page, {
    themeLabel: "Dark",
    themeId: "apple-dark",
    screenshot: "settings-dark-compact.png",
  });
});

test("light compact theme baseline", async ({ page }) => {
  await captureThemeBaseline(page, {
    themeLabel: "Light",
    themeId: "apple-light",
    screenshot: "settings-light-compact.png",
  });
});
