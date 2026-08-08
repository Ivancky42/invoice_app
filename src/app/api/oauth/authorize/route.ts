import {
  agentTokenMatches,
  getAgentToken,
  getAppOrigin,
  isAllowedRedirectUri,
  mintAuthCode,
  MCP_SCOPE,
  MCP_SHADOW_SCOPE,
  normalizeMcpScopeRequest,
} from "@/lib/agent/mcp-oauth";

export const dynamic = "force-dynamic";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function consentHtml(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  error?: string;
}): Response {
  const err = params.error
    ? `<p style="color:#b91c1c;margin:0 0 1rem">${escapeHtml(params.error)}</p>`
    : "";
  const scope = normalizeMcpScopeRequest(params.scope);
  const shadowChecked = scope === MCP_SHADOW_SCOPE ? "checked" : "";
  const liveChecked = scope !== MCP_SHADOW_SCOPE ? "checked" : "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Stock HQ — Authorize Claude</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    p.muted { color: #555; font-size: 0.9rem; }
    label { display: block; font-size: 0.85rem; margin: 1rem 0 0.35rem; }
    .scope label { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.5rem 0; font-size: 0.9rem; }
    .scope input { margin-top: 0.2rem; }
    input[type=password] { width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; }
    button { margin-top: 1.25rem; width: 100%; padding: 0.7rem; border: 0; border-radius: 6px; background: #111; color: #fff; font-size: 1rem; cursor: pointer; }
    button:hover { background: #333; }
  </style>
</head>
<body>
  <h1>Authorize Stock HQ</h1>
  <p class="muted">Paste your <code>AGENT_TOKEN</code> and pick the connector scope. Use <strong>Shadow</strong> for CANDIDATE Cowork schedules — real-book writes are blocked server-side.</p>
  ${err}
  <form method="POST" action="/api/oauth/authorize">
    <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}"/>
    <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}"/>
    <input type="hidden" name="state" value="${escapeHtml(params.state)}"/>
    <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}"/>
    <input type="hidden" name="code_challenge_method" value="S256"/>
    <input type="hidden" name="resource" value="${escapeHtml(params.resource)}"/>
    <input type="hidden" name="response_type" value="code"/>
    <label>Connector scope</label>
    <div class="scope">
      <label><input type="radio" name="scope" value="${MCP_SCOPE}" ${liveChecked}/> <span><code>${MCP_SCOPE}</code> — LIVE routines (portfolio + evolution writes allowed)</span></label>
      <label><input type="radio" name="scope" value="${MCP_SHADOW_SCOPE}" ${shadowChecked}/> <span><code>${MCP_SHADOW_SCOPE}</code> — CANDIDATE routines only (real-book writes refused)</span></label>
    </div>
    <label for="agent_token">AGENT_TOKEN</label>
    <input id="agent_token" name="agent_token" type="password" autocomplete="current-password" required/>
    <button type="submit">Approve</button>
  </form>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function oauthErrorRedirect(
  redirectUri: string,
  error: string,
  state: string | null,
  description?: string,
): Response {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  // Claude Custom Connector requires 302/303 (not Next.js default 307).
  return Response.redirect(url.toString(), 302);
}

function readParams(src: URLSearchParams | FormData) {
  const get = (k: string) => {
    const v = src.get(k);
    return typeof v === "string" ? v : "";
  };
  return {
    clientId: get("client_id"),
    redirectUri: get("redirect_uri"),
    state: get("state"),
    codeChallenge: get("code_challenge"),
    codeChallengeMethod: get("code_challenge_method") || "S256",
    scope: normalizeMcpScopeRequest(get("scope")),
    resource: get("resource"),
    responseType: get("response_type") || "code",
    agentToken: get("agent_token"),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = readParams(url.searchParams);

  if (!getAgentToken()) {
    return new Response("AGENT_TOKEN not configured on server", { status: 503 });
  }
  if (p.responseType !== "code") {
    return new Response("unsupported response_type", { status: 400 });
  }
  if (!p.clientId || !p.redirectUri || !p.codeChallenge) {
    return new Response("client_id, redirect_uri, and code_challenge are required", {
      status: 400,
    });
  }
  if (!isAllowedRedirectUri(p.redirectUri)) {
    return new Response("invalid redirect_uri", { status: 400 });
  }
  if (p.codeChallengeMethod !== "S256") {
    return new Response("only S256 code_challenge_method is supported", { status: 400 });
  }

  const origin = getAppOrigin(req);
  return consentHtml({
    clientId: p.clientId,
    redirectUri: p.redirectUri,
    state: p.state,
    codeChallenge: p.codeChallenge,
    scope: p.scope,
    resource: p.resource || `${origin}/api/mcp/mcp`,
  });
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let p: ReturnType<typeof readParams>;
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    p = readParams(await req.formData());
  } else {
    const url = new URL(req.url);
    p = readParams(url.searchParams);
  }

  if (!isAllowedRedirectUri(p.redirectUri)) {
    return new Response("invalid redirect_uri", { status: 400 });
  }
  if (!p.clientId || !p.codeChallenge) {
    return oauthErrorRedirect(
      p.redirectUri,
      "invalid_request",
      p.state || null,
      "missing client_id or code_challenge",
    );
  }
  if (p.codeChallengeMethod !== "S256") {
    return oauthErrorRedirect(
      p.redirectUri,
      "invalid_request",
      p.state || null,
      "code_challenge_method must be S256",
    );
  }
  if (!agentTokenMatches(p.agentToken)) {
    const origin = getAppOrigin(req);
    return consentHtml({
      clientId: p.clientId,
      redirectUri: p.redirectUri,
      state: p.state,
      codeChallenge: p.codeChallenge,
      scope: p.scope,
      resource: p.resource || `${origin}/api/mcp/mcp`,
      error: "Invalid AGENT_TOKEN. Try again.",
    });
  }

  const code = await mintAuthCode({
    clientId: p.clientId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    scope: normalizeMcpScopeRequest(p.scope),
    resource: p.resource || undefined,
  });

  const target = new URL(p.redirectUri);
  target.searchParams.set("code", code);
  if (p.state) target.searchParams.set("state", p.state);
  return Response.redirect(target.toString(), 302);
}
