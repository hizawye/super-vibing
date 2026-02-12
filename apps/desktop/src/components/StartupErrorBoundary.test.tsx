import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartupErrorBoundary } from "./StartupErrorBoundary";

function CrashOnRender(): never {
  throw new Error("boom");
}

describe("StartupErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders crash fallback and shows details", async () => {
    const user = userEvent.setup();
    render(
      <StartupErrorBoundary>
        <CrashOnRender />
      </StartupErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: "Render failed" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText(/boom/i)).toBeInTheDocument();
  });

  it("triggers retry and reset callbacks", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onResetLocalData = vi.fn(async () => {});

    render(
      <StartupErrorBoundary onRetry={onRetry} onResetLocalData={onResetLocalData}>
        <CrashOnRender />
      </StartupErrorBoundary>,
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Reset local data" }));
    expect(onResetLocalData).toHaveBeenCalledTimes(1);
  });
});
