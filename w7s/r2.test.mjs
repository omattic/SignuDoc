import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createStorageService } from "../src/lib/services/storage.ts";

test("R2 storage preserves private objects and conditional writes", async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createR2StorageService } from './src/lib/services/storage/r2.ts';
      export default { async fetch(request, env) {
        const storage = createR2StorageService(env.FILES);
        const key = 'users/test/envelopes/original.pdf';
        const view = new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4);
        await storage.putObject({ key, body: view, contentType: 'application/pdf', keepExisting: true });
        await storage.putObject({ key, body: new Uint8Array([4]), contentType: 'text/plain', keepExisting: true });
        const head = await storage.headObject(key);
        const stored = await storage.getObject(key);
        const stream = await storage.getObjectStream(key);
        const streamed = Array.from(new Uint8Array(await new Response(stream.stream).arrayBuffer()));
        const raceKey = 'users/test/envelopes/race.pdf';
        await Promise.all([1, 2].map(value => storage.putObject({ key: raceKey, body: new Uint8Array([value]), contentType: 'application/pdf', keepExisting: true })));
        const raceWinner = Array.from((await storage.getObject(raceKey)).body)[0];
        await storage.putObject({ key: raceKey, body: new Uint8Array([3]), contentType: 'application/pdf', keepExisting: true });
        const raceAfter = Array.from((await storage.getObject(raceKey)).body)[0];
        await storage.deleteObject(key);
        const missing = await storage.headObject(key);
        let missingError = false;
        try { await storage.getObject(key); } catch (error) { missingError = error.name === 'StorageObjectNotFoundError'; }
        return Response.json({ head, data: Array.from(stored.body), streamed, missing, missingError, raceWinner, raceAfter });
      } }`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    external: ["node:*"],
  });
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-08-06",
      compatibilityFlags: ["nodejs_compat"],
      r2Buckets: ["FILES"],
    }),
  );
  try {
    const response = await runtime.dispatchFetch("https://example.test/");
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.deepEqual(result.data, [1, 2, 3]);
    assert.deepEqual(result.streamed, [1, 2, 3]);
    assert.equal(result.head.contentType, "application/pdf");
    assert.equal(result.head.contentLength, 3);
    assert.equal(result.missing.exists, false);
    assert.equal(result.missingError, true);
    assert.ok(result.raceWinner === 1 || result.raceWinner === 2);
    assert.equal(result.raceAfter, result.raceWinner);
    const factory = createStorageService({
      r2Bucket: await runtime.getR2Bucket("FILES"),
    });
    assert.equal((await factory.headObject("not-present")).exists, false);
  } finally {
    await runtime.dispose();
  }
});
