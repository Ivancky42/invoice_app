import type { EvolutionEventKind } from "@/generated/prisma/client";

/** Fitness / credit values are NAV fractions (0.03 = 3%). */
export function fmtSignedFrac(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

export function kindBadgeClass(kind: EvolutionEventKind): string {
  switch (kind) {
    case "PROMOTE":
      return "bg-emerald-100 text-emerald-800";
    case "PROPOSE":
    case "GAPFIX":
      return "bg-sky-100 text-sky-800";
    case "SCORE":
      return "bg-indigo-100 text-indigo-800";
    case "EARLY_KILL":
    case "HARD_REVERT":
    case "KERNEL_ATTEMPT":
    case "ELIGIBILITY_REJECT":
    case "DRIFT_BLOCK":
      return "bg-rose-100 text-rose-800";
    case "INCONCLUSIVE":
    case "PATTERN_RETIRED":
    case "MIRROR":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case "ACTIVE":
    case "FILLED":
    case "RESOLVED":
      return "bg-emerald-100 text-emerald-800";
    case "CANDIDATE":
    case "OPEN":
      return "bg-sky-100 text-sky-800";
    case "RETIRED":
    case "UNRESOLVED":
      return "bg-gray-100 text-gray-700";
    case "KILLED":
    case "REJECTED":
    case "EXPIRED":
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    case "PENDING":
    case "WAITING":
    case "REVIEWED_1W":
    case "REVIEWED_4W":
    case "REVIEWED_3M":
      return "bg-amber-100 text-amber-800";
    case "CLOSED":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

export function emptyRow(cols: number, message: string) {
  return (
    <tr>
      <td colSpan={cols} className="px-5 py-6 text-sm text-gray-500">
        {message}
      </td>
    </tr>
  );
}
