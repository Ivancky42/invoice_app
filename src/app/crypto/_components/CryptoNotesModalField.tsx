"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAssetFields } from "@/lib/crypto/actions";

type Field = "thesis" | "notes";

/**
 * Editable thesis/notes modal. Adapts the stocks NotesModalField to crypto's
 * in-app editing via `updateAssetFields` (DB is the source of truth).
 */
export function CryptoNotesModalField({
  assetId,
  field,
  label,
  value,
  context,
}: {
  assetId: string;
  field: Field;
  label: string;
  value: string | null;
  context?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setDraft(value ?? "");
    setError(null);
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, value]);

  const modalTitle = context ? `${context} — ${label}` : label;
  const hasValue = Boolean(value && value.trim());

  const onSave = () => {
    setError(null);
    start(async () => {
      try {
        await updateAssetFields(assetId, { [field]: draft });
        setOpen(false);
        router.refresh();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center text-sm font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 hover:border-gray-300 transition"
      >
        {hasValue ? label : `Add ${label.toLowerCase()}`}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-10 bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={modalTitle}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-semibold text-gray-900 leading-snug pr-2">{modalTitle}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm font-medium text-gray-500 hover:text-gray-900 shrink-0 -mr-1 px-1 py-0.5"
                aria-label="Close"
              >
                Close ✕
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={8}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                placeholder={`Write ${label.toLowerCase()}…`}
              />
              {error ? <p className="text-sm text-red-700 m-0">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="btn text-sm"
                  disabled={pending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  className="btn btn-primary text-sm"
                  disabled={pending}
                >
                  {pending ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
