import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import { TerminalPane } from "./TerminalPane";

const FluidGridLayout = WidthProvider(GridLayout);

interface PaneGridProps {
  paneIds: string[];
  layouts: Layout[];
  zoomedPaneId: string | null;
  onLayoutsChange: (next: Layout[]) => void;
  onToggleZoom: (paneId: string) => void;
}

export function PaneGrid({
  paneIds,
  layouts,
  zoomedPaneId,
  onLayoutsChange,
  onToggleZoom,
}: PaneGridProps) {
  if (zoomedPaneId) {
    return (
      <div className="zoom-grid">
        <div className="pane-card is-zoomed">
          <div className="pane-header" onDoubleClick={() => onToggleZoom(zoomedPaneId)}>
            <span>{zoomedPaneId}</span>
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => onToggleZoom(zoomedPaneId)}
            >
              Restore
            </button>
          </div>
          <TerminalPane paneId={zoomedPaneId} />
        </div>
      </div>
    );
  }

  return (
    <FluidGridLayout
      className="layout"
      layout={layouts}
      cols={12}
      rowHeight={110}
      margin={[12, 12]}
      onLayoutChange={onLayoutsChange}
      draggableHandle=".pane-header"
      resizeHandles={["se"]}
    >
      {paneIds.map((paneId) => (
        <div key={paneId} className="pane-card">
          <div className="pane-header" onDoubleClick={() => onToggleZoom(paneId)}>
            <span>{paneId}</span>
            <button type="button" className="toolbar-btn" onClick={() => onToggleZoom(paneId)}>
              Zoom
            </button>
          </div>
          <TerminalPane paneId={paneId} />
        </div>
      ))}
    </FluidGridLayout>
  );
}
