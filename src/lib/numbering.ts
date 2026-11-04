import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { DOC_PREFIX } from "./types";

type NumberingDb = Pick<Prisma.TransactionClient, "document">;

/**
 * Next free number for `type`, e.g. INV-2026-0007. Pass `db` to allocate inside a
 * transaction and `date` to number by the document's own year (defaults to now).
 */
export async function nextDocumentNumber(
  type: string,
  opts: { db?: NumberingDb; date?: Date } = {},
): Promise<string> {
  const db = opts.db ?? prisma;
  const prefix = DOC_PREFIX[type] ?? "DOC";
  const year = (opts.date ?? new Date()).getUTCFullYear();
  const stem = `${prefix}-${year}-`;
  const last = await db.document.findFirst({
    where: { number: { startsWith: stem } },
    orderBy: { number: "desc" },
  });
  let n = 1;
  if (last) {
    const tail = last.number.slice(stem.length);
    const parsed = parseInt(tail, 10);
    if (!isNaN(parsed)) n = parsed + 1;
  }
  return `${stem}${String(n).padStart(4, "0")}`;
}
