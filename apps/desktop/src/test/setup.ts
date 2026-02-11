import "@testing-library/jest-dom/vitest";

// `crypto.randomUUID` is used by store actions; keep deterministic tests.
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      randomUUID: () => "test-uuid",
    },
    configurable: true,
  });
}
