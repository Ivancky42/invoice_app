/**
 * The ONLY module in the codebase that may touch `prisma.evolutionEvent`.
 *
 * The evolution log is append-only. Postgres enforces that for real (ON UPDATE / ON DELETE
 * DO INSTEAD NOTHING rules — see prisma/migrations/20260808190000_evolution and
 * scripts/apply-raw-constraints.ts); this module is the code-side chokepoint so that the
 * write path is auditable by reading one file. Corrections are made by APPENDING a new
 * event that references the earlier one, never by editing history.
 *
 * Both the write ({@link appendEvolutionEvent}) and the read ({@link listEvolutionEvents})
 * live here so the delegate name appears in exactly one place.
 */
import type { EvolutionEventKind, Prisma, RuleActor } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type AppendEvolutionEventInput = {
  kind: EvolutionEventKind;
  /** Version the event is about; omit for events that precede version creation. */
  ruleVersionId?: number | null;
  actor: RuleActor;
  detail: Prisma.InputJsonValue;
};

/**
 * Append one audit row. Never throws into the caller: an audit write that fails must not
 * roll back or mask the outcome it is describing (a killed candidate stays killed), so the
 * failure is logged to stderr and surfaced as `null`.
 *
 * Pass a transaction client when the event must be atomic with the state change it
 * records — promotion does exactly that.
 */
export async function appendEvolutionEvent(
  input: AppendEvolutionEventInput,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? prisma;
  try {
    const row = await client.evolutionEvent.create({
      data: {
        kind: input.kind,
        ruleVersionId: input.ruleVersionId ?? null,
        actor: input.actor,
        detail: input.detail,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    if (tx) throw err; // Inside a transaction the caller owns the failure.
    console.error(
      "[evolution appendEvolutionEvent]",
      input.kind,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export type ListEvolutionEventsInput = {
  kind?: EvolutionEventKind;
  limit?: number;
};

export type EvolutionEventView = {
  id: string;
  kind: EvolutionEventKind;
  ruleVersionId: number | null;
  actor: RuleActor;
  detail: Prisma.JsonValue;
  createdAt: string;
};

/**
 * Count events of one kind since an instant — the promotion rate limiter's input.
 * Lives here for the same reason the list does: `prisma.evolutionEvent` appears in
 * exactly one file.
 */
export async function countEvolutionEvents(input: {
  kind: EvolutionEventKind;
  since: Date;
}): Promise<number> {
  return prisma.evolutionEvent.count({
    where: { kind: input.kind, createdAt: { gte: input.since } },
  });
}

/** Newest-first read of the audit log. Default 50, hard cap 200. */
export async function listEvolutionEvents(
  input: ListEvolutionEventsInput = {},
): Promise<{ events: EvolutionEventView[] }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await prisma.evolutionEvent.findMany({
    where: input.kind ? { kind: input.kind } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return {
    events: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      ruleVersionId: r.ruleVersionId,
      actor: r.actor,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
