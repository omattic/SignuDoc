import type { D1Database } from "@cloudflare/workers-types/index.ts";

import {
  evaluateSignup,
  type SignupDecision,
  type SignupMode,
} from "../signup-policy.ts";
import type { SetupRequiredDecision } from "../settings.ts";

/** Reads the setup state and signup rule from the same D1 transaction. */
export async function evaluateD1SignupRequest(
  email: string,
  database: D1Database,
): Promise<SignupDecision | SetupRequiredDecision> {
  const [stateResult, policyResult] = await database.batch([
    database.prepare(`SELECT
      EXISTS (SELECT 1 FROM "user" WHERE role = 'admin') AS has_admin,
      EXISTS (SELECT 1 FROM "user") AS has_users,
      (SELECT setup_completed_at FROM app_settings WHERE id = 1) AS setup_completed_at`),
    database.prepare(
      "SELECT signup_mode, allowed_email_domains FROM app_settings WHERE id = 1",
    ),
  ]);
  const state = stateResult.results[0] as
    | {
        has_admin: number;
        has_users: number;
        setup_completed_at: number | null;
      }
    | undefined;
  if (!state) throw new Error("D1 setup state was not returned.");
  if (
    !state.has_admin &&
    !state.has_users &&
    state.setup_completed_at === null
  ) {
    return {
      allowed: false,
      code: "setup_required",
      message: "This site has not been set up yet.",
    };
  }
  const policy = policyResult.results[0] as
    { signup_mode: SignupMode; allowed_email_domains: string } | undefined;
  if (!policy)
    return evaluateSignup(email, {
      signupMode: "open",
      allowedEmailDomains: [],
    });
  const domains: unknown = JSON.parse(policy.allowed_email_domains);
  if (
    !Array.isArray(domains) ||
    !domains.every((domain) => typeof domain === "string")
  ) {
    throw new Error("D1 signup domains are invalid.");
  }
  return evaluateSignup(email, {
    signupMode: policy.signup_mode,
    allowedEmailDomains: domains,
  });
}
