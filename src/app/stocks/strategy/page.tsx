import { ContentPageKey } from "@/generated/prisma/client";
import {
  contentPageToDTO,
  getContentPage,
  getSyncStatus,
} from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { StrategyDocsReader } from "@/app/stocks/_components/StrategyDocsReader";

export const revalidate = 900;

export default async function StrategyPage() {
  const [lessons, style, status] = await Promise.all([
    getContentPage(ContentPageKey.STRATEGY_LESSONS),
    getContentPage(ContentPageKey.INVESTMENT_STYLE),
    getSyncStatus(),
  ]);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Strategy</h1>
        <p className="text-sm text-gray-500">
          Strategy Lessons Summary and Investment Style Profile — living Neon documents
          (read-only here; agents update via MCP).
        </p>
      </section>

      <SyncStatusBanner status={status} />

      <StrategyDocsReader
        lessons={lessons ? contentPageToDTO(lessons) : null}
        style={style ? contentPageToDTO(style) : null}
      />
    </div>
  );
}
