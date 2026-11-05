import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DOC_LABELS, NEXT_STAGE, formatMoney, LineItem } from "@/lib/types";
import DocStatusForm from "../DocStatusForm";
import { convertDocument, deleteDocument, emailDocument, setStatus } from "../actions";
import EmailInvoiceForm from "../EmailInvoiceForm";
import { resendConfigured } from "@/lib/invoicing/email";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  ISSUED: "bg-blue-100 text-blue-700",
  PAID: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export default async function DocDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ recurring_error?: string }>;
}) {
  const { id } = await params;
  const { recurring_error: recurringError } = await searchParams;
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      parent: true,
      children: true,
      company: true,
      recurringInvoice: { select: { id: true, name: true, status: true, nextRunDate: true } },
      emails: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!doc) return notFound();
  const items = (doc.items as unknown as LineItem[]) ?? [];
  const next = NEXT_STAGE[doc.type];
  const company = doc.company;
  const currency = company?.currency || "USD";

  async function doConvert() {
    "use server";
    const r = await convertDocument(doc!.id);
    if (r) redirect(`/documents/${r.id}`);
  }
  async function doDelete() {
    "use server";
    await deleteDocument(doc!.id);
    redirect("/documents");
  }
  async function markStatus(formData: FormData) {
    "use server";
    await setStatus(doc!.id, String(formData.get("status") || "DRAFT"));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm text-gray-500">{DOC_LABELS[doc.type]}</div>
          <h1 className="text-2xl font-semibold">{doc.number}</h1>
          <div className="mt-1 flex gap-2 items-center flex-wrap">
            <span className={`badge ${STATUS_COLORS[doc.status]}`}>{doc.status}</span>
            <span className="text-sm text-gray-500">Issued {new Date(doc.issueDate).toLocaleDateString()}</span>
            {doc.paymentTerms && <span className="text-sm text-gray-500">· {doc.paymentTerms}</span>}
            {doc.parent && (
              <Link href={`/documents/${doc.parent.id}`} className="text-sm text-blue-600 hover:underline">
                ← from {doc.parent.number}
              </Link>
            )}
            {doc.recurringInvoice && (
              <Link href={`/recurring/${doc.recurringInvoice.id}`} className="text-sm text-blue-600 hover:underline">
                ↻ {doc.recurringInvoice.name}
                {doc.recurringInvoice.status === "ACTIVE" && doc.recurringInvoice.nextRunDate
                  ? ` · next ${doc.recurringInvoice.nextRunDate.toISOString().slice(0, 10)}`
                  : ` · ${doc.recurringInvoice.status.toLowerCase()}`}
              </Link>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <a className="btn" href={`/api/pdf/${doc.id}`} target="_blank" rel="noopener">View PDF</a>
          <a className="btn btn-primary" href={`/api/pdf/${doc.id}?download=1`}>Download PDF</a>
          <Link className="btn" href={`/documents/${doc.id}/edit`}>Edit</Link>
          {doc.type === "INVOICE" && !doc.recurringInvoice && (
            <Link className="btn" href={`/recurring/new?from=${doc.id}`}>Make recurring</Link>
          )}
          {next && (
            <form action={doConvert}>
              <button className="btn">Convert → {DOC_LABELS[next]}</button>
            </form>
          )}
          <DocStatusForm action={markStatus} defaultStatus={doc.status} />
          <EmailInvoiceForm
            documentId={doc.id}
            number={doc.number}
            defaultTo={doc.clientEmail ?? ""}
            canSend={Boolean(resendConfigured() && company?.emailFrom && doc.status !== "DRAFT")}
            disabledReason={
              !resendConfigured()
                ? "Email isn't set up: add RESEND_API_KEY to the app's environment"
                : !company?.emailFrom
                  ? `Set "Email from" on the ${company?.name ?? "company"} profile in Settings`
                  : "Issue it first: drafts can't be emailed"
            }
            action={emailDocument}
          />
          <form action={doDelete}>
            <button className="btn btn-danger">Delete</button>
          </form>
        </div>
      </div>

      {recurringError && !doc.recurringInvoice && (
        <div className="card p-3 text-sm text-red-700 bg-red-50">
          The invoice was saved, but its recurring schedule could not be created: {recurringError}. Use{" "}
          <Link href={`/recurring/new?from=${doc.id}`} className="underline">Make recurring</Link> to try again.
        </div>
      )}

      {(doc.emails.length > 0 || doc.emailPending) && (
        <div className="card p-4 text-sm">
          <div className="text-gray-500 mb-2">Emails</div>
          {doc.emailPending && <div className="text-amber-700 mb-1">Auto-email pending — it goes out with the next recurring run.</div>}
          <ul className="space-y-1">
            {doc.emails.map((e) => (
              <li key={e.id} className={e.status === "SENT" ? "" : "text-red-700"}>
                {e.status === "SENT" ? "✓ Sent" : "✗ Failed"} to {e.to}
                {e.cc ? ` (cc ${e.cc})` : ""} · {e.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC ·{" "}
                {e.trigger === "recurring" ? "automatic" : e.trigger === "agent" ? "by agent" : "from the app"}
                {e.error ? ` — ${e.error}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {doc.children.length > 0 && (
        <div className="card p-4 text-sm">
          <div className="text-gray-500 mb-2">Linked documents</div>
          <ul className="space-y-1">
            {doc.children.map((c) => (
              <li key={c.id}><Link href={`/documents/${c.id}`} className="text-blue-600 hover:underline">{DOC_LABELS[c.type]} {c.number}</Link></li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase text-gray-500 mb-1">From</div>
          {company ? (
            <div className="text-sm whitespace-pre-line">
              <div className="font-semibold">{company.name}</div>
              <div>{company.address}</div>
              {company.email && <div>{company.email}</div>}
              {company.phone && <div>{company.phone}</div>}
            </div>
          ) : <div className="text-sm text-gray-500">No company profile linked. Edit to assign one.</div>}
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500 mb-1">Bill to</div>
          <div className="text-sm whitespace-pre-line">
            <div className="font-semibold">{doc.clientName}</div>
            <div>{doc.clientAddress}</div>
            {doc.clientEmail && <div>{doc.clientEmail}</div>}
            {doc.clientPhone && <div>{doc.clientPhone}</div>}
          </div>
        </div>
        {(doc.shipToAttn || doc.shipToAddress) && (
          <div className="md:col-span-2">
            <div className="text-xs uppercase text-gray-500 mb-1">Ship to</div>
            <div className="text-sm whitespace-pre-line">
              {doc.shipToAttn && (
                <div>
                  <span className="font-semibold">Attn:</span> {doc.shipToAttn}
                </div>
              )}
              {doc.shipToAddress && <div>{doc.shipToAddress}</div>}
            </div>
          </div>
        )}
      </div>

      {(doc.projectTitle || doc.projectDescription || doc.poNumber) && (
        <div className="card p-4 text-sm space-y-2">
          {(doc.projectTitle || doc.projectDescription) && (
            <div>
              <div className="text-xs uppercase text-gray-500 mb-1">Project</div>
              {doc.projectTitle ? <div className="font-semibold">{doc.projectTitle}</div> : null}
              {doc.projectDescription ? (
                <div className="text-gray-700 whitespace-pre-line mt-0.5">{doc.projectDescription}</div>
              ) : null}
            </div>
          )}
          {doc.poNumber && (
            <div>
              <span className="text-gray-500">PO: </span>
              <span className="font-medium">{doc.poNumber}</span>
            </div>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium w-20">Qty</th>
              <th className="px-4 py-2 font-medium w-32">Unit</th>
              <th className="px-4 py-2 font-medium w-32 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((it, i) => (
              <tr key={i}>
                <td className="px-4 py-2">{it.description}</td>
                <td className="px-4 py-2">{it.quantity}</td>
                <td className="px-4 py-2">{formatMoney(it.unitPrice, currency)}</td>
                <td className="px-4 py-2 text-right">{formatMoney(it.quantity * it.unitPrice, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end p-4 border-t">
          <div className="w-72 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatMoney(doc.subtotal, currency)}</span></div>
            {doc.discountAmount > 0 && (
              <div className="flex justify-between"><span className="text-gray-500">Discount{doc.discountType === "PERCENT" ? ` (${doc.discountValue}%)` : ""}</span><span>− {formatMoney(doc.discountAmount, currency)}</span></div>
            )}
            <div className="flex justify-between"><span className="text-gray-500">Tax ({doc.taxRate}%)</span><span>{formatMoney(doc.taxAmount, currency)}</span></div>
            <div className="flex justify-between font-semibold border-t pt-2"><span>Total</span><span>{formatMoney(doc.total, currency)}</span></div>
          </div>
        </div>
      </div>

      {(doc.notes || doc.terms || (doc.type === "INVOICE" && company?.bankDetails)) && (
        <div className="card p-6 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          {doc.notes && <div><div className="text-xs uppercase text-gray-500 mb-1">Notes</div><div className="whitespace-pre-line">{doc.notes}</div></div>}
          {doc.terms && <div><div className="text-xs uppercase text-gray-500 mb-1">Terms</div><div className="whitespace-pre-line">{doc.terms}</div></div>}
          {doc.type === "INVOICE" && company?.bankDetails && (
            <div className="md:col-span-2"><div className="text-xs uppercase text-gray-500 mb-1">Payment details (from {company.name})</div><div className="whitespace-pre-line">{company.bankDetails}</div></div>
          )}
        </div>
      )}
    </div>
  );
}
