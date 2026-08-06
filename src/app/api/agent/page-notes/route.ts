import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { readJsonBody, parseOr400 } from "@/lib/agent/http";
import {
  appendPageNotesInputSchema,
  getPageNotesInputSchema,
} from "@/lib/agent/schemas";
import { appendPageNotes, getPageNotes } from "@/lib/agent/writes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = parseOr400(getPageNotesInputSchema, {
    ...raw,
    limit: raw.limit ? Number(raw.limit) : undefined,
    offset: raw.offset ? Number(raw.offset) : undefined,
  });
  if (!parsed.ok) return parsed.response;

  const result = await getPageNotes(parsed.data);
  if (!result.ok) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(req);
  if (body === null) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseOr400(appendPageNotesInputSchema, body);
  if (!parsed.ok) return parsed.response;

  const result = await appendPageNotes(parsed.data);
  if (!result.ok) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}
