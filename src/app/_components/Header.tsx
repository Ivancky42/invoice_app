"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { lockSiteGate } from "@/lib/site-gate-actions";

const STOCK_PATHS = ["/stocks"] as const;
const INVOICE_PATHS = ["/invoices", "/documents", "/settings", "/clients"] as const;

type App = "invoices" | "stocks" | null;

function activeApp(pathname: string): App {
  if (STOCK_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return "stocks";
  if (INVOICE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return "invoices";
  return null;
}

const stockLinks = [
  { href: "/stocks", label: "Overview" },
  { href: "/stocks/portfolio", label: "Portfolio" },
  { href: "/stocks/watchlist", label: "Watchlist" },
  { href: "/stocks/trades", label: "Trades" },
  { href: "/stocks/trends", label: "Trends" },
  { href: "/stocks/ideas", label: "Ideas" },
  { href: "/stocks/daily-log", label: "Daily log" },
  { href: "/stocks/reports", label: "Reports" },
];

const invoiceLinks = [
  { href: "/invoices", label: "Dashboard" },
  { href: "/documents", label: "Documents" },
  { href: "/documents/new?type=QUOTATION", label: "New" },
  { href: "/clients", label: "Clients" },
  { href: "/settings", label: "Settings" },
];

export function Header({ pinGate }: { pinGate: boolean }) {
  const pathname = usePathname() || "/";
  const app = activeApp(pathname);

  const isStocksActive = app === "stocks";
  const isInvoicesActive = app === "invoices";

  const subLinks = app === "stocks" ? stockLinks : app === "invoices" ? invoiceLinks : [];

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="font-semibold text-gray-900">
          Command Center
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/invoices"
            className={`px-3 py-1.5 rounded-md font-medium transition ${
              isInvoicesActive ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Invoices
          </Link>
          <Link
            href="/stocks"
            className={`px-3 py-1.5 rounded-md font-medium transition ${
              isStocksActive ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Stocks
          </Link>
        </nav>

        <div className="flex items-center gap-4 text-sm">
          {pinGate && (
            <form action={lockSiteGate} className="inline">
              <button type="submit" className="text-gray-500 hover:text-gray-800 hover:underline">
                Lock (PIN)
              </button>
            </form>
          )}
        </div>
      </div>

      {subLinks.length > 0 && (
        <div className="border-t border-gray-100 bg-gray-50">
          <div className="max-w-6xl mx-auto px-6 py-2 flex items-center gap-4 text-sm overflow-x-auto">
            {subLinks.map((l) => {
              const path = l.href.split("?")[0];
              const isActive =
                pathname === path ||
                (path !== "/" && path !== "/documents" && pathname.startsWith(`${path}/`)) ||
                (path === "/documents" && pathname === "/documents");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`whitespace-nowrap ${
                    isActive ? "text-gray-900 font-medium" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
