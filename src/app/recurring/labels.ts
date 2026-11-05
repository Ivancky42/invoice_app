export const RECURRING_STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  PAUSED: "bg-amber-100 text-amber-700",
  ENDED: "bg-gray-100 text-gray-600",
};

const FREQ_WORD: Record<string, [string, string]> = {
  WEEKLY: ["week", "weeks"],
  MONTHLY: ["month", "months"],
  QUARTERLY: ["quarter", "quarters"],
  YEARLY: ["year", "years"],
};

export function cadenceLabel(frequency: string, interval: number, dayOfMonth: number | null): string {
  const [one, many] = FREQ_WORD[frequency] ?? ["period", "periods"];
  const every = interval > 1 ? `Every ${interval} ${many}` : `Every ${one}`;
  return frequency !== "WEEKLY" && dayOfMonth ? `${every}, day ${dayOfMonth}` : every;
}
