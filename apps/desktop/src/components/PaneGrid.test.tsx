import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { PaneGrid } from "./PaneGrid";

vi.mock("react-grid-layout", () => {
  const MockGrid = ({
    children,
    onLayoutChange,
    layout,
  }: {
    children: ReactNode;
    onLayoutChange?: (layout: Array<Record<string, unknown>>) => void;
    layout: Array<Record<string, unknown>>;
  }) => (
    <div
      data-testid="mock-grid"
      onClick={() => {
        onLayoutChange?.(layout);
      }}
    >
      {children}
    </div>
  );

  return {
    default: MockGrid,
    WidthProvider: (component: typeof MockGrid) => component,
  };
});

vi.mock("./TerminalPane", () => ({
  TerminalPane: ({ paneId }: { paneId: string }) => <div data-testid={`terminal-${paneId}`} />,
}));

describe("PaneGrid", () => {
  const layouts = [
    { i: "pane-1", x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
    { i: "pane-2", x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  ];

  it("renders zoomed pane view with restore action", () => {
    const onLayoutsChange = vi.fn();
    const onToggleZoom = vi.fn();

    render(
      <PaneGrid
        workspaceId="workspace-1"
        paneIds={["pane-1", "pane-2"]}
        paneTitles={{ "pane-1": "pane-1", "pane-2": "pane-2" }}
        layouts={layouts}
        zoomedPaneId="pane-2"
        onLayoutsChange={onLayoutsChange}
        onToggleZoom={onToggleZoom}
      />,
    );

    expect(screen.getByTestId("terminal-pane-2")).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-pane-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onToggleZoom).toHaveBeenCalledWith("pane-2");
  });

  it("renders normal grid and emits layout updates", () => {
    const onLayoutsChange = vi.fn();
    const onToggleZoom = vi.fn();

    render(
      <PaneGrid
        workspaceId="workspace-1"
        paneIds={["pane-1", "pane-2"]}
        paneTitles={{ "pane-1": "pane-1", "pane-2": "pane-2" }}
        layouts={layouts}
        zoomedPaneId={null}
        onLayoutsChange={onLayoutsChange}
        onToggleZoom={onToggleZoom}
      />,
    );

    expect(screen.getByTestId("terminal-pane-1")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-pane-2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-grid"));
    expect(onLayoutsChange).toHaveBeenCalledWith(layouts);

    fireEvent.doubleClick(screen.getByText("pane-1"));
    expect(onToggleZoom).toHaveBeenCalledWith("pane-1");
  });
});
