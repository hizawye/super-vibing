import type { Layout } from "react-grid-layout";

const GRID_COLUMNS = 12;
const TILE_HEIGHT = 4;
const TILE_MIN_WIDTH = 2;
const TILE_MIN_HEIGHT = 2;

function buildColumnWidths(columnCount: number): number[] {
  const baseWidth = Math.floor(GRID_COLUMNS / columnCount);
  const remainder = GRID_COLUMNS % columnCount;

  return Array.from({ length: columnCount }, (_, index) => baseWidth + (index < remainder ? 1 : 0));
}

function buildColumnOffsets(widths: number[]): number[] {
  let offset = 0;
  return widths.map((width) => {
    const start = offset;
    offset += width;
    return start;
  });
}

export function generateTilingLayouts(paneOrder: string[]): Layout[] {
  if (paneOrder.length === 0) {
    return [];
  }

  const columns = Math.ceil(Math.sqrt(paneOrder.length));
  const layouts: Layout[] = [];
  let cursor = 0;
  let row = 0;

  while (cursor < paneOrder.length) {
    const panesInRow = Math.min(columns, paneOrder.length - cursor);
    const widths = buildColumnWidths(panesInRow);
    const offsets = buildColumnOffsets(widths);

    for (let column = 0; column < panesInRow; column += 1) {
      const paneId = paneOrder[cursor + column];
      const width = widths[column] ?? GRID_COLUMNS;

      layouts.push({
        i: paneId ?? `pane-${cursor + column + 1}`,
        x: offsets[column] ?? 0,
        y: row * TILE_HEIGHT,
        w: width,
        h: TILE_HEIGHT,
        minW: Math.min(TILE_MIN_WIDTH, width),
        minH: TILE_MIN_HEIGHT,
      });
    }

    cursor += panesInRow;
    row += 1;
  }

  return layouts;
}
