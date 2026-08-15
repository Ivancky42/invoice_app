import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { authorized } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { snapshotDateGMT8 } from "@/lib/stocks/portfolioTotals";
import { CryptoLearningKind, Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const VALID_KINDS = new Set<string>(Object.values(CryptoLearningKind));

type LearningBody = {
  kind?: unknown;
  date?: unknown;
  evaluations?: unknown;
  heuristics?: unknown;
  summary?: unknown;
};

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: LearningBody;
  try {
    body = (await req.json()) as LearningBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const kind = body.kind;
  if (typeof kind !== "string" || !VALID_KINDS.has(kind)) {
    return NextResponse.json(
      { ok: false, error: `kind is required and must be one of ${[...VALID_KINDS].join(", ")}` },
      { status: 400 },
    );
  }

  const summary = body.summary;
  if (typeof summary !== "string" || summary.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "summary is required and must be a non-empty string" },
      { status: 400 },
    );
  }

  const evaluations: Prisma.InputJsonValue | Prisma.JsonNullValueInput = Array.isArray(
    body.evaluations,
  )
    ? (body.evaluations as Prisma.InputJsonValue)
    : Prisma.JsonNull;
  const heuristics =
    typeof body.heuristics === "string" && body.heuristics.trim() ? body.heuristics : null;

  const logDate =
    typeof body.date === "string" && body.date.trim()
      ? snapshotDateGMT8(new Date(body.date))
      : snapshotDateGMT8();

  const kindValue = kind as CryptoLearningKind;

  const log = await prisma.cryptoLearningLog.upsert({
    where: { kind_logDate: { kind: kindValue, logDate } },
    create: {
      kind: kindValue,
      logDate,
      evaluations,
      heuristics,
      summary,
    },
    update: {
      evaluations,
      heuristics,
      summary,
    },
  });

  revalidatePath("/crypto", "layout");

  return NextResponse.json(
    { ok: true, kind: log.kind, logDate: log.logDate.toISOString() },
    { status: 200 },
  );
}
