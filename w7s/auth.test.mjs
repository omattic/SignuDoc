import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createAppAuth } from "../src/lib/auth/server.ts";
import { runAsSetup } from "../src/lib/auth/setup-context.ts";
import { evaluateD1SignupRequest } from "../src/lib/auth/d1-signup.ts";

test("Better Auth can create an account, sign in, and revoke a D1 session", async () => {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      compatibilityDate: "2026-08-06",
      d1Databases: ["DB"],
    }),
  );

  try {
    const database = await runtime.getD1Database("DB");
    const migration = await readFile(
      new URL("./migrations/0002_auth.sql", import.meta.url),
      "utf8",
    );
    for (const statement of migration
      .split(";")
      .filter((part) => part.trim())) {
      await database.prepare(statement).run();
    }

    const auth = betterAuth({
      baseURL: "https://sign.example.test",
      secret: "test-only-secret-that-is-at-least-32-bytes-long",
      database,
      advanced: { database: { validateSchema: false } },
      emailAndPassword: { enabled: true, minPasswordLength: 15 },
    });

    const signup = await auth.api.signUpEmail({
      body: {
        name: "Test User",
        email: "test@example.test",
        password: "test-password-12345",
      },
      asResponse: true,
    });
    assert.equal(signup.status, 200, await signup.clone().text());

    const badLogin = await auth.api.signInEmail({
      body: { email: "test@example.test", password: "incorrect-password-123" },
      asResponse: true,
    });
    assert.equal(badLogin.status, 401);

    const login = await auth.api.signInEmail({
      body: { email: "test@example.test", password: "test-password-12345" },
      asResponse: true,
    });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie");
    assert.ok(cookie);
    const headers = new Headers({ cookie });
    const session = await auth.api.getSession({ headers });
    assert.equal(session?.user.email, "test@example.test");
    await auth.api.signOut({ headers });
    assert.equal(await auth.api.getSession({ headers }), null);

    const account = await database
      .prepare('SELECT password FROM account WHERE "userId" = ?')
      .bind(session.user.id)
      .first();
    assert.notEqual(account.password, "test-password-12345");
  } finally {
    await runtime.dispose();
  }
});

test("SignuDoc setup auth and sign-in operate with an explicit D1 binding", async () => {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      compatibilityDate: "2026-08-06",
      d1Databases: ["DB"],
    }),
  );
  try {
    const database = await runtime.getD1Database("DB");
    for (const name of [
      "0001_rate_limits.sql",
      "0002_auth.sql",
      "0003_envelopes.sql",
      "0004_settings_templates.sql",
    ]) {
      const migration = await readFile(
        new URL(`./migrations/${name}`, import.meta.url),
        "utf8",
      );
      for (const statement of migration
        .split(";")
        .filter((part) => part.trim())) {
        await database.prepare(statement).run();
      }
    }
    const auth = createAppAuth({
      database,
      env: {
        NODE_ENV: "test",
        APP_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: "test-only-secret-that-is-at-least-32-bytes-long",
      },
      includeNextCookies: false,
    });
    assert.equal(
      (await evaluateD1SignupRequest("new@example.test", database)).code,
      "setup_required",
    );
    const signup = await runAsSetup(() =>
      auth.api.signUpEmail({
        body: {
          name: "Administrator",
          email: "admin@example.test",
          password: "test-password-12345",
        },
        asResponse: true,
      }),
    );
    assert.equal(signup.status, 200, await signup.clone().text());
    await database
      .prepare(
        'UPDATE "user" SET "emailVerified" = 1, role = ? WHERE email = ?',
      )
      .bind("admin", "admin@example.test")
      .run();
    await database
      .prepare(
        "INSERT INTO app_settings (signup_mode, allowed_email_domains, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .bind("domains", JSON.stringify(["example.test"]), 1, 1)
      .run();
    assert.equal(
      (await evaluateD1SignupRequest("new@example.test", database)).allowed,
      true,
    );
    assert.equal(
      (await evaluateD1SignupRequest("new@other.test", database)).code,
      "signup_domain_not_allowed",
    );
    await assert.rejects(
      auth.api.signUpEmail({
        body: {
          name: "Other",
          email: "new@other.test",
          password: "test-password-12345",
        },
        asResponse: true,
      }),
      (error) => error.statusCode === 403,
    );
    const login = await auth.api.signInEmail({
      body: { email: "admin@example.test", password: "test-password-12345" },
      asResponse: true,
    });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie");
    assert.ok(cookie);
    assert.equal(
      (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user
        .email,
      "admin@example.test",
    );
  } finally {
    await runtime.dispose();
  }
});
