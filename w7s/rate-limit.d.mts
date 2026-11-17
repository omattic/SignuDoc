import type { D1Database } from "@cloudflare/workers-types/index.ts";

export function consumeD1RateLimit(
  database: D1Database,
  input: { key: string; limit: number; now?: number; windowMs: number },
): Promise<{ allowed: boolean; retryAfterSeconds: number }>;

export function deleteExpiredD1RateLimits(
  database: D1Database,
  now?: number,
): Promise<number>;
