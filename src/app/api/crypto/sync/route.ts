import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorized } from "@/lib/cronAuth";
import { runCryptoSync } from "@/lib/crypto/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await runCryptoSync();
  return NextResponse.json(result, { status: 200 });
}
