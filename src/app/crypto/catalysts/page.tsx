import { catalystToDTO, getCatalysts, type CryptoCatalystDTO } from "@/lib/crypto/db";
import { fmtShortDateUtc } from "@/lib/crypto/format";

export const revalidate = 900;

function dayKey(c: CryptoCatalystDTO): string {
  return (c.publishedAt ?? "").slice(0, 10) || "Undated";
}

export default async function CryptoCatalystsPage() {
  const catalysts = (await getCatalysts(14)).map(catalystToDTO);

  const groups = new Map<string, CryptoCatalystDTO[]>();
  for (const c of catalysts) {
    const key = dayKey(c);
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  const orderedKeys = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : -1));

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Catalysts</h1>
        <p className="text-sm text-gray-500">News matched to tracked symbols (last 14 days).</p>
      </section>

      {catalysts.length === 0 && (
        <div className="card p-8 text-center text-sm text-gray-500">No catalysts in the last 14 days.</div>
      )}

      {orderedKeys.map((key) => (
        <section key={key} className="card overflow-hidden">
          <div className="px-5 py-2 border-b border-gray-200 bg-gray-50">
            <h2 className="font-medium text-sm">
              {key === "Undated" ? "Undated" : fmtShortDateUtc(key)}
            </h2>
          </div>
          <ul className="divide-y">
            {groups.get(key)!.map((c) => (
              <li key={c.id} className="px-5 py-3">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {c.title}
                </a>
                <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>{c.source}</span>
                  {c.symbols.map((s) => (
                    <span key={s} className="badge bg-gray-100 text-gray-600">
                      {s}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
