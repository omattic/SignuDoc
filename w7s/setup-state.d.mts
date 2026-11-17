import type { D1Database } from "@cloudflare/workers-types/index.ts";

export function readD1SetupState(database: D1Database): Promise<{
  status: "unmigrated" | "fresh" | "complete" | "unclaimed";
}>;
