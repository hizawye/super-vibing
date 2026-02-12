import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { PaneGrid } from "./PaneGrid";

vi.mock("react-grid-layout", () => {
  const MockGrid = ({
    children,
    onLayoutChange,
    layout,
    margin,
    containerPadding,
    isDraggable = true,
    isResizable = true,
  }: {
    children: ReactNode;
    onLayoutChange?: (layout: Array<Record<string, unknown>>) => void;
    layout: Array<Record<string, unknown>>;
    margin?: [number, number];
    containerPadding?: [number, number];
    isDraggable?: boolean;
    isResizable?: boolean;
  }) => (
    <div
      data-testid="mock-grid"
      data-draggable={String(isDraggable)}
      data-resizable={String(isResizable)}
      data-margin={JSON.stringify(margin ?? null)}
      data-container-padding={JSON.stringify(containerPadding ?? null)}
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
  TerminalPane: ({ paneId }: { paneId: string; onFocusPane?: (paneId: string) => void }) => (
    <div data-testid={`terminal-${paneId}`} />
  ),
}));

describe("PaneGrid", () => {
  const layouts = [
    { i: "pane-1", x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
    { i: "pane-2", x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  ];

  it("renders zoomed pane view and toggles zoom on handle double-click", () => {
    const onLayoutsChange = vi.fn();
    const onToggleZoom = vi.fn();

    render(
      <PaneGrid
        workspaceId="workspace-1"
        isActive
        paneIds={["pane-1", "pane-2"]}
        layouts={layouts}
        layoutMode="tiling"
        zoomedPaneId="pane-2"
        focusedPaneId="pane-2"
        onLayoutsChange={onLayoutsChange}
        onToggleZoom={onToggleZoom}
        onPaneFocus={vi.fn()}
      />,
    );

    expect(screen.getByTestId("terminal-pane-2")).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-pane-1")).not.toBeInTheDocument();

    fireEvent.doubleClick(screen.getByTestId("pane-handle-pane-2"));
    expect(onToggleZoom).toHaveBeenCalledWith("pane-2");
  });

  it("renders normal grid and emits layout updates", () => {
    const onLayoutsChange = vi.fn();
    const onToggleZoom = vi.fn();

    render(
      <PaneGrid
        workspaceId="workspace-1"
        isActive
        paneIds={["pane-1", "pane-2"]}
        layouts={layouts}
        layoutMode="freeform"
        zoomedPaneId={null}
        focusedPaneId="pane-1"
        onLayoutsChange={onLayoutsChange}
        onToggleZoom={onToggleZoom}
        onPaneFocus={vi.fn()}
      />,
    );

    expect(screen.getByTestId("terminal-pane-1")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-pane-2")).toBeInTheDocument();
    expect(screen.getByTestId("mock-grid")).toHaveAttribute("data-margin", "[1,1]");
    expect(screen.getByTestId("mock-grid")).toHaveAttribute("data-container-padding", "[0,0]");

    fireEvent.click(screen.getByTestId("mock-grid"));
    expect(onLayoutsChange).toHaveBeenCalledWith(layouts);

    fireEvent.doubleClick(screen.getByTestId("pane-handle-pane-1"));
    expect(onToggleZoom).toHaveBeenCalledWith("pane-1");
  });

  it("disables drag and resize in tiling mode", () => {
    render(
      <PaneGrid
        workspaceId="workspace-1"
        isActive
        paneIds={["pane-1", "pane-2"]}
        layouts={layouts}
        layoutMode="tiling"
        zoomedPaneId={null}
        focusedPaneId="pane-1"
        onLayoutsChange={vi.fn()}
        onToggleZoom={vi.fn()}
        onPaneFocus={vi.fn()}
      />,
    );

    expect(screen.getByTestId("mock-grid")).toHaveAttribute("data-draggable", "false");
    expect(screen.getByTestId("mock-grid")).toHaveAttribute("data-resizable", "false");
  });
});
