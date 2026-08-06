import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { readJsonBody, parseOr400 } from "@/lib/agent/http";
import { upsertContentPageInputSchema } from "@/lib/agent/schemas";
import { getContentPage, upsertContentPage } from "@/lib/agent/writes";
import { ContentPageKey } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ key: string }> };

function parseKey(raw: string): (typeof ContentPageKey)[keyof typeof ContentPageKey] | null {
  const upper = decodeURIComponent(raw).trim().toUpperCase();
  if ((Object.values(ContentPageKey) as string[]).includes(upper)) {
    return upper as (typeof ContentPageKey)[keyof typeof ContentPageKey];
  }
  return null;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const unauthorized = requireAgentToken(_req);
  if (unauthorized) return unauthorized;

  const { key: raw } = await ctx.params;
  const key = parseKey(raw);
  if (!key) {
    return NextResponse.json(
      {
        error: "invalid key",
        legalValues: Object.values(ContentPageKey),
      },
      { status: 400 },
    );
  }

  const result = await getContentPage(key);
  if (!result.ok) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const { key: raw } = await ctx.params;
  const key = parseKey(raw);
  if (!key) {
    return NextResponse.json(
      {
        error: "invalid key",
        legalValues: Object.values(ContentPageKey),
      },
      { status: 400 },
    );
  }

  const body = await readJsonBody(req);
  if (body === null) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseOr400(upsertContentPageInputSchema, { ...body, key });
  if (!parsed.ok) return parsed.response;

  const document = await upsertContentPage(parsed.data);
  return NextResponse.json({ ok: true, document });
}
