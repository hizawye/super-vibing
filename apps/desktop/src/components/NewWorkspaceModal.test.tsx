import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { NewWorkspaceModal } from "./NewWorkspaceModal";
import { pickDirectory } from "../lib/tauri";
import type { AgentAllocation } from "../types";

vi.mock("../lib/tauri", () => ({
  pickDirectory: vi.fn(),
}));

function defaultAgentAllocation(): AgentAllocation[] {
  return [
    { profile: "claude", label: "Claude", command: "claude", enabled: false, count: 0 },
    { profile: "codex", label: "Codex", command: "codex", enabled: false, count: 0 },
    { profile: "gemini", label: "Gemini", command: "gemini", enabled: false, count: 0 },
    { profile: "cursor", label: "Cursor", command: "cursor-agent", enabled: false, count: 0 },
    { profile: "opencode", label: "OpenCode", command: "opencode", enabled: false, count: 0 },
  ];
}

function renderModal(overrides?: Partial<ComponentProps<typeof NewWorkspaceModal>>) {
  const onClose = vi.fn();
  const onSubmit = vi.fn();

  render(
    <NewWorkspaceModal
      open
      defaultDirectory="/repo"
      agentDefaults={defaultAgentAllocation()}
      onClose={onClose}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );

  return { onClose, onSubmit };
}

describe("NewWorkspaceModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders browse and reset controls for directory selection", () => {
    renderModal();

    expect(screen.getByLabelText("Directory")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("updates directory when the picker returns a path", async () => {
    const user = userEvent.setup();
    vi.mocked(pickDirectory).mockResolvedValue("/repo/.worktrees/feature-path-picker");

    renderModal();
    await user.click(screen.getByRole("button", { name: "Browse" }));

    expect(pickDirectory).toHaveBeenCalledWith("/repo");
    expect(screen.getByLabelText("Directory")).toHaveValue("/repo/.worktrees/feature-path-picker");
  });

  it("keeps current directory when picker is canceled", async () => {
    const user = userEvent.setup();
    vi.mocked(pickDirectory).mockResolvedValue(null);

    renderModal();
    const directoryInput = screen.getByLabelText("Directory");
    await user.clear(directoryInput);
    await user.type(directoryInput, "/repo/custom");
    await user.click(screen.getByRole("button", { name: "Browse" }));

    expect(pickDirectory).toHaveBeenCalledWith("/repo/custom");
    expect(directoryInput).toHaveValue("/repo/custom");
  });

  it("shows an inline error when directory picker fails", async () => {
    const user = userEvent.setup();
    vi.mocked(pickDirectory).mockRejectedValue(new Error("dialog unavailable"));

    renderModal();
    await user.click(screen.getByRole("button", { name: "Browse" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("dialog unavailable");
    expect(screen.getByRole("button", { name: "Browse" })).toBeEnabled();
  });

  it("submits selected directory from picker", async () => {
    const user = userEvent.setup();
    vi.mocked(pickDirectory).mockResolvedValue("/repo/selected");

    const { onClose, onSubmit } = renderModal();
    await user.click(screen.getByRole("button", { name: "Browse" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      directory: "/repo/selected",
      paneCount: 1,
      name: "",
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
