import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyPdfLink } from "@/lib/invoicing/pdfLink";
import { SITE_GATE_COOKIE, gateEnv, verifySiteGateToken } from "@/lib/site-gate";

export async function proxy(req: NextRequest) {
  const g = gateEnv();
  if (!g) return NextResponse.next();

  const pathname = req.nextUrl.pathname;

  if (pathname === "/login") return NextResponse.next();
  if (pathname.startsWith("/api/sync/")) return NextResponse.next();
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();
  if (pathname.startsWith("/api/agent/")) return NextResponse.next();
  if (pathname.startsWith("/api/mcp/")) return NextResponse.next();
  if (pathname.startsWith("/api/oauth/")) return NextResponse.next();
  if (pathname.startsWith("/.well-known/")) return NextResponse.next();
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") return NextResponse.next();

  // Signed, expiring PDF links (minted by the get_invoice_pdf MCP tool) skip the PIN.
  const pdf = /^\/api\/pdf\/([^/]+)$/.exec(pathname);
  if (pdf && req.nextUrl.searchParams.has("sig")) {
    let id: string | null = null;
    try {
      id = decodeURIComponent(pdf[1]);
    } catch {
      // Malformed escape: treat as an invalid link.
    }
    const ok =
      id !== null &&
      (await verifyPdfLink(id, req.nextUrl.searchParams.get("exp"), req.nextUrl.searchParams.get("sig")));
    if (ok) return NextResponse.next();
    return new NextResponse("This PDF link is invalid or has expired.", { status: 403 });
  }

  const raw = req.cookies.get(SITE_GATE_COOKIE)?.value;
  if (raw && (await verifySiteGateToken(raw, g.secret))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Paths the proxy would only pass through are excluded here so they don't cost a
  // separate proxy invocation (the MCP endpoint is hit by every connected agent). The
  // startsWith checks above stay as a backstop; proxy.test.ts keeps the two in step.
  // Every prefix ends in "/" so a new route such as /api/mcp-admin is still PIN-gated.
  // /api/pdf stays matched: signed links are verified here. Must stay a literal — Next
  // reads it statically.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/mcp/|api/agent/|api/cron/|api/sync/|api/oauth/|\\.well-known/).*)",
  ],
};
