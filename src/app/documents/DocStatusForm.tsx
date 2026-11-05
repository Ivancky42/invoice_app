"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import AppSelect from "@/components/AppSelect";

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "DRAFT" },
  { value: "ISSUED", label: "ISSUED" },
  { value: "PAID", label: "PAID" },
  { value: "CANCELLED", label: "CANCELLED" },
];

/**
 * Status picker on a document page. Choosing PAID asks for the day it was paid
 * (today by default, or the recorded date when it is already paid).
 */
export default function DocStatusForm({
  action,
  defaultStatus,
  defaultPaidDate,
  today,
}: {
  action: (status: string, paidDate: string | null) => Promise<{ ok: boolean; message?: string }>;
  defaultStatus: string;
  /** YYYY-MM-DD the document was paid, when it is. */
  defaultPaidDate?: string | null;
  /** Today in the billing time zone, YYYY-MM-DD: the default paid date and the latest allowed. */
  today: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(defaultStatus);
  const [paidDate, setPaidDate] = useState(defaultPaidDate || today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = status !== defaultStatus || (status === "PAID" && paidDate !== (defaultPaidDate || today));

  return (
    <form
      className="flex gap-1 items-center flex-wrap"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await action(status, status === "PAID" ? paidDate : null);
          if (!r.ok) setError(r.message ?? "Couldn't update the status");
          router.refresh();
        });
      }}
    >
      <AppSelect
        value={status}
        onValueChange={setStatus}
        options={STATUS_OPTIONS}
        triggerClassName="w-auto! min-w-32"
        aria-label="Document status"
      />
      {status === "PAID" && (
        <label className="flex items-center gap-1 text-sm text-gray-600">
          Paid on
          <input
            type="date"
            className="input w-auto!"
            value={paidDate}
            max={today}
            onChange={(e) => setPaidDate(e.target.value)}
            aria-label="Paid on"
          />
        </label>
      )}
      <button className="btn" type="submit" disabled={pending || !changed || (status === "PAID" && !paidDate)}>
        {pending ? "Saving…" : "Update"}
      </button>
      {error && <span className="text-sm text-red-700 w-full">{error}</span>}
    </form>
  );
}
