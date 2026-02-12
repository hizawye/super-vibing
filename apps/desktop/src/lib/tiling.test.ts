import { describe, expect, it } from "vitest";
import type { Layout } from "react-grid-layout";
import { generateTilingLayouts } from "./tiling";

function overlaps(a: Layout, b: Layout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("generateTilingLayouts", () => {
  it("creates non-overlapping row-major layouts with full-width rows for 1..16 panes", () => {
    for (let paneCount = 1; paneCount <= 16; paneCount += 1) {
      const paneOrder = Array.from({ length: paneCount }, (_, index) => `pane-${index + 1}`);
      const layouts = generateTilingLayouts(paneOrder);

      expect(layouts).toHaveLength(paneCount);
      expect(layouts.map((layout) => layout.i)).toEqual(paneOrder);

      const ids = new Set(layouts.map((layout) => layout.i));
      expect(ids.size).toBe(paneCount);

      const rowWidths = new Map<number, number>();
      layouts.forEach((layout) => {
        rowWidths.set(layout.y, (rowWidths.get(layout.y) ?? 0) + layout.w);
      });
      Array.from(rowWidths.values()).forEach((totalWidth) => {
        expect(totalWidth).toBe(12);
      });

      for (let left = 0; left < layouts.length; left += 1) {
        for (let right = left + 1; right < layouts.length; right += 1) {
          const a = layouts[left] as Layout;
          const b = layouts[right] as Layout;
          expect(overlaps(a, b)).toBe(false);
        }
      }
    }
  });
});
