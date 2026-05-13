import "./globals.css";
import type { Metadata } from "next";
import { gateConfigured } from "@/lib/site-gate";
import { Header } from "@/app/_components/Header";

export const metadata: Metadata = {
  title: "Command Center",
  description: "Personal command center: invoices and stock dashboard",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pinGate = gateConfigured();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Header pinGate={pinGate} />
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
