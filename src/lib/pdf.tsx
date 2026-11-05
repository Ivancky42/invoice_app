import { Document, Font, Page, Text, View, StyleSheet, Image, renderToBuffer } from "@react-pdf/renderer";
import { resolveLogoSourceForPdf } from "./logo-storage";
import { DOC_LABELS, LineItem, formatMoney } from "./types";
import { quoteValidUntil } from "./invoicing/schedule";
import React from "react";

// Wrap at spaces only: the default hyphenator splits words ("Re-tainer"), which reads poorly on an invoice.
Font.registerHyphenationCallback((word) => [word]);

const INK = "#111827";
const MUTED = "#6b7280";
const SOFT = "#4b5563";
const RULE = "#e5e7eb";
const BAND = "#f3f4f6";

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 72,
    paddingHorizontal: 48,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: INK,
  },
  // Line height lives on the body, not the page: react-pdf drops a fixed footer with a
  // page-number render() when the page itself carries a lineHeight. A unitless lineHeight
  // resolves against the fontSize in the same style (default 18), so both go together.
  body: { fontSize: 9.5, lineHeight: 1.45 },

  // Header: biller on the left, document title + key facts on the right.
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  brand: { width: 260 },
  logo: {
    height: 44,
    maxWidth: 160,
    objectFit: "contain",
    objectPosition: "left",
    marginBottom: 10,
  },
  companyName: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  companyLine: { fontSize: 8.5, color: SOFT },
  titleBlock: { width: 230, alignItems: "flex-end" },
  docTitle: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    lineHeight: 1.1,
  },
  badge: {
    marginTop: 6,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 3,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    lineHeight: 1.3,
  },
  meta: { marginTop: 12, width: 230 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1.5,
  },
  metaLabel: { color: MUTED, fontSize: 8.5 },
  metaValue: { fontSize: 9, textAlign: "right", maxWidth: 130 },
  metaStrong: { fontFamily: "Helvetica-Bold" },

  divider: {
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    marginTop: 20,
    marginBottom: 18,
  },

  label: {
    fontSize: 7.5,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 5,
  },
  parties: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  party: { width: "47%" },
  partyName: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 2 },
  partyLine: { color: SOFT },

  project: { marginBottom: 18 },
  projectTitle: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 3 },
  projectText: { color: SOFT },

  // Line items. Amount columns are plain numbers; the currency sits in the header.
  th: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: INK,
    fontSize: 7.5,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  cNo: { width: 22, color: MUTED },
  cDesc: { flex: 1, paddingRight: 12 },
  cQty: { width: 44, textAlign: "right" },
  cUnit: { width: 86, textAlign: "right" },
  cAmt: { width: 90, textAlign: "right" },

  totals: { marginTop: 10, alignSelf: "flex-end", width: 240 },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  totalsLabel: { color: SOFT },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: BAND,
    borderRadius: 3,
  },
  grandLabel: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  grandValue: { fontFamily: "Helvetica-Bold", fontSize: 12 },

  info: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 26,
  },
  infoCol: { width: "47%" },
  infoBlock: { marginBottom: 14 },
  infoText: { color: SOFT },
  reference: { marginTop: 4, fontSize: 8.5, color: SOFT },

  signatures: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 36,
  },
  acceptNote: { marginTop: 30, color: SOFT },
  sigCol: { width: "44%" },
  sigLine: {
    borderBottomWidth: 1,
    borderBottomColor: INK,
    height: 40,
    marginBottom: 5,
  },
  sigCaption: { fontSize: 8, color: MUTED },

  footer: {
    position: "absolute",
    left: 48,
    right: 48,
    bottom: 28,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: RULE,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: MUTED,
  },
});

type DocLike = {
  type: string;
  status?: string | null;
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  clientName: string;
  clientAddress: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  shipToAttn: string | null;
  shipToAddress: string | null;
  poNumber: string | null;
  projectTitle: string | null;
  projectDescription: string | null;
  items: any;
  subtotal: number;
  discountType: string;
  discountValue: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentTerms: string | null;
  notes: string | null;
  terms: string | null;
};

type Profile = {
  name: string;
  address: string;
  email: string | null;
  phone: string | null;
  registration: string | null;
  taxId: string | null;
  bankDetails: string | null;
  logoPath: string | null;
  currency: string;
} | null;

/** Dates are stored as UTC-midnight calendar days; print them unambiguously ("1 November 2026"). */
export function pdfDate(d: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(d));
}

/** 2,000.00 — the table's amount columns; the currency is in the column header. */
export function pdfAmount(n: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

/** 1, 2.5, 0.25 — no trailing zeros. */
export function pdfQty(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(n || 0);
}

/** "https://grumpypixels.my/" → "grumpypixels.my"; anything else unchanged. */
export function displayContact(s: string): string {
  const t = s.trim();
  return /^https?:\/\//i.test(t) ? t.replace(/^https?:\/\//i, "").replace(/\/$/, "") : t;
}

/** Text fields typed in Windows/forms carry \r\n; keep one newline per break. */
function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\r\n?/g, "\n").trim();
}

