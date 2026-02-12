import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsSection } from "./App";
import * as updater from "./lib/updater";

vi.mock("./lib/updater", async () => {
  const actual = await vi.importActual<typeof import("./lib/updater")>("./lib/updater");
  return {
    ...actual,
    updatesSupported: vi.fn(() => true),
    checkForPendingUpdate: vi.fn(),
  };
});

describe("SettingsSection updater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows up-to-date message when no update is available", async () => {
    vi.mocked(updater.checkForPendingUpdate).mockResolvedValueOnce(null);

    const user = userEvent.setup();
    render(
      <SettingsSection
        themeId="apple-dark"
        reduceMotion={false}
        highContrastAssist={false}
        density="comfortable"
        onThemeChange={() => {}}
        onReduceMotionChange={() => {}}
        onHighContrastAssistChange={() => {}}
        onDensityChange={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /check for updates/i }));

    expect(await screen.findByText("You're on the latest version.")).toBeInTheDocument();
  });

  it("surfaces a helpful message when update check fails", async () => {
    vi.mocked(updater.checkForPendingUpdate).mockRejectedValueOnce(new Error("network unreachable"));

    const user = userEvent.setup();
    render(
      <SettingsSection
        themeId="apple-dark"
        reduceMotion={false}
        highContrastAssist={false}
        density="comfortable"
        onThemeChange={() => {}}
        onReduceMotionChange={() => {}}
        onHighContrastAssistChange={() => {}}
        onDensityChange={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /check for updates/i }));

    expect(
      await screen.findByText(/Unable to reach the update endpoint\. network unreachable/i),
    ).toBeInTheDocument();
  });
});
