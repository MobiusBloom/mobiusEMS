import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";

test("startup accepts HTTP but gates APIs until initialization completes", async () => {
  let ready = false;
  const server = createApp(() => ready).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${url}/api/v1/unknown`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "5");
    assert.equal((await response.json()).code, "APP_INITIALIZING");
    assert.equal((await fetch(`${url}/api/health`)).status, 503);
    ready = true;
    assert.equal((await fetch(`${url}/api/v1/unknown`)).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
