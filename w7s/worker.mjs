// Native Worker entry point for the migration. This is not a production entry
// point until the application routes and their storage guarantees are ported.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/health") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    let database = "unavailable";
    if (env.DB) {
      try {
        const result = await env.DB.prepare("SELECT 1 AS ok").first();
        if (result?.ok === 1) database = "connected";
      } catch {
        // Do not expose database errors or credentials in a public response.
      }
    }

    const body = JSON.stringify({
      status: "not_ready",
      database,
      branch: env.DEPLOY_BRANCH || null,
      commitHash: env.DEPLOY_COMMIT || null,
      deployedAt: env.DEPLOYED_AT || null,
    });
    return new Response(request.method === "HEAD" ? null : body, {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  },
};
