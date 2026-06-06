import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { deleteClient } from "./actions";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const clients = await prisma.clientProfile.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-gray-500">Saved client companies you can pick when creating documents.</p>
        </div>
        <Link href="/clients/new" className="btn btn-primary">+ New client</Link>
      </div>

      {clients.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-500">
          No saved clients yet.{" "}
          <Link href="/clients/new" className="text-blue-600 underline">Add your first client</Link>{" "}
          or enter details manually when creating a document.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clients.map((c) => (
            <div key={c.id} className="card p-5">
              <div className="font-semibold truncate">{c.name}</div>
              {c.email && <div className="text-xs text-gray-500 mt-1">{c.email}</div>}
              {c.phone && <div className="text-xs text-gray-500">{c.phone}</div>}
              {c.address && <div className="text-xs text-gray-500 mt-1 whitespace-pre-line line-clamp-3">{c.address}</div>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link className="btn" href={`/clients/${c.id}`}>Edit</Link>
                <form action={deleteClient}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="btn btn-danger">Delete</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
