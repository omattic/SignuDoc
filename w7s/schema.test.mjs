import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { appendD1AuditEvent } from "./audit-chain.mjs";
import { computeAuditRowHash } from "../src/lib/services/audit.ts";
import {
  closeSignupUntilSetupFinishes,
  markEmailReady,
  readSetupState,
  readStoredSettings,
  saveSettings,
} from "../src/lib/settings.ts";

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
    assert.deepEqual(await readSetupState(db), { status: "unmigrated" });
    assert.equal(await readStoredSettings(db), null);
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
    assert.deepEqual(await readSetupState(db), { status: "fresh" });
    assert.equal(await readStoredSettings(db), null);
    await db
      .prepare(
        'INSERT INTO "user" (id, name, email, "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)',
      )
      .bind("u1", "User", "u@example.test", 1, 1)
      .run();
    assert.deepEqual(await readSetupState(db), { status: "unclaimed" });
    await db
      .prepare('UPDATE "user" SET role = ? WHERE id = ?')
      .bind("admin", "u1")
      .run();
    assert.deepEqual(await readSetupState(db), { status: "complete" });
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
    const settings = await readStoredSettings(db);
    assert.deepEqual(settings.allowedEmailDomains, []);
    assert.equal(settings.part11Mode, false);
    await db
      .prepare(
        "UPDATE app_settings SET allowed_email_domains = ?, part11_mode = 1 WHERE id = 1",
      )
      .bind(JSON.stringify(["example.test"]))
      .run();
    const updatedSettings = await readStoredSettings(db);
    assert.deepEqual(updatedSettings.allowedEmailDomains, ["example.test"]);
    assert.equal(updatedSettings.part11Mode, true);
    await db
      .prepare(
        "UPDATE app_settings SET signup_mode = 'open', sender_address = 'sender@example.test'",
      )
      .run();
    await closeSignupUntilSetupFinishes(db);
    assert.equal((await readStoredSettings(db)).signupMode, "open");
    await markEmailReady(
      true,
      { senderAddress: "wrong@example.test", senderAddressFromEnv: false },
      db,
    );
    assert.equal((await readStoredSettings(db)).emailReadyAt, null);
    await markEmailReady(
      true,
      { senderAddress: "sender@example.test", senderAddressFromEnv: false },
      db,
    );
    assert.ok((await readStoredSettings(db)).emailReadyAt);
    await markEmailReady(
      false,
      { senderAddress: "wrong@example.test", senderAddressFromEnv: false },
      db,
    );
    assert.ok((await readStoredSettings(db)).emailReadyAt);
    await markEmailReady(
      false,
      { senderAddress: "sender@example.test", senderAddressFromEnv: false },
      db,
    );
    assert.equal((await readStoredSettings(db)).emailReadyAt, null);
    await Promise.all([
      saveSettings({ organizationName: "SignuDoc D1" }, db),
      saveSettings({ part11Mode: false }, db),
      saveSettings({ allowedEmailDomains: ["example.test"] }, db),
    ]);
    const concurrentSettings = await readStoredSettings(db);
    assert.equal(concurrentSettings.organizationName, "SignuDoc D1");
    assert.equal(concurrentSettings.part11Mode, false);
    assert.deepEqual(concurrentSettings.allowedEmailDomains, ["example.test"]);
    await markEmailReady(
      true,
      { senderAddress: "sender@example.test", senderAddressFromEnv: false },
      db,
    );
    await saveSettings({ senderAddress: "sender@example.test" }, db);
    assert.ok((await readStoredSettings(db)).emailReadyAt);
    await saveSettings({ senderAddress: "new@example.test" }, db);
    assert.equal((await readStoredSettings(db)).emailReadyAt, null);
    const explicitReady = await saveSettings(
      { senderAddress: "third@example.test", emailReadyAt: 123 },
      db,
    );
    assert.equal(explicitReady.emailReadyAt, 123);
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
    await db.prepare("DELETE FROM app_settings").run();
    assert.equal(
      (await saveSettings({ organizationName: "New install" }, db)).signupMode,
      "closed",
    );
    await db.prepare("DELETE FROM app_settings").run();
    await closeSignupUntilSetupFinishes(db);
    assert.equal((await readStoredSettings(db)).signupMode, "closed");
  } finally {
    await runtime.dispose();
  }
});
