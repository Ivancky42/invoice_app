import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from "@react-pdf/renderer";
import { resolveLogoSourceForPdf } from "./logo-storage";
import { DOC_LABELS, LineItem, formatMoney } from "./types";
import React from "react";

/** Original tight layout (pre spacing/pagination experiments). New fields: project, ship-to, PO. */
const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111827" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  brand: { flexDirection: "row", alignItems: "flex-start" },
  logo: { width: 50, height: 50, objectFit: "contain", marginRight: 10 },
  companyName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  small: { fontSize: 9, color: "#4b5563" },
  docTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docMeta: { fontSize: 9, color: "#4b5563", textAlign: "right", marginTop: 4 },
  twoCol: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  block: { width: "48%" },
  label: { fontSize: 8, color: "#6b7280", textTransform: "uppercase", marginBottom: 4 },
  bold: { fontFamily: "Helvetica-Bold" },
  table: { marginTop: 8, borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  th: {
    flexDirection: "row",
    backgroundColor: "#f9fafb",
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  cDesc: { flex: 1 },
  cQty: { width: 50, textAlign: "right" },
  cUnit: { width: 70, textAlign: "right" },
  cAmt: { width: 80, textAlign: "right" },
  totals: { marginTop: 12, alignSelf: "flex-end", width: 240 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLine: { borderTopWidth: 1, borderTopColor: "#111827", marginTop: 4, paddingTop: 6, fontFamily: "Helvetica-Bold" },
  footer: { marginTop: 24, fontSize: 9, color: "#374151" },
  footerBlock: { marginBottom: 8 },
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

export function buildDocPDF(doc: DocLike, company: Profile) {
  const items = (doc.items as LineItem[]) ?? [];
  const currency = company?.currency || "USD";
  const logoFile = resolveLogoSourceForPdf(company?.logoPath);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brand}>
            {logoFile ? <Image style={styles.logo} src={logoFile} /> : null}
            <View>
              <Text style={styles.companyName}>{company?.name || "Your Company"}</Text>
              {company?.address ? <Text style={styles.small}>{company.address}</Text> : null}
              {company?.email ? <Text style={styles.small}>{company.email}</Text> : null}
              {company?.phone ? <Text style={styles.small}>{company.phone}</Text> : null}
              {company?.registration ? <Text style={styles.small}>Reg: {company.registration}</Text> : null}
              {company?.taxId ? <Text style={styles.small}>Tax ID: {company.taxId}</Text> : null}
            </View>
          </View>
          <View>
            <Text style={styles.docTitle}>{DOC_LABELS[doc.type]?.toUpperCase()}</Text>
            <Text style={styles.docMeta}>No. {doc.number}</Text>
            <Text style={styles.docMeta}>Date: {new Date(doc.issueDate).toLocaleDateString()}</Text>
            {doc.dueDate ? <Text style={styles.docMeta}>Due: {new Date(doc.dueDate).toLocaleDateString()}</Text> : null}
            {doc.paymentTerms ? <Text style={styles.docMeta}>Terms: {doc.paymentTerms}</Text> : null}
            {doc.projectTitle ? <Text style={styles.docMeta}>Project: {doc.projectTitle}</Text> : null}
            {doc.poNumber && (doc.type === "INVOICE" || doc.type === "DELIVERY_ORDER") ? (
              <Text style={styles.docMeta}>PO: {doc.poNumber}</Text>
            ) : null}
            <Text style={styles.docMeta}>Status: {doc.status}</Text>
          </View>
        </View>

        {doc.shipToAttn || doc.shipToAddress ? (
          <View style={styles.twoCol}>
            <View style={styles.block}>
              <Text style={styles.label}>Bill To</Text>
              <Text style={styles.bold}>{doc.clientName}</Text>
              {doc.clientAddress ? <Text>{doc.clientAddress}</Text> : null}
              {doc.clientEmail ? <Text>{doc.clientEmail}</Text> : null}
              {doc.clientPhone ? <Text>{doc.clientPhone}</Text> : null}
            </View>
            <View style={styles.block}>
              <Text style={styles.label}>Ship To</Text>
              {doc.shipToAttn ? (
                <Text>
                  <Text style={styles.bold}>Attn: </Text>
                  {doc.shipToAttn}
                </Text>
              ) : null}
              {doc.shipToAddress ? <Text>{doc.shipToAddress}</Text> : null}
            </View>
          </View>
        ) : (
          <View style={{ marginBottom: 16 }}>
            <Text style={styles.label}>Bill To</Text>
            <Text style={styles.bold}>{doc.clientName}</Text>
            {doc.clientAddress ? <Text>{doc.clientAddress}</Text> : null}
            {doc.clientEmail ? <Text>{doc.clientEmail}</Text> : null}
            {doc.clientPhone ? <Text>{doc.clientPhone}</Text> : null}
          </View>
        )}

        {doc.projectDescription ? (
          <View style={{ marginBottom: 16 }}>
            <Text style={styles.label}>Project description</Text>
            <Text style={styles.small}>{doc.projectDescription}</Text>
          </View>
        ) : null}

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cDesc}>Description</Text>
            <Text style={styles.cQty}>Qty</Text>
            <Text style={styles.cUnit}>Unit</Text>
            <Text style={styles.cAmt}>Amount</Text>
          </View>
          {items.map((it, i) => (
            <View style={styles.tr} key={i}>
              <Text style={styles.cDesc}>{it.description}</Text>
              <Text style={styles.cQty}>{it.quantity}</Text>
              <Text style={styles.cUnit}>{formatMoney(it.unitPrice, currency)}</Text>
              <Text style={styles.cAmt}>{formatMoney((it.quantity || 0) * (it.unitPrice || 0), currency)}</Text>
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
              <Text>{doc.paymentTerms}</Text>
            </View>
          ) : null}
          {doc.notes ? (
            <View style={styles.footerBlock}>
              <Text style={styles.label}>Notes</Text>
              <Text>{doc.notes}</Text>
            </View>
          ) : null}
          {doc.terms ? (
            <View style={styles.footerBlock}>
              <Text style={styles.label}>Terms</Text>
              <Text>{doc.terms}</Text>
            </View>
          ) : null}
          {company?.bankDetails && doc.type === "INVOICE" ? (
            <View style={styles.footerBlock}>
              <Text style={styles.label}>Payment Details</Text>
              <Text>{company.bankDetails}</Text>
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
