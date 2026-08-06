/**
 * One-shot: rebuild TRACKED_TICKERS after null-action filter fix.
 * Usage: npx tsx scripts/fix-tracked-tickers-sync.ts
 */
import "dotenv/config";
import { syncTrackedTickersFromDb } from "../src/lib/agent/writes";
import { getLimits } from "../src/lib/stocks/config";

async function main() {
  const sync = await syncTrackedTickersFromDb();
  const limits = await getLimits();
  console.log(JSON.stringify({ sync, limits }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
