import {
  briefToDTO,
  getBriefs,
  getLearnings,
  learningToDTO,
  type CryptoLearningDTO,
} from "@/lib/crypto/db";
import { CryptoLearningKind } from "@/generated/prisma/client";
import { CryptoBriefReader } from "@/app/crypto/_components/CryptoBriefReader";
import { fmtShortDateUtc } from "@/lib/crypto/format";

export const revalidate = 900;

const KIND_ORDER: CryptoLearningKind[] = [
  CryptoLearningKind.DAILY,
  CryptoLearningKind.WEEKLY,
  CryptoLearningKind.MONTHLY,
];

const KIND_LABEL: Record<CryptoLearningKind, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
};

export default async function CryptoBriefsPage() {
  const [briefsRaw, learningsRaw] = await Promise.all([getBriefs(30), getLearnings(undefined, 60)]);

  const briefs = briefsRaw.map(briefToDTO);
  const learnings = learningsRaw.map(learningToDTO);

  const byKind = new Map<CryptoLearningKind, CryptoLearningDTO[]>();
  for (const l of learnings) {
    const arr = byKind.get(l.kind) ?? [];
    arr.push(l);
    byKind.set(l.kind, arr);
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Briefs &amp; learnings</h1>
        <p className="text-sm text-gray-500">AI daily briefs plus the self-improving playbook.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-700">Brief history</h2>
        {briefs.length === 0 && (
          <div className="card p-8 text-center text-sm text-gray-500">No briefs yet.</div>
        )}
        {briefs.map((b) => (
          <div key={b.briefDate} className="card p-5">
            <CryptoBriefReader brief={b} />
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-700">Learnings</h2>
        {learnings.length === 0 && (
          <div className="card p-8 text-center text-sm text-gray-500">No learnings logged yet.</div>
        )}
        {KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => (
          <div key={kind} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {KIND_LABEL[kind]}
            </h3>
            {byKind.get(kind)!.map((l) => (
              <div key={`${l.kind}-${l.logDate}`} className="card p-4">
                <div className="text-xs text-gray-500 mb-1">{fmtShortDateUtc(l.logDate)}</div>
                <p className="text-sm text-gray-800 m-0 whitespace-pre-wrap">{l.summary}</p>
                {l.heuristics && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 mb-1">
                      Playbook
                    </div>
                    <p className="text-sm text-emerald-900 m-0 whitespace-pre-wrap">{l.heuristics}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
