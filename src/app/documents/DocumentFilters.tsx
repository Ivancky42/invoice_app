"use client";

import { useRouter, useSearchParams } from "next/navigation";
import AppSelect from "@/components/AppSelect";

type Option = { id: string; name: string };

export default function DocumentFilters({
  companies,
  clients,
}: {
  companies: Option[];
  clients: Option[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const STATUS_OPTIONS = [
    { value: "", label: "All statuses" },
    { value: "DRAFT", label: "Draft" },
    { value: "ISSUED", label: "Issued" },
    { value: "PAID", label: "Paid" },
    { value: "CANCELLED", label: "Cancelled" },
  ] as const;

  function update(key: "company" | "client" | "status", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    router.push(qs ? `/documents?${qs}` : "/documents");
  }

  const company = searchParams.get("company") ?? "";
  const client = searchParams.get("client") ?? "";
  const status = searchParams.get("status") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <AppSelect
        value={company}
        onValueChange={(value) => update("company", value)}
        options={[
          { value: "", label: "All billers" },
          ...companies.map((c) => ({ value: c.id, label: c.name })),
        ]}
        placeholder="All billers"
        triggerClassName="w-auto min-w-[10rem]"
        aria-label="Filter by biller"
      />
      <AppSelect
        value={client}
        onValueChange={(value) => update("client", value)}
        options={[
          { value: "", label: "All clients" },
          ...clients.map((c) => ({ value: c.id, label: c.name })),
        ]}
        placeholder="All clients"
        triggerClassName="w-auto min-w-[10rem]"
        aria-label="Filter by client"
      />
      <AppSelect
        value={status}
        onValueChange={(value) => update("status", value)}
        options={[...STATUS_OPTIONS]}
        placeholder="All statuses"
        triggerClassName="w-auto min-w-[10rem]"
        aria-label="Filter by status"
      />
      {(company || client || status) && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("company");
            params.delete("client");
            params.delete("status");
            const qs = params.toString();
            router.push(qs ? `/documents?${qs}` : "/documents");
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
