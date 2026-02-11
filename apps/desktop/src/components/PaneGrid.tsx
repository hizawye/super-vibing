import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import { TerminalPane } from "./TerminalPane";

const FluidGridLayout = WidthProvider(GridLayout);

interface PaneGridProps {
  workspaceId: string;
  paneIds: string[];
  paneTitles: Record<string, string>;
  layouts: Layout[];
  zoomedPaneId: string | null;
  onLayoutsChange: (next: Layout[]) => void;
  onToggleZoom: (paneId: string) => void;
}

export function PaneGrid({
  workspaceId,
  paneIds,
  paneTitles,
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
            <span>{paneTitles[zoomedPaneId] ?? zoomedPaneId}</span>
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => onToggleZoom(zoomedPaneId)}
            >
              Restore
            </button>
          </div>
          <TerminalPane workspaceId={workspaceId} paneId={zoomedPaneId} />
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
            <span>{paneTitles[paneId] ?? paneId}</span>
            <button type="button" className="toolbar-btn" onClick={() => onToggleZoom(paneId)}>
              Zoom
            </button>
          </div>
          <TerminalPane workspaceId={workspaceId} paneId={paneId} />
        </div>
      ))}
    </FluidGridLayout>
  );
}
