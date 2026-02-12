import { useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import type { LayoutMode } from "../types";
import { TerminalPane } from "./TerminalPane";

const FluidGridLayout = WidthProvider(GridLayout);
const GRID_MARGIN: [number, number] = [1, 1];
const GRID_CONTAINER_PADDING: [number, number] = [0, 0];
const DEFAULT_ROW_HEIGHT = 110;
const MIN_ROW_HEIGHT = 32;

interface PaneGridProps {
  workspaceId: string;
  isActive: boolean;
  paneIds: string[];
  layouts: Layout[];
  layoutMode: LayoutMode;
  zoomedPaneId: string | null;
  focusedPaneId: string | null;
  onLayoutsChange: (next: Layout[]) => void;
  onToggleZoom: (paneId: string) => void;
  onPaneFocus: (paneId: string) => void;
}

export function PaneGrid({
  workspaceId,
  isActive,
  paneIds,
  layouts,
  layoutMode,
  zoomedPaneId,
  focusedPaneId,
  onLayoutsChange,
  onToggleZoom,
  onPaneFocus,
}: PaneGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const nextHeight = Math.floor(entries[0]?.contentRect.height ?? 0);
      setContainerHeight((current) => (current === nextHeight ? current : nextHeight));
    });
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  const rowCount = useMemo(() => {
    const paneIdSet = new Set(paneIds);
    const relevantLayouts = layouts.filter((layout) => paneIdSet.has(layout.i));
    const rows = relevantLayouts.reduce((max, layout) => Math.max(max, layout.y + layout.h), 0);
    return Math.max(1, rows);
  }, [layouts, paneIds]);

  const rowHeight = useMemo(() => {
    if (containerHeight <= 0) {
      return DEFAULT_ROW_HEIGHT;
    }

    const marginY = GRID_MARGIN[1];
    const marginSpace = marginY * Math.max(0, rowCount - 1);
    const available = Math.max(0, containerHeight - marginSpace);
    return Math.max(MIN_ROW_HEIGHT, Math.floor(available / rowCount));
  }, [containerHeight, rowCount]);

  if (zoomedPaneId) {
    return (
      <div className="zoom-grid">
        <div className={`pane-card is-zoomed ${focusedPaneId === zoomedPaneId ? "is-focused" : ""}`}>
          <div
            className="pane-header"
            data-testid={`pane-handle-${zoomedPaneId}`}
            onDoubleClick={() => onToggleZoom(zoomedPaneId)}
            onMouseDown={() => onPaneFocus(zoomedPaneId)}
          />
          <TerminalPane
            workspaceId={workspaceId}
            paneId={zoomedPaneId}
            isActive={isActive}
            onFocusPane={onPaneFocus}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pane-grid-fit" ref={containerRef}>
      <FluidGridLayout
        className="layout"
        layout={layouts}
        cols={12}
        rowHeight={rowHeight}
        margin={GRID_MARGIN}
        containerPadding={GRID_CONTAINER_PADDING}
        onLayoutChange={layoutMode === "freeform" ? onLayoutsChange : undefined}
        draggableHandle={layoutMode === "freeform" ? ".pane-header.is-draggable" : undefined}
        isDraggable={layoutMode === "freeform"}
        isResizable={layoutMode === "freeform"}
        resizeHandles={layoutMode === "freeform" ? ["se"] : []}
      >
        {paneIds.map((paneId) => (
          <div key={paneId} className={`pane-card ${focusedPaneId === paneId ? "is-focused" : ""}`}>
            <div
              className={`pane-header ${layoutMode === "freeform" ? "is-draggable" : ""}`}
              data-testid={`pane-handle-${paneId}`}
              onDoubleClick={() => onToggleZoom(paneId)}
              onMouseDown={() => onPaneFocus(paneId)}
            />
            <TerminalPane workspaceId={workspaceId} paneId={paneId} isActive={isActive} onFocusPane={onPaneFocus} />
          </div>
        ))}
      </FluidGridLayout>
    </div>
  );
}