function lines(s: string | null | undefined): string[] {
  return clean(s)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function MetaRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={strong ? [styles.metaValue, styles.metaStrong] : styles.metaValue}>{value}</Text>
    </View>
  );
}

const BADGES: Record<string, { text: string; color: string; bg: string }> = {
  PAID: { text: "PAID", color: "#166534", bg: "#dcfce7" },
  CANCELLED: { text: "CANCELLED", color: "#991b1b", bg: "#fee2e2" },
};

export function buildDocPDF(doc: DocLike, company: Profile) {
  const items = (doc.items as LineItem[]) ?? [];
  const currency = company?.currency || "USD";
  const logoFile = resolveLogoSourceForPdf(company?.logoPath);
  const label = DOC_LABELS[doc.type] ?? "Document";
  const isInvoice = doc.type === "INVOICE";
  const isDeliveryOrder = doc.type === "DELIVERY_ORDER";
  const isQuotation = doc.type === "QUOTATION";
  const badge = doc.status ? BADGES[doc.status] : undefined;
  const showTax = doc.taxRate > 0 || doc.taxAmount > 0;
  const bank = isInvoice ? lines(company?.bankDetails) : [];
  const companyName = company?.name || "Your Company";
  const companyContacts = [company?.email, company?.phone].filter(Boolean).map((c) => displayContact(c!));

  const party = (title: string, name: string | null, rows: (string | null | undefined)[]) => (
    <View style={styles.party}>
      <Text style={styles.label}>{title}</Text>
      {name ? <Text style={styles.partyName}>{name}</Text> : null}
      {rows
        .flatMap((r) => lines(r))
        .map((l, i) => (
          <Text key={i} style={styles.partyLine}>
            {l}
          </Text>
        ))}
    </View>
  );

  return (
    // Fixed metadata dates keep the bytes identical across renders, so a retried email
    // carries exactly the same attachment (Resend idempotency compares the whole request).
    <Document
      title={`${label} ${doc.number}`}
      author={companyName}
      creator={companyName}
      producer={companyName}
      creationDate={doc.issueDate}
      modificationDate={doc.issueDate}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.body}>
          <View style={styles.header}>
            <View style={styles.brand}>
              {logoFile ? <Image style={styles.logo} src={logoFile} /> : null}
              <Text style={styles.companyName}>{companyName}</Text>
              {lines(company?.address).map((l, i) => (
                <Text key={`a${i}`} style={styles.companyLine}>
                  {l}
                </Text>
              ))}
              {companyContacts.length ? <Text style={styles.companyLine}>{companyContacts.join("  ·  ")}</Text> : null}
              {company?.registration ? <Text style={styles.companyLine}>Reg. no. {company.registration}</Text> : null}
              {company?.taxId ? <Text style={styles.companyLine}>Tax ID {company.taxId}</Text> : null}
            </View>

            <View style={styles.titleBlock}>
              <Text style={[styles.docTitle, { fontSize: label.length > 10 ? 18 : 22 }]}>{label.toUpperCase()}</Text>
              {badge ? (
                <Text style={[styles.badge, { color: badge.color, backgroundColor: badge.bg }]}>{badge.text}</Text>
              ) : null}
              <View style={styles.meta}>
                <MetaRow label={`${label} no.`} value={doc.number} strong />
                <MetaRow label="Date" value={pdfDate(doc.issueDate)} />
                {isInvoice && doc.dueDate ? <MetaRow label="Due date" value={pdfDate(doc.dueDate)} strong /> : null}
                {isQuotation ? <MetaRow label="Valid until" value={pdfDate(quoteValidUntil(doc))} strong /> : null}
                {doc.paymentTerms && !isDeliveryOrder ? <MetaRow label="Terms" value={doc.paymentTerms} /> : null}
                {doc.poNumber && (isInvoice || isDeliveryOrder) ? (
                  <MetaRow label="PO no." value={doc.poNumber} />
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.parties}>
            {party("Bill to", doc.clientName, [doc.clientAddress, doc.clientEmail, doc.clientPhone])}
            {doc.shipToAttn || doc.shipToAddress
              ? party("Ship to", doc.shipToAttn ? `Attn: ${doc.shipToAttn}` : null, [doc.shipToAddress])
              : null}
          </View>

          {doc.projectTitle || doc.projectDescription ? (
            <View style={styles.project} wrap={false}>
              <Text style={styles.label}>Project</Text>
              {doc.projectTitle ? <Text style={styles.projectTitle}>{doc.projectTitle}</Text> : null}
              {doc.projectDescription ? <Text style={styles.projectText}>{clean(doc.projectDescription)}</Text> : null}
            </View>
          ) : null}

          <View style={styles.th} fixed>
            <Text style={styles.cNo}>#</Text>
            <Text style={styles.cDesc}>Description</Text>
            <Text style={styles.cQty}>Qty</Text>
            {!isDeliveryOrder ? (
              <>
                <Text style={styles.cUnit}>Unit price ({currency})</Text>
                <Text style={styles.cAmt}>Amount ({currency})</Text>
              </>
            ) : null}
          </View>
          {items.map((it, i) => (
            <View style={styles.tr} key={i} wrap={false}>
              <Text style={styles.cNo}>{i + 1}</Text>
              <Text style={styles.cDesc}>{clean(it.description)}</Text>
              <Text style={styles.cQty}>{pdfQty(it.quantity)}</Text>
              {!isDeliveryOrder ? (
                <>
                  <Text style={styles.cUnit}>{pdfAmount(it.unitPrice)}</Text>
                  <Text style={styles.cAmt}>{pdfAmount((it.quantity || 0) * (it.unitPrice || 0))}</Text>
                </>
              ) : null}
            </View>
          ))}

          {!isDeliveryOrder ? (
            <View style={styles.totals} wrap={false}>
              {doc.discountAmount > 0 || showTax ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>Subtotal</Text>
                  <Text>{formatMoney(doc.subtotal, currency)}</Text>
                </View>
              ) : null}
              {doc.discountAmount > 0 ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>
                    Discount
                    {doc.discountType === "PERCENT" ? ` (${doc.discountValue}%)` : ""}
                  </Text>
                  <Text>-{formatMoney(doc.discountAmount, currency)}</Text>
                </View>
              ) : null}
              {showTax ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>Tax ({doc.taxRate}%)</Text>
                  <Text>{formatMoney(doc.taxAmount, currency)}</Text>
                </View>
              ) : null}
              <View style={styles.grandTotal}>
                <Text style={styles.grandLabel}>
                  {isInvoice ? (doc.status === "PAID" ? "Total paid" : "Total due") : "Total"}
                </Text>
                <Text style={styles.grandValue}>{formatMoney(doc.total, currency)}</Text>
              </View>
            </View>
          ) : null}

          {bank.length || doc.notes || doc.terms ? (
            <View style={styles.info} wrap={false}>
              <View style={styles.infoCol}>
                {bank.length ? (
                  <View style={styles.infoBlock}>
                    <Text style={styles.label}>Payment details</Text>
                    {bank.map((l, i) => (
                      <Text key={i} style={styles.infoText}>
                        {l}
                      </Text>
                    ))}
                    {doc.status !== "PAID" ? (
                      <Text style={styles.reference}>Please quote {doc.number} as the payment reference.</Text>
                    ) : null}
                  </View>
                ) : null}
                {!bank.length && doc.notes ? (
                  <View style={styles.infoBlock}>
                    <Text style={styles.label}>Notes</Text>
                    <Text style={styles.infoText}>{clean(doc.notes)}</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.infoCol}>
                {bank.length && doc.notes ? (
                  <View style={styles.infoBlock}>
                    <Text style={styles.label}>Notes</Text>
                    <Text style={styles.infoText}>{clean(doc.notes)}</Text>
                  </View>
                ) : null}
                {doc.terms ? (
                  <View style={styles.infoBlock}>
                    <Text style={styles.label}>Terms &amp; conditions</Text>
                    <Text style={styles.infoText}>{clean(doc.terms)}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {isDeliveryOrder || isQuotation ? (
            <View wrap={false}>
              {isQuotation ? (
                <Text style={styles.acceptNote}>
                  To accept this quotation, please sign and return a copy by {pdfDate(quoteValidUntil(doc))}.
                </Text>
              ) : null}
              <View style={isQuotation ? [styles.signatures, { marginTop: 6 }] : styles.signatures}>
                <View style={styles.sigCol}>
                  <View style={styles.sigLine} />
                  <Text style={styles.sigCaption}>
                    {isQuotation ? `Authorised signature, ${companyName}` : `Issued by ${companyName}`}
                  </Text>
                </View>
                <View style={styles.sigCol}>
                  <View style={styles.sigLine} />
                  <Text style={styles.sigCaption}>
                    {isQuotation ? `Accepted by ${doc.clientName}` : "Received in good order and condition"}
                  </Text>
                  <Text style={styles.sigCaption}>Name, signature, company stamp and date</Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {companyName}
            {company?.email ? `  ·  ${company.email}` : ""}
          </Text>
          <Text>{`${label} ${doc.number}`}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderDocPDF(doc: DocLike, company: Profile): Promise<Buffer> {
  return await renderToBuffer(buildDocPDF(doc, company) as any);
}
