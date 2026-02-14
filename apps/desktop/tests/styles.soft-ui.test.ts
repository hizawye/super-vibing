import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStyles(): string {
  const cssPath = resolve(process.cwd(), "src/styles.css");
  return readFileSync(cssPath, "utf8");
}

describe("shadcn compact style contract", () => {
  it("uses token-driven section surfaces", () => {
    const css = readStyles();
    expect(css).toMatch(
      /\.section-surface\s*\{[\s\S]*?border:\s*1px\s+solid\s+var\(--border\);[\s\S]*?background:\s*var\(--card\);/,
    );
  });

  it("keeps sidebar and top chrome on card surfaces", () => {
    const css = readStyles();
    expect(css).toMatch(/\.app-sidebar\s*\{[\s\S]*?background:\s*var\(--card\);/);
    expect(css).toMatch(/\.top-chrome\s*\{[\s\S]*?background:\s*var\(--card\);/);
  });

  it("keeps pane focus styling tied to primary token", () => {
    const css = readStyles();
    expect(css).toMatch(/\.pane-card\.is-focused\s*\{[\s\S]*?border-color:[\s\S]*var\(--primary\)/);
  });

  it("removes legacy soft-ui override block", () => {
    const css = readStyles();
    expect(css).not.toContain("Soft UI Minimalism 2.0 Overrides");
  });
});
