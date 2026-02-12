import type { Layout } from "react-grid-layout";

export type PaneMoveDirection = "left" | "right" | "up" | "down";

interface Point {
  x: number;
  y: number;
}

interface Candidate {
  paneId: string;
  axisDistance: number;
  crossDistance: number;
  orderIndex: number;
}

function centerOf(layout: Layout): Point {
  return {
    x: layout.x + layout.w / 2,
    y: layout.y + layout.h / 2,
  };
}

function candidateForDirection(
  source: Point,
  target: Point,
  paneId: string,
  direction: PaneMoveDirection,
  orderIndex: number,
): Candidate | null {
  if (direction === "left") {
    const axisDistance = source.x - target.x;
    if (axisDistance <= 0) {
      return null;
    }
    return { paneId, axisDistance, crossDistance: Math.abs(source.y - target.y), orderIndex };
  }

  if (direction === "right") {
    const axisDistance = target.x - source.x;
    if (axisDistance <= 0) {
      return null;
    }
    return { paneId, axisDistance, crossDistance: Math.abs(source.y - target.y), orderIndex };
  }

  if (direction === "up") {
    const axisDistance = source.y - target.y;
    if (axisDistance <= 0) {
      return null;
    }
    return { paneId, axisDistance, crossDistance: Math.abs(source.x - target.x), orderIndex };
  }

  const axisDistance = target.y - source.y;
  if (axisDistance <= 0) {
    return null;
  }
  return { paneId, axisDistance, crossDistance: Math.abs(source.x - target.x), orderIndex };
}

export function findDirectionalPaneTarget(
  paneOrder: string[],
  layouts: Layout[],
  focusedPaneId: string,
  direction: PaneMoveDirection,
): string | null {
  const orderIndexByPane = new Map(paneOrder.map((paneId, index) => [paneId, index]));
  const layoutByPane = new Map(layouts.map((layout) => [layout.i, layout]));
  const sourceLayout = layoutByPane.get(focusedPaneId);
  if (!sourceLayout) {
    return null;
  }

  const sourceCenter = centerOf(sourceLayout);
  const candidates = paneOrder
    .filter((paneId) => paneId !== focusedPaneId)
    .map((paneId) => {
      const layout = layoutByPane.get(paneId);
      if (!layout) {
        return null;
      }
      const orderIndex = orderIndexByPane.get(paneId) ?? Number.MAX_SAFE_INTEGER;
      return candidateForDirection(sourceCenter, centerOf(layout), paneId, direction, orderIndex);
    })
    .filter((candidate): candidate is Candidate => Boolean(candidate));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (a.axisDistance !== b.axisDistance) {
      return a.axisDistance - b.axisDistance;
    }
    if (a.crossDistance !== b.crossDistance) {
      return a.crossDistance - b.crossDistance;
    }
    return a.orderIndex - b.orderIndex;
  });

  return candidates[0]?.paneId ?? null;
}
