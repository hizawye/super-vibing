import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readDesktopFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function extractCssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? "";
}

describe("layout structure contract", () => {
  it("defines headed and body section layout variants", () => {
    const css = readDesktopFile("src/styles.css");
    expect(css).toMatch(/\.section-surface--headed\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\);/);
    expect(css).toMatch(/\.section-surface--body\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\);/);
  });

  it("does not force grid rows on base section-surface", () => {
    const css = readDesktopFile("src/styles.css");
    const baseSectionBlock = extractCssBlock(css, ".section-surface");
    expect(baseSectionBlock).toBeTruthy();
    expect(baseSectionBlock).not.toMatch(/grid-template-rows:/);
  });

  it("uses explicit section variants in headed and terminal surfaces", () => {
    const appTsx = readDesktopFile("src/App.tsx");
    const emptyState = readDesktopFile("src/components/EmptyStatePage.tsx");
    expect(appTsx).toContain('className="section-surface section-surface--headed"');
    expect(appTsx).toContain('className="section-surface section-surface--body terminal-surface"');
    expect(emptyState).toContain('className="section-surface section-surface--headed"');
  });
});
