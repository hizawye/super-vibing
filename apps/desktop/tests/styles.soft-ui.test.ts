import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSoftUiOverride(): string {
  const cssPath = resolve(process.cwd(), "src/styles.css");
  const css = readFileSync(cssPath, "utf8");
  const marker = "/* Soft UI Minimalism 2.0 Overrides */";
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start);
}

describe("soft UI style contract", () => {
  it("defines required structural and elevation tokens", () => {
    const softUi = readSoftUiOverride();
    expect(softUi).toContain("--space-structural: 24px;");
    expect(softUi).toContain("--canvas-base:");
    expect(softUi).toContain("--pane-elev-1:");
    expect(softUi).toContain("--chrome-tint:");
  });

  it("keeps top chrome separated by tint without hard border", () => {
    const softUi = readSoftUiOverride();
    expect(softUi).toMatch(/\.top-chrome\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*var\(--chrome-tint\);/);
  });

  it("does not introduce 1px border strokes in Soft UI override layer", () => {
    const softUi = readSoftUiOverride();
    expect(softUi).not.toMatch(/border:\s*1px/);
    expect(softUi).not.toMatch(/border-top:\s*1px/);
    expect(softUi).not.toMatch(/border-bottom:\s*1px/);
    expect(softUi).not.toMatch(/border-left:\s*1px/);
    expect(softUi).not.toMatch(/border-right:\s*1px/);
  });
});
