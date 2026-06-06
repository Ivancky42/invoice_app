"use client";

import Link from "next/link";

type Client = {
  id?: string;
  name?: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  shipToAttn?: string | null;
  shipToAddress?: string | null;
};

export default function ClientForm({ client, action }: { client: Client; action: (fd: FormData) => Promise<void> }) {
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="id" defaultValue={client.id ?? ""} />

      <div className="card p-6 space-y-4">
        <h2 className="font-medium">Bill to</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Client name *</label>
            <input name="name" required className="input" defaultValue={client.name ?? ""} />
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" className="input" defaultValue={client.email ?? ""} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input name="phone" className="input" defaultValue={client.phone ?? ""} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Address</label>
            <textarea name="address" rows={3} className="input" defaultValue={client.address ?? ""} />
          </div>
        </div>
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="font-medium">Default ship to <span className="text-gray-400 font-normal text-sm">(optional)</span></h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Attn</label>
            <input name="shipToAttn" className="input" placeholder="Contact or department" defaultValue={client.shipToAttn ?? ""} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Address</label>
            <textarea name="shipToAddress" rows={3} className="input" placeholder="Delivery address" defaultValue={client.shipToAddress ?? ""} />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Link href="/clients" className="btn">Cancel</Link>
        <button className="btn btn-primary" type="submit">Save client</button>
      </div>
    </form>
  );
}
