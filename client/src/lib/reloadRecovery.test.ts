import assert from "node:assert/strict";
import test from "node:test";
import { forceHardReload, recoverStaleChunk } from "../components/AppErrorBoundary";

test("chunk recovery preserves the reload marker and unrelated session state", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const values = new Map<string, string>([["existing-session-value", "preserved"]]);
  const navigations: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: "https://app.test/work", replace: (url: string) => navigations.push(url) } } });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) } });
  try {
    const error = new Error("Failed to fetch dynamically imported module");
    assert.equal(recoverStaleChunk(error), true);
    assert.equal(recoverStaleChunk(error), false);
    assert.equal(navigations.length, 1);
    assert.equal(values.get("existing-session-value"), "preserved");
    forceHardReload();
    assert.equal(navigations.length, 2);
    assert.equal(values.get("existing-session-value"), "preserved");
    assert.equal(recoverStaleChunk(new Error("Unrelated render failure")), false);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
    if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage); else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("blocked session storage leaves manual recovery available without throwing", () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => { throw new Error("Storage disabled"); } });
  try {
    assert.equal(recoverStaleChunk(new Error("Loading chunk failed")), false);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage); else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
