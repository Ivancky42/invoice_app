"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** "Email to client" on a document page: sends through Resend with the PDF attached. */
export default function EmailInvoiceForm({
  documentId,
  number,
  defaultTo,
  defaultCc = "",
  alwaysCc = "",
  isDraft = false,
  canSend,
  disabledReason,
  action,
}: {
  documentId: string;
  number: string;
  defaultTo: string;
  /** The client's invoice CC list, prefilled and editable. */
  defaultCc?: string;
  /** The company's CC list, added to every send. */
  alwaysCc?: string;
  /** Sending a draft issues it; the form says so. */
  isDraft?: boolean;
  canSend: boolean;
  disabledReason?: string;
  action: (id: string, input: { to: string; cc: string; message: string }) => Promise<{ ok: boolean; message: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  if (!canSend) {
    return (
      <button className="btn" disabled title={disabledReason}>
        Email to client
      </button>
    );
  }

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          className="btn"
          onClick={() => {
            setResult(null);
            setOpen(true);
          }}
        >
          {result?.ok ? "Email again" : "Email to client"}
        </button>
        {result?.ok && <span className="text-sm text-green-700">{result.message}</span>}
      </span>
    );
  }

  return (
    <div className="card p-4 space-y-3 w-full md:w-[28rem] text-sm">
      <div className="font-medium">Email {number} with the PDF attached</div>
      <div>
        <label className="label">To</label>
        <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" />
      </div>
      <div>
        <label className="label">CC <span className="text-gray-400 font-normal">(optional, comma-separated)</span></label>
        <input className="input" value={cc} onChange={(e) => setCc(e.target.value)} />
        {alwaysCc && <p className="text-xs text-gray-500 mt-1">Always copied too: {alwaysCc}</p>}
      </div>
      <div>
        <label className="label">Note <span className="text-gray-400 font-normal">(optional, shown above the summary)</span></label>
        <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      {isDraft && (
        <div className="text-amber-700">This is a draft: sending it marks it ISSUED, with its due date set from the payment terms.</div>
      )}
      {result && <div className={result.ok ? "text-green-700" : "text-red-700"}>{result.message}</div>}
      <div className="flex gap-2 justify-end">
        <button className="btn" onClick={() => setOpen(false)} disabled={pending}>
          Close
        </button>
        <button
          className="btn btn-primary"
          disabled={pending || !to.trim()}
          onClick={() =>
            start(async () => {
              const r = await action(documentId, { to, cc, message });
              setResult(r);
              // Close on success: re-opening is a deliberate choice to send another copy.
              if (r.ok) setOpen(false);
              router.refresh();
            })
          }
        >
          {pending ? "Sending…" : "Send now"}
        </button>
      </div>
    </div>
  );
}
