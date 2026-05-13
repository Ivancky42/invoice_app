import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SITE_GATE_COOKIE, gateEnv, verifySiteGateToken } from "@/lib/site-gate";

export async function middleware(req: NextRequest) {
  const g = gateEnv();
  if (!g) return NextResponse.next();

  const pathname = req.nextUrl.pathname;

  if (pathname === "/login") return NextResponse.next();
  if (pathname.startsWith("/api/sync/")) return NextResponse.next();
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") return NextResponse.next();

  const raw = req.cookies.get(SITE_GATE_COOKIE)?.value;
  if (raw && (await verifySiteGateToken(raw, g.secret))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
