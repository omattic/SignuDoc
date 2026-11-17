import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";

async function runtime(bindings = {}) {
  const bundle = await build({
    entryPoints: [new URL("./worker.mjs", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
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

test("setup state follows the migrated D1 schema in the Worker", async () => {
  const mf = await runtime();
  try {
    const url = "https://example.test/api/setup/state";
    let response = await mf.dispatchFetch(url);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "unmigrated" });
    const db = await mf.getD1Database("DB");
    for (const name of ["0002_auth.sql", "0004_settings_templates.sql"]) {
      const sql = await readFile(
        new URL(`./migrations/${name}`, import.meta.url),
        "utf8",
      );
      for (const statement of sql.split(";").filter((part) => part.trim()))
        await db.prepare(statement).run();
    }
    response = await mf.dispatchFetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { status: "fresh" });
    await db
      .prepare(
        'INSERT INTO "user" (id, name, email, "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)',
      )
      .bind("u1", "User", "u@example.test", 1, 1)
      .run();
    assert.deepEqual(await (await mf.dispatchFetch(url)).json(), {
      status: "unclaimed",
    });
    await db
      .prepare('UPDATE "user" SET role = ? WHERE id = ?')
      .bind("admin", "u1")
      .run();
    assert.deepEqual(await (await mf.dispatchFetch(url)).json(), {
      status: "complete",
    });
    assert.equal((await mf.dispatchFetch(url, { method: "POST" })).status, 405);
  } finally {
    await mf.dispose();
  }
});
