import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { consumeRateLimit } from "../src/lib/security/rate-limit.ts";

import {
  consumeD1RateLimit,
  deleteExpiredD1RateLimits,
} from "./rate-limit.mjs";

let runtime;
let database;
const start = 4_000_000_000_000;

before(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      compatibilityDate: "2026-08-06",
      d1Databases: ["DB"],
    }),
  );
  database = await runtime.getD1Database("DB");
  const sql = await readFile(
    new URL("./migrations/0001_rate_limits.sql", import.meta.url),
    "utf8",
  );
  for (const statement of sql.split(";").filter((part) => part.trim())) {
    await database.prepare(statement).run();
  }
});

after(async () => {
  await runtime?.dispose();
});

test("fixed windows, expiry and hashed keys match existing behavior", async () => {
  const key = `signing-token:${randomUUID()}`;
  const at = (offset) =>
    consumeD1RateLimit(database, {
      key,
      limit: 2,
      now: start + offset,
      windowMs: 60_000,
    });
  assert.deepEqual(await at(0), { allowed: true, retryAfterSeconds: 60 });
  assert.deepEqual(await at(1000), { allowed: true, retryAfterSeconds: 59 });
  assert.deepEqual(await at(15_000), { allowed: false, retryAfterSeconds: 45 });
  assert.deepEqual(await at(59_000), { allowed: false, retryAfterSeconds: 1 });
  assert.deepEqual(await at(60_000), { allowed: true, retryAfterSeconds: 60 });
  const stored = await database.prepare("SELECT key FROM rate_limits").all();
  assert.deepEqual(
    stored.results.map((row) => row.key),
    [createHash("sha256").update(key).digest("hex")],
  );
  assert.equal(await deleteExpiredD1RateLimits(database, start + 120_000), 1);
});

test("concurrent requests are counted exactly once", async () => {
  const key = `burst:${randomUUID()}`;
  const input = { key, limit: 5, now: start, windowMs: 60_000 };
  const decisions = await Promise.all(
    Array.from({ length: 40 }, () => consumeD1RateLimit(database, input)),
  );
  assert.equal(decisions.filter((decision) => decision.allowed).length, 5);
  const hash = createHash("sha256").update(key).digest("hex");
  const row = await database
    .prepare("SELECT count FROM rate_limits WHERE key = ?")
    .bind(hash)
    .first();
  assert.equal(row.count, 40);
});

test("database failures are returned to the caller", async () => {
  const broken = {
    prepare() {
      throw new Error("database unavailable");
    },
  };
  await assert.rejects(
    consumeD1RateLimit(broken, { key: "test", limit: 1, windowMs: 60_000 }),
    /database unavailable/,
  );
  await assert.rejects(
    consumeRateLimit(
      { key: "test", limit: 1, windowMs: 60_000 },
      { d1Database: broken },
    ),
    /database unavailable/,
  );
});

test("the application limiter accepts an explicit D1 binding", async () => {
  const input = {
    key: `app:${randomUUID()}`,
    limit: 1,
    now: start,
    windowMs: 60_000,
  };
  assert.equal(
    (await consumeRateLimit(input, { d1Database: database })).allowed,
    true,
  );
  assert.equal(
    (await consumeRateLimit(input, { d1Database: database })).allowed,
    false,
  );
});
