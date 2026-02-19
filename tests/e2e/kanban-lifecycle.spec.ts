import { expect, type Page, test } from "@playwright/test";
import { waitForAppReady } from "./helpers";

function taskCardInColumn(page: Page, columnTitle: string, taskTitle: string) {
  return page
    .locator(".kanban-column")
    .filter({ has: page.getByRole("heading", { name: columnTitle, exact: true }) })
    .locator(".kanban-card")
    .filter({ has: page.getByText(taskTitle, { exact: true }) });
}

test("runs a kanban task through create, execute, complete, and done", async ({ page }) => {
  const taskTitle = `E2E task ${Date.now()}`;
  const taskCommand = "echo e2e-kanban";

  await page.goto("/kanban");
  await waitForAppReady(page);

  await expect(page).toHaveURL(/\/kanban$/);
  await expect(page.locator("[data-section-page='kanban']")).toBeVisible();

  const createTaskSection = page.locator(".kanban-create");
  await createTaskSection.getByRole("textbox", { name: "Task title" }).fill(taskTitle);
  await createTaskSection.getByRole("textbox", { name: "Command" }).fill(taskCommand);
  await createTaskSection.getByRole("textbox", { name: "Description" }).fill("Validate Kanban lifecycle in browser E2E mode");
  await createTaskSection.getByRole("button", { name: "Create task" }).click();

  const todoCard = taskCardInColumn(page, "Todo", taskTitle);
  await expect(todoCard).toBeVisible();

  await todoCard.getByRole("button", { name: "Run" }).click();

  const inProgressCard = taskCardInColumn(page, "In Progress", taskTitle);
  await expect(inProgressCard).toBeVisible();
  await expect(inProgressCard.getByRole("button", { name: "Running..." })).toBeVisible();

  await inProgressCard.getByRole("button", { name: "Mark Success" }).click();

  const reviewCard = taskCardInColumn(page, "Review", taskTitle);
  await expect(reviewCard).toBeVisible();

  await reviewCard.getByRole("button", { name: "Refresh Logs" }).click();
  await expect(reviewCard.locator("pre.kanban-log-preview")).toContainText(taskCommand);

  await reviewCard.getByRole("button", { name: "Done" }).click();

  const doneCard = taskCardInColumn(page, "Done", taskTitle);
  await expect(doneCard).toBeVisible();
  await expect(doneCard).toContainText(taskCommand);
});
