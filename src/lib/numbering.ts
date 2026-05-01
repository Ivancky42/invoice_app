import { prisma } from "./prisma";
import { DOC_PREFIX } from "./types";

export async function nextDocumentNumber(type: string): Promise<string> {
  const prefix = DOC_PREFIX[type] ?? "DOC";
  const year = new Date().getFullYear();
  const stem = `${prefix}-${year}-`;
  const last = await prisma.document.findFirst({
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
