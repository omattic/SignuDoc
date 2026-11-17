import { canonicalJson } from "../src/lib/utils/canonical-json.ts";

async function rowHash(previousHash, fields) {
  const value = `${previousHash ?? ""}\n${canonicalJson(fields)}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// This standalone append does not include other envelope changes. Callers
// must not use it where the audit row and a state change must commit together.
export async function appendD1AuditEvent(database, input, maxAttempts = 10) {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = input.createdAt ?? Math.floor(Date.now() / 1000);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const previous = await database
      .prepare(
        "SELECT sequence, row_hash FROM audit_events WHERE envelope_id = ?1 AND sequence IS NOT NULL ORDER BY sequence DESC LIMIT 1",
      )
      .bind(input.envelopeId)
      .first();
    const previousHash = previous?.row_hash ?? null;
    const previousSequence = previous?.sequence ?? 0;
    const fields = {
      actorEmail: input.actorEmail ?? null,
      actorType: input.actorType,
      createdAt,
      envelopeId: input.envelopeId,
      event: input.event,
      id,
      ipAddress: input.ipAddress ?? null,
      metadata: input.metadata ?? null,
      sequence: previousSequence + 1,
      userAgent: input.userAgent ?? null,
    };
    const hash = await rowHash(previousHash, fields);
    const inserted = await database
      .prepare(
        `INSERT INTO audit_events (id, envelope_id, event, actor_type, actor_email, ip_address, user_agent, metadata, created_at, sequence, prev_hash, row_hash)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
       WHERE COALESCE((SELECT sequence FROM audit_events WHERE envelope_id = ?2 AND sequence IS NOT NULL ORDER BY sequence DESC LIMIT 1), 0) = ?13
         AND (SELECT row_hash FROM audit_events WHERE envelope_id = ?2 AND sequence IS NOT NULL ORDER BY sequence DESC LIMIT 1) IS ?11
       RETURNING id`,
      )
      .bind(
        id,
        fields.envelopeId,
        fields.event,
        fields.actorType,
        fields.actorEmail,
        fields.ipAddress,
        fields.userAgent,
        fields.metadata === null ? null : canonicalJson(fields.metadata),
        createdAt,
        fields.sequence,
        previousHash,
        hash,
        previousSequence,
      )
      .first();
    if (inserted) return { ...fields, prevHash: previousHash, rowHash: hash };
  }
  throw new Error("Could not append the audit event after concurrent updates.");
}
