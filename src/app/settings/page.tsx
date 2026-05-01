import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { setDefaultProfile, deleteProfile } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profiles = await prisma.companyProfile.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Company profiles</h1>
          <p className="text-sm text-gray-500">Each profile has its own branding and is selectable per document.</p>
        </div>
        <Link href="/settings/new" className="btn btn-primary">+ New profile</Link>
      </div>

      {profiles.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-500">
          No company profiles yet. <Link href="/settings/new" className="text-blue-600 underline">Create your first profile</Link>.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map((p) => (
            <div key={p.id} className="card p-5">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-gray-50 border border-gray-200 rounded flex items-center justify-center overflow-hidden">
                  {p.logoPath ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.logoPath} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-xs text-gray-400">No logo</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold truncate">{p.name}</div>
                    {p.isDefault && <span className="badge bg-green-100 text-green-700">Default</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-1 whitespace-pre-line line-clamp-3">{p.address}</div>
                  <div className="text-xs text-gray-500 mt-1">{p.currency} · {p.taxRate}% tax</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link className="btn" href={`/settings/${p.id}`}>Edit</Link>
                {!p.isDefault && (
                  <form action={setDefaultProfile}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="btn">Make default</button>
                  </form>
                )}
                <form action={deleteProfile}>
                  <input type="hidden" name="id" value={p.id} />
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
