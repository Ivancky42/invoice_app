import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from "@react-pdf/renderer";
import { resolveLogoSourceForPdf } from "./logo-storage";
import { DOC_LABELS, LineItem, formatMoney } from "./types";
import React from "react";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111827" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  brand: { flexDirection: "row", alignItems: "flex-start" },
  logo: { width: 50, height: 50, objectFit: "contain", marginRight: 10 },
  companyName: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  companyDetails: { fontSize: 9, color: "#4b5563", lineHeight: 11 },
  docTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docMeta: { fontSize: 9, color: "#4b5563", textAlign: "right", marginTop: 3 },
  twoCol: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  billShipSection: { marginBottom: 10 },
  block: { width: "48%" },
  label: { fontSize: 8, color: "#6b7280", textTransform: "uppercase", marginBottom: 4 },
  partyName: { fontFamily: "Helvetica-Bold", fontSize: 10, lineHeight: 12, marginBottom: 2 },
  partyDetails: { fontSize: 10, lineHeight: 12 },
  table: { marginTop: 6, borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  th: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#f9fafb",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  thCellText: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  tr: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  cDescCell: { width: "50%", paddingRight: 6 },
  cQtyCell: { width: "12%", paddingRight: 4 },
  cUnitCell: { width: "19%", paddingRight: 4 },
  cAmtCell: { width: "19%" },
  trDescText: { fontSize: 10 },
  trCellRight: { fontSize: 10, textAlign: "right" },
  totals: { marginTop: 10, alignSelf: "flex-end", width: 240 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLine: { borderTopWidth: 1, borderTopColor: "#111827", marginTop: 4, paddingTop: 6, fontFamily: "Helvetica-Bold" },
  footer: { marginTop: 16, fontSize: 9, color: "#374151" },
  footerBlock: { marginBottom: 7 },
  footerBody: { fontSize: 9, color: "#374151", lineHeight: 12 },
  projectSection: {
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  projectTitleLine: { fontSize: 11, fontFamily: "Helvetica-Bold", lineHeight: 13, marginBottom: 2 },
  projectDesc: { fontSize: 9, color: "#374151", lineHeight: 11 },
});

type DocLike = {
  type: string;
  number: string;
  status: string;
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

/** Collapse multi-line fields into one Text node — avoids react-pdf flex-row + many siblings blowing up pagination. */
function pdfJoinLines(...parts: (string | null | undefined)[]): string {
  const lines: string[] = [];
  for (const p of parts) {
    const s = typeof p === "string" ? p.trim() : "";
    if (s) lines.push(s);
  }
  return lines.join("\n");
}

export function buildDocPDF(doc: DocLike, company: Profile) {
  const items = (doc.items as LineItem[]) ?? [];
  const currency = company?.currency || "USD";
  const logoFile = resolveLogoSourceForPdf(company?.logoPath);

  const companyLines = pdfJoinLines(
    company?.address,
    company?.email ?? undefined,
    company?.phone ?? undefined,
    company?.registration ? `Reg: ${company.registration}` : undefined,
    company?.taxId ? `Tax ID: ${company.taxId}` : undefined,
  );

  const billLines = pdfJoinLines(doc.clientAddress, doc.clientEmail, doc.clientPhone);

  const shipLines = pdfJoinLines(
    doc.shipToAttn ? `Attn: ${doc.shipToAttn}` : undefined,
    doc.shipToAddress ?? undefined,
  );

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header} wrap={false}>
          <View style={styles.brand}>
            {logoFile ? <Image style={styles.logo} src={logoFile} /> : null}
            <View>
              <Text style={styles.companyName}>{company?.name || "Your Company"}</Text>
              {companyLines ? (
                <Text style={styles.companyDetails} orphans={1} widows={1}>
                  {companyLines}
                </Text>
              ) : null}
            </View>
          </View>
          <View>
            <Text style={styles.docTitle}>{DOC_LABELS[doc.type]?.toUpperCase()}</Text>
            <Text style={styles.docMeta}>No. {doc.number}</Text>
            <Text style={styles.docMeta}>Date: {new Date(doc.issueDate).toLocaleDateString()}</Text>
            {doc.dueDate ? <Text style={styles.docMeta}>Due: {new Date(doc.dueDate).toLocaleDateString()}</Text> : null}
            {doc.paymentTerms ? <Text style={styles.docMeta}>Terms: {doc.paymentTerms}</Text> : null}
            {doc.poNumber && (doc.type === "INVOICE" || doc.type === "DELIVERY_ORDER") ? (
              <Text style={styles.docMeta}>PO: {doc.poNumber}</Text>
            ) : null}
            <Text style={styles.docMeta}>Status: {doc.status}</Text>
          </View>
        </View>

        {doc.projectTitle || doc.projectDescription ? (
          <View style={styles.projectSection}>
            <Text style={styles.label}>Project</Text>
            {doc.projectTitle ? (
              <Text style={styles.projectTitleLine} orphans={1} widows={1}>
                {doc.projectTitle}
              </Text>
            ) : null}
            {doc.projectDescription ? (
              <Text style={styles.projectDesc} orphans={1} widows={1}>
                {doc.projectDescription}
              </Text>
            ) : null}
          </View>
        ) : null}

        {doc.shipToAttn || doc.shipToAddress ? (
          <View style={styles.twoCol}>
            <View style={styles.block}>
              <Text style={styles.label}>Bill To</Text>
              <Text style={styles.partyName}>{doc.clientName}</Text>
              {billLines ? (
                <Text style={styles.partyDetails} orphans={1} widows={1}>
                  {billLines}
                </Text>
              ) : null}
            </View>
            <View style={styles.block}>
              <Text style={styles.label}>Ship To</Text>
              {shipLines ? (
                <Text style={styles.partyDetails} orphans={1} widows={1}>
                  {shipLines}
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.billShipSection}>
            <Text style={styles.label}>Bill To</Text>
            <Text style={styles.partyName}>{doc.clientName}</Text>
            {billLines ? (
              <Text style={styles.partyDetails} orphans={1} widows={1}>
                {billLines}
              </Text>
            ) : null}
          </View>
        )}

        <View style={styles.table}>
          <View style={styles.th}>
            <View style={styles.cDescCell}>
              <Text style={styles.thCellText}>Description</Text>
            </View>
            <View style={styles.cQtyCell}>
              <Text style={[styles.thCellText, { textAlign: "right" }]}>Qty</Text>
            </View>
            <View style={styles.cUnitCell}>
              <Text style={[styles.thCellText, { textAlign: "right" }]}>Unit</Text>
            </View>
            <View style={styles.cAmtCell}>
              <Text style={[styles.thCellText, { textAlign: "right" }]}>Amount</Text>
            </View>
          </View>
          {items.map((it, i) => (
            <View style={styles.tr} key={i}>
              <View style={styles.cDescCell}>
                <Text style={styles.trDescText} orphans={1} widows={1}>
                  {it.description}
                </Text>
              </View>
              <View style={styles.cQtyCell}>
                <Text style={styles.trCellRight}>{it.quantity}</Text>
              </View>
              <View style={styles.cUnitCell}>
                <Text style={styles.trCellRight}>{formatMoney(it.unitPrice, currency)}</Text>
              </View>
              <View style={styles.cAmtCell}>
                <Text style={styles.trCellRight}>{formatMoney((it.quantity || 0) * (it.unitPrice || 0), currency)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text>Subtotal</Text>
            <Text>{formatMoney(doc.subtotal, currency)}</Text>
          </View>
          {doc.discountAmount > 0 ? (
            <View style={styles.totalsRow}>
              <Text>Discount{doc.discountType === "PERCENT" ? ` (${doc.discountValue}%)` : ""}</Text>
              <Text>- {formatMoney(doc.discountAmount, currency)}</Text>
            </View>
          ) : null}
          <View style={styles.totalsRow}>
            <Text>Tax ({doc.taxRate}%)</Text>
            <Text>{formatMoney(doc.taxAmount, currency)}</Text>
          </View>
          <View style={[styles.totalsRow, styles.totalLine]}>
            <Text>Total</Text>
            <Text>{formatMoney(doc.total, currency)}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          {doc.paymentTerms ? (
            <View style={styles.footerBlock}>
              <Text style={styles.label}>Payment Terms</Text>
              <Text style={styles.footerBody} orphans={1} widows={1}>
                {doc.paymentTerms}
              </Text>
            </View>
          ) : null}
          {doc.notes ? (
            <View style={styles.footerBlock}>
              <Text style={styles.label}>Notes</Text>
              <Text style={styles.footerBody} orphans={1} widows={1}>
                {doc.notes}
              </Text>
            </View>
          ) : null}
          {doc.terms ? (
            <View style={styles.footerBlock}>
              <Text style={styles.label}>Terms</Text>
              <Text style={styles.footerBody} orphans={1} widows={1}>
                {doc.terms}
              </Text>
            </View>
          ) : null}
          {company?.bankDetails && doc.type === "INVOICE" ? (
            <View style={styles.footerBlock}>
              <Text style={styles.label}>Payment Details</Text>
              <Text style={styles.footerBody} orphans={1} widows={1}>
                {company.bankDetails}
              </Text>
            </View>
          ) : null}
        </View>
      </Page>
    </Document>
  );
}

export async function renderDocPDF(doc: DocLike, company: Profile): Promise<Buffer> {
  return await renderToBuffer(buildDocPDF(doc, company) as any);
}
