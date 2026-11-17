import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import fontkit from "@pdf-lib/fontkit";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("precompiled HarfBuzz module subsets real fonts in Workers", async () => {
  const bundle = await build({
    stdin: {
      contents: `import wasm from "./harfbuzz-subset.wasm";
        import { createFontSubsetter } from "./src/lib/services/pdf-fonts.ts";
        export default { async fetch(request, env) {
          const subset = await createFontSubsetter(wasm);
          const bytes = new Uint8Array(await request.arrayBuffer());
          return new Response(subset(bytes, [32, 65, 321, 322]));
        } };`,
      resolveDir: process.cwd(),
      sourcefile: "font-test.ts",
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    external: ["./harfbuzz-subset.wasm"],
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: [
        {
          type: "ESModule",
          path: "worker.mjs",
          contents: bundle.outputFiles[0].text,
        },
        {
          type: "CompiledWasm",
          path: "harfbuzz-subset.wasm",
          contents: await readFile(
            "node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm",
          ),
        },
      ],
      compatibilityDate: "2026-08-06",
      compatibilityFlags: ["nodejs_compat"],
    }),
  );
  try {
    const font = await readFile("src/assets/fonts/NotoSans-Regular.ttf");
    const response = await mf.dispatchFetch("https://example.test/", {
      method: "POST",
      body: font,
    });
    assert.equal(response.status, 200, await response.clone().text());
    const result = new Uint8Array(await response.arrayBuffer());
    assert.ok(result.length < font.length / 2);
    const parsed = fontkit.create(result);
    for (const codePoint of [65, 321, 322])
      assert.ok(parsed.hasGlyphForCodePoint(codePoint));
  } finally {
    await mf.dispose();
  }
});
