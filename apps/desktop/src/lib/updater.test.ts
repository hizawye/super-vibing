import { describe, expect, it } from "vitest";
import { formatUpdaterError } from "./updater";

describe("formatUpdaterError", () => {
  it("maps network-related failures to actionable text", () => {
    const message = formatUpdaterError(new Error("fetch timeout"), "fallback");
    expect(message).toContain("Unable to reach the update endpoint.");
    expect(message).toContain("fetch timeout");
  });

  it("maps signature failures to actionable text", () => {
    const message = formatUpdaterError(new Error("signature mismatch"), "fallback");
    expect(message).toContain("Update signature verification failed.");
  });

  it("maps metadata parse failures to actionable text", () => {
    const message = formatUpdaterError(new Error("json parse error"), "fallback");
    expect(message).toContain("Release metadata is invalid.");
  });

  it("falls back when error has no usable message", () => {
    expect(formatUpdaterError({}, "fallback")).toBe("fallback");
  });
});
