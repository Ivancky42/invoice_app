"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EmailPreview } from "./actions";

type EmailInput = { to: string; cc: string; message: string };

/**
 * "Email to client" on a document page. Fill in recipients and a note, review the exact
 * email (sender, recipients, subject, body) in a confirmation dialog, then send it through
 * Resend with the PDF attached.
 */
export default function EmailInvoiceForm({
  documentId,
  number,
  defaultTo,
  defaultCc = "",
  alwaysCc = "",
  isDraft = false,
  canSend,
  disabledReason,
  preview,
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
  preview: (
    id: string,
    input: EmailInput,
  ) => Promise<{ ok: true; preview: EmailPreview } | { ok: false; message: string }>;
  action: (id: string, input: EmailInput) => Promise<{ ok: boolean; message: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  // The email under review, and the exact inputs it was built from: Send uses those, so
  // editing the form behind the dialog can't change what was approved.
  const [review, setReview] = useState<{ email: EmailPreview; input: EmailInput } | null>(null);
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

  const openReview = () =>
    start(async () => {
      setResult(null);
      const input = { to, cc, message };
      const r = await preview(documentId, input);
      if (r.ok) setReview({ email: r.preview, input });
      else setResult({ ok: false, message: r.message });
    });

  const send = () =>
    start(async () => {
      if (!review) return;
      const r = await action(documentId, review.input);
      setResult(r);
      setReview(null);
      // Close on success: re-opening is a deliberate choice to send another copy.
      if (r.ok) setOpen(false);
      router.refresh();
    });

  return (
    <div className="card p-4 space-y-3 w-full md:w-[28rem] text-sm">
      <div className="font-medium">Email {number} with the PDF attached</div>
      <div>
        <label className="label">To</label>
        <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" />
      </div>
      <div>
        <label className="label">
          CC <span className="text-gray-400 font-normal">(optional, comma-separated)</span>
        </label>
        <input className="input" value={cc} onChange={(e) => setCc(e.target.value)} />
        {alwaysCc && <p className="text-xs text-gray-500 mt-1">Always copied too: {alwaysCc}</p>}
      </div>
      <div>
        <label className="label">
          Note <span className="text-gray-400 font-normal">(optional, shown above the summary)</span>
        </label>
        <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      {isDraft && (
        <div className="text-amber-700">
          This is a draft: sending it marks it ISSUED, with its due date set from the payment terms.
        </div>
      )}
      {result && <div className={result.ok ? "text-green-700" : "text-red-700"}>{result.message}</div>}
      <div className="flex gap-2 justify-end">
        <button className="btn" onClick={() => setOpen(false)} disabled={pending}>
          Close
        </button>
        <button className="btn btn-primary" disabled={pending || !to.trim()} onClick={openReview}>
          {pending && !review ? "Preparing…" : "Review email…"}
        </button>
      </div>

      {review && (
        <ConfirmEmailDialog
          email={review.email}
          pending={pending}
          onCancel={() => setReview(null)}
          onSend={send}
        />
      )}
    </div>
  );
}

function ConfirmEmailDialog({
  email,
  pending,
  onCancel,
  onSend,
}: {
  email: EmailPreview;
  pending: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const sendRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    sendRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, pending]);

  const rows: [string, string][] = [
    ["From", email.from],
    ...(email.replyTo ? ([["Reply-to", email.replyTo]] as [string, string][]) : []),
    ["To", email.to.join(", ")],
    ...(email.cc.length ? ([["CC", email.cc.join(", ")]] as [string, string][]) : []),
    ...(email.bcc.length ? ([["BCC", email.bcc.join(", ")]] as [string, string][]) : []),
    ["Subject", email.subject],
    ["Attachment", email.attachment],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-email-title"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[min(92vh,900px)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-gray-200">
          <h2 id="confirm-email-title" className="text-base font-semibold">
            Send {email.number}?
          </h2>
          <p className="text-sm text-gray-500">Check the recipients and the message. This can&apos;t be unsent.</p>
        </div>

        <div className="overflow-y-auto overscroll-contain px-5 py-4 space-y-4 text-sm">
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-gray-500">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>

          {email.issuesDraft && (
            <div className="rounded-md bg-amber-50 text-amber-800 px-3 py-2">
              {email.number} is a draft: sending it marks it ISSUED, with its due date set from the payment terms.
            </div>
          )}

          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">Message</div>
            {/* sandbox="" : the email HTML renders with scripts, forms and navigation disabled. */}
            <iframe
              title={`Email body for ${email.number}`}
              sandbox=""
              srcDoc={email.html}
              className="w-full h-[26rem] rounded-md border border-gray-200 bg-[#f7f7f8]"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end px-5 py-4 border-t border-gray-200">
          <button className="btn" onClick={onCancel} disabled={pending}>
            Back
          </button>
          <button ref={sendRef} className="btn btn-primary" onClick={onSend} disabled={pending}>
            {pending ? "Sending…" : "Confirm & send"}
          </button>
        </div>
      </div>
    </div>
  );
}
