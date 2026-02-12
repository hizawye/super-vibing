import { describe, expect, it } from "vitest";
import type { Layout } from "react-grid-layout";
import { findDirectionalPaneTarget } from "./pane-focus";

function layout(i: string, x: number, y: number, w = 3, h = 3): Layout {
  return { i, x, y, w, h };
}

describe("findDirectionalPaneTarget", () => {
  it("selects the nearest pane in the requested direction", () => {
    const paneOrder = ["pane-1", "pane-2", "pane-3", "pane-4"];
    const layouts = [
      layout("pane-1", 0, 0),
      layout("pane-2", 3, 0),
      layout("pane-3", 0, 3),
      layout("pane-4", 3, 3),
    ];

    expect(findDirectionalPaneTarget(paneOrder, layouts, "pane-1", "right")).toBe("pane-2");
    expect(findDirectionalPaneTarget(paneOrder, layouts, "pane-1", "down")).toBe("pane-3");
    expect(findDirectionalPaneTarget(paneOrder, layouts, "pane-4", "left")).toBe("pane-3");
    expect(findDirectionalPaneTarget(paneOrder, layouts, "pane-4", "up")).toBe("pane-2");
  });

  it("prefers lower cross-axis distance before pane order", () => {
    const paneOrder = ["pane-1", "pane-2", "pane-3"];
    const layouts = [
      layout("pane-1", 6, 6),
      layout("pane-2", 3, 6),
      layout("pane-3", 3, 0),
    ];

    expect(findDirectionalPaneTarget(paneOrder, layouts, "pane-1", "left")).toBe("pane-2");
  });

  it("uses pane order as a stable tie-breaker", () => {
    const paneOrder = ["pane-1", "pane-3", "pane-2"];
    const layouts = [
      layout("pane-1", 6, 6),
      layout("pane-2", 3, 3),
      layout("pane-3", 3, 9),
    ];

    expect(findDirectionalPaneTarget(paneOrder, layouts, "pane-1", "left")).toBe("pane-3");
  });

  it("returns null when no pane exists in that direction", () => {
    const paneOrder = ["pane-1", "pane-2"];
    const layouts = [layout("pane-1", 0, 0), layout("pane-2", 3, 0)];

    expect(findDirectionalPaneTarget(paneOrder, layouts, "pane-1", "up")).toBeNull();
    expect(findDirectionalPaneTarget(paneOrder, layouts, "pane-2", "right")).toBeNull();
  });
});
