// D1 rate limits use one atomic statement per request. The caller supplies the
// request-scoped binding. Database errors propagate so that callers can make
// an explicit availability and security decision.
async function hashKey(key) {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function consumeD1RateLimit(database, input) {
  const now = input.now ?? Date.now();
  const key = await hashKey(input.key);
  const row = await database
    .prepare(
      `INSERT INTO rate_limits (key, count, expires_at)
       VALUES (?1, 1, ?2 + ?3)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.expires_at <= ?2 THEN 1
           ELSE min(rate_limits.count + 1, 1000000) END,
         expires_at = CASE WHEN rate_limits.expires_at <= ?2 THEN ?2 + ?3
           ELSE rate_limits.expires_at END
       RETURNING count, expires_at`,
    )
    .bind(key, now, input.windowMs)
    .first();

  if (!row) throw new Error("The D1 rate limit statement returned no row.");
  return {
    allowed: row.count <= input.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((row.expires_at - now) / 1000)),
  };
}

export async function deleteExpiredD1RateLimits(database, now = Date.now()) {
  const result = await database
    .prepare("DELETE FROM rate_limits WHERE expires_at <= ?1")
    .bind(now)
    .run();
  return result.meta.changes;
}
