import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

async function runtime(bindings = {}) {
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: await readFile(new URL("./worker.mjs", import.meta.url), "utf8"),
      compatibilityDate: "2026-08-06",
      d1Databases: ["DB"],
      bindings,
    }),
  );
}

test("native Worker reports database connectivity without claiming readiness", async () => {
  const mf = await runtime({
    DEPLOY_BRANCH: "main",
    DEPLOY_COMMIT: "abc123",
    DEPLOYED_AT: "2026-11-17T00:00:00.000Z",
  });
  try {
    const response = await mf.dispatchFetch("https://example.test/health");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      status: "not_ready",
      database: "connected",
      branch: "main",
      commitHash: "abc123",
      deployedAt: "2026-11-17T00:00:00.000Z",
    });
    assert.equal(
      (
        await mf.dispatchFetch("https://example.test/health", {
          method: "HEAD",
        })
      ).status,
      503,
    );
    const post = await mf.dispatchFetch("https://example.test/health", {
      method: "POST",
    });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    assert.equal(
      (await mf.dispatchFetch("https://example.test/api/auth/session")).status,
      404,
    );
  } finally {
    await mf.dispose();
  }
});

test("missing or failed database does not leak errors", async () => {
  const { default: worker } = await import("./worker.mjs");
  for (const env of [
    {},
    {
      DB: {
        prepare() {
          throw new Error("secret database detail");
        },
      },
    },
  ]) {
    const response = await worker.fetch(
      new Request("https://example.test/health"),
      env,
    );
    const text = await response.text();
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(text).database, "unavailable");
    assert.doesNotMatch(text, /secret/);
  }
});
