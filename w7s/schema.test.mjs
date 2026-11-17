import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { appendD1AuditEvent } from "./audit-chain.mjs";
import { computeAuditRowHash } from "../src/lib/services/audit.ts";

test("D1 migrations enforce the envelope, signer and audit constraints", async () => {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      compatibilityDate: "2026-08-06",
      d1Databases: ["DB"],
    }),
  );
  try {
    const db = await runtime.getD1Database("DB");
    for (const name of [
      "0001_rate_limits.sql",
      "0002_auth.sql",
      "0003_envelopes.sql",
      "0004_settings_templates.sql",
    ]) {
      const sql = await readFile(
        new URL(`./migrations/${name}`, import.meta.url),
        "utf8",
      );
      for (const statement of sql.split(";").filter((part) => part.trim())) {
        await db.prepare(statement).run();
      }
    }
    await db
      .prepare(
        'INSERT INTO "user" (id, name, email, "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)',
      )
      .bind("u1", "User", "u@example.test", 1, 1)
      .run();
    await db
      .prepare(
        "INSERT INTO envelopes (id, user_id, title, source_pdf_key, source_pdf_filename, source_pdf_size_bytes, page_count, source_pdf_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind("e1", "u1", "Document", "pdf", "doc.pdf", 1, 1, "a".repeat(64))
      .run();
    await db
      .prepare(
        "INSERT INTO signers (id, envelope_id, name, email, sign_order) VALUES (?, ?, ?, ?, ?)",
      )
      .bind("s1", "e1", "Signer", "s@example.test", 1)
      .run();
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO signers (id, envelope_id, name, email, sign_order) VALUES (?, ?, ?, ?, ?)",
        )
        .bind("s2", "e1", "Other", "other@example.test", 1)
        .run(),
    );
    await assert.rejects(
      db
        .prepare(
          "UPDATE signers SET role = 'cc', status = 'notified' WHERE id = 's1'",
        )
        .run(),
    );
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO audit_events (id, envelope_id, event, actor_type) VALUES ('a1', 'missing', 'signed', 'signer')",
        )
        .run(),
    );
    await db
      .prepare(
        "INSERT INTO audit_events (id, envelope_id, event, actor_type, sequence) VALUES ('a1', 'e1', 'signer_corrected', 'sender', 1)",
      )
      .run();
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO audit_events (id, envelope_id, event, actor_type, sequence) VALUES ('a2', 'e1', 'signed', 'signer', 1)",
        )
        .run(),
    );
    await db
      .prepare(
        "INSERT INTO app_settings (created_at, updated_at) VALUES (1, 1)",
      )
      .run();
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO app_settings (id, created_at, updated_at) VALUES (2, 1, 1)",
        )
        .run(),
    );
    await assert.rejects(
      db.prepare("UPDATE app_settings SET brand_color = '#zzzzzz'").run(),
    );
    await assert.rejects(
      db
        .prepare("UPDATE app_settings SET logo_content_type = 'image/png'")
        .run(),
    );
    await db
      .prepare(
        "INSERT INTO envelopes (id, user_id, title, source_pdf_key, source_pdf_filename, source_pdf_size_bytes, page_count, source_pdf_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "e2",
        "u1",
        "Second document",
        "pdf",
        "doc.pdf",
        1,
        1,
        "a".repeat(64),
      )
      .run();
    const events = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        appendD1AuditEvent(
          db,
          {
            envelopeId: "e2",
            actorType: "sender",
            event: "viewed",
            metadata: { value: i },
          },
          20,
        ),
      ),
    );
    events.sort((a, b) => a.sequence - b.sequence);
    let lastHash = null;
    for (const [index, event] of events.entries()) {
      const { prevHash, rowHash, ...fields } = event;
      assert.equal(event.sequence, index + 1);
      assert.equal(prevHash, lastHash);
      assert.equal(rowHash, computeAuditRowHash(lastHash, fields));
      lastHash = rowHash;
    }
  } finally {
    await runtime.dispose();
  }
});
