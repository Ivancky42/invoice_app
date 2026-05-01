import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";
import { gateConfigured } from "@/lib/site-gate";
import { lockSiteGate } from "@/lib/site-gate-actions";

export const metadata: Metadata = {
  title: "Invoice App",
  description: "Simple invoicing with quotation, invoice and DO lifecycle",
};

/** Read APP_PIN / APP_GATE_SECRET per request so production env is not baked in at build time. */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pinGate = gateConfigured();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-gray-200 bg-white">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <Link href="/" className="font-semibold text-gray-900">Invoice App</Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/documents" className="hover:underline">Documents</Link>
              <Link href="/documents/new?type=QUOTATION" className="hover:underline">New</Link>
              <Link href="/settings" className="hover:underline">Settings</Link>
              {pinGate && (
                <form action={lockSiteGate} className="inline">
                  <button type="submit" className="hover:underline text-gray-500 hover:text-gray-800">
                    Lock (PIN)
                  </button>
                </form>
              )}
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
