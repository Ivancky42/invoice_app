import Link from "next/link";
import { listRecurringInvoices } from "@/lib/invoicing/recurring";
import { formatMoney } from "@/lib/types";
import { runRecurringNow, setRecurringStatus } from "./actions";
import { cadenceLabel, RECURRING_STATUS_COLORS as STATUS_COLORS } from "./labels";

export const dynamic = "force-dynamic";

export default async function RecurringPage() {
  const schedules = await listRecurringInvoices();
  const due = schedules.filter((s) => s.status === "ACTIVE");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Recurring invoices</h1>
          <p className="text-sm text-gray-500">
            Invoices are generated automatically around 06:00 Malaysia time on each billing date.
          </p>
        </div>
        <div className="flex gap-2">
          <form action={runRecurringNow}>
            <button className="btn" disabled={due.length === 0} title="Generate anything due today that hasn't been generated yet">
              Run due now
            </button>
          </form>
          <Link href="/recurring/new" className="btn btn-primary">New schedule</Link>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2 font-medium">Schedule</th>
              <th className="px-4 py-2 font-medium">Client</th>
              <th className="px-4 py-2 font-medium">Cadence</th>
              <th className="px-4 py-2 font-medium">Next invoice</th>
              <th className="px-4 py-2 font-medium">Progress</th>
              <th className="px-4 py-2 font-medium text-right">Per invoice</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {schedules.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No recurring invoices yet. Create one here, or open an invoice and choose <b>Make recurring</b>.
                </td>
              </tr>
            )}
            {schedules.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <Link href={`/recurring/${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                  <div className="text-xs text-gray-500">{s.company ?? "Default profile"}</div>
                  {s.lastError && <div className="text-xs text-red-600">Last run failed: {s.lastError.slice(0, 80)}</div>}
                </td>
                <td className="px-4 py-2">{s.clientName}</td>
                <td className="px-4 py-2">{cadenceLabel(s.frequency, s.interval, s.dayOfMonth)}</td>
                <td className="px-4 py-2">{s.nextRunDate ?? "—"}</td>
                <td className="px-4 py-2">
                  {s.occurrencesGenerated} of {s.maxOccurrences ?? "∞"}
                  {s.endDate && <div className="text-xs text-gray-500">until {s.endDate}</div>}
                </td>
                <td className="px-4 py-2 text-right">{formatMoney(s.amountPerInvoice, s.currency)}</td>
                <td className="px-4 py-2"><span className={`badge ${STATUS_COLORS[s.status]}`}>{s.status}</span></td>
                <td className="px-4 py-2 text-right">
                  {s.status !== "ENDED" && (
                    <form action={setRecurringStatus}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="status" value={s.status === "ACTIVE" ? "PAUSED" : "ACTIVE"} />
                      <button className="btn">{s.status === "ACTIVE" ? "Pause" : "Resume"}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
