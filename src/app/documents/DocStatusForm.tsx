"use client";

import { useState } from "react";
import AppSelect from "@/components/AppSelect";

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "DRAFT" },
  { value: "ISSUED", label: "ISSUED" },
  { value: "PAID", label: "PAID" },
  { value: "CANCELLED", label: "CANCELLED" },
];

export default function DocStatusForm({
  action,
  defaultStatus,
}: {
  action: (formData: FormData) => Promise<void>;
  defaultStatus: string;
}) {
  const [status, setStatus] = useState(defaultStatus);

  return (
    <form action={action} className="flex gap-1">
      <input type="hidden" name="status" value={status} />
      <AppSelect
        value={status}
        onValueChange={setStatus}
        options={STATUS_OPTIONS}
        triggerClassName="!w-auto min-w-[8rem]"
        aria-label="Document status"
      />
      <button className="btn" type="submit">
        Update
      </button>
    </form>
  );
}
