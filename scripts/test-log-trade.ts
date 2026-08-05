/**
 * Dry-run / local exercise for logTrade() invariants.
 *
 * Usage:
 *   npx tsx scripts/test-log-trade.ts              # dry-run (no DB writes)
 *   npx tsx scripts/test-log-trade.ts --commit     # live tiny trade (requires DB)
 *   npx tsx scripts/test-log-trade.ts --idempotent # commit then replay same key
 *
 * Prefer dry-run first. Live mode uses a unique idempotencyKey and a 1-share
 * ADD/BUY against whatever ticker you pass (default: first non-cash equity).
 */
import "dotenv/config";

const args = new Set(process.argv.slice(2));
const commit = args.has("--commit") || args.has("--idempotent");
const replay = args.has("--idempotent");

async function dryRunMath() {
  const { TRADE_DIRECTION } = await import("../src/lib/stocks/tradeMath");
  const types = ["BUY", "ADD", "TRIM", "SELL", "STOP_LOSS"] as const;

  console.log("TRADE_DIRECTION:");
  for (const t of types) {
    console.log(`  ${t}: ${TRADE_DIRECTION[t]}`);
  }

  // Weighted avg example
  const oldShares = 100;
  const oldAvg = 20;
  const addShares = 50;
  const addPrice = 18;
  const newShares = oldShares + addShares;
  const newAvg = (oldShares * oldAvg + addShares * addPrice) / newShares;
  console.log("\nWeighted avg example (ADD below avg):");
  console.log(`  ${oldShares}@${oldAvg} + ${addShares}@${addPrice} → ${newShares}@${newAvg.toFixed(4)}`);
  console.log(`  isAverageDown: ${addPrice < oldAvg}`);

  // Cap math
  const cash = 10_000;
  const positionValue = 8_000;
  const otherEquities = 40_000;
  const cspx = 20_000;
  const nav = cash + positionValue + otherEquities + cspx;
  const nonCspxNav = nav - cspx;
  const weight = positionValue / nonCspxNav;
  console.log("\nSingle-position cap (ex-CSPX):");
  console.log(`  nav=${nav} nonCspxNav=${nonCspxNav} weight=${(weight * 100).toFixed(2)}% cap=15%`);
  console.log(`  would409: ${weight > 0.15}`);

  console.log("\nDry-run OK. Pass --commit to hit local DB via logTrade().");
}

async function live() {
  const { prisma } = await import("../src/lib/prisma");
  const { logTrade } = await import("../src/lib/agent/logTrade");
  const { isCashTicker } = await import("../src/lib/stocks/format");
  const { decToNum } = await import("../src/lib/stocks/format");

  try {
    const portfolio = await prisma.portfolio.findMany();
    const equity = portfolio.find((p) => !isCashTicker(p.ticker) && (decToNum(p.shares) ?? 0) > 0);
    if (!equity) {
      console.error("No equity position found — seed portfolio first.");
      process.exit(1);
    }

    const ticker = equity.ticker.trim().toUpperCase();
    const key = `test-log-trade-${ticker}-${Date.now()}`;
    const price = decToNum(equity.currentPrice) ?? decToNum(equity.myAvgCost) ?? 1;

    console.log(`Live trade against ${ticker} @ ~${price}`);
    console.log(`idempotencyKey=${key}`);

    // Tiny ADD of 0.0001 shares if fractional OK, else 1 share TRIM of 0 — use BUY of tiny?
    // Schema Decimal(18,4) — use 0.0001 shares as dry-ish probe; may still hit caps.
    // Safer: use type that increases cash — skip. Prefer documenting curl instead.
    // Actually for a real test, do an ADD of very small shares then reverse with TRIM.

    const result = await logTrade({
      idempotencyKey: key,
      ticker,
      type: "ADD",
      date: new Date().toISOString().slice(0, 10),
      shares: 0.0001,
      pricePerShare: price,
      notes: [{ type: "paragraph", text: "scripts/test-log-trade.ts probe" }],
      rulesVersion: "test",
    });

    console.log(JSON.stringify(result, null, 2));

    if (replay && result.ok) {
      console.log("\nReplaying same idempotencyKey…");
      const again = await logTrade({
        idempotencyKey: key,
        ticker,
        type: "ADD",
        date: new Date().toISOString().slice(0, 10),
        shares: 0.0001,
        pricePerShare: price,
      });
      console.log(JSON.stringify(again, null, 2));
      if (!again.ok || !again.idempotentReplay) {
        console.error("FAIL: expected idempotentReplay=true");
        process.exit(1);
      }
      console.log("Idempotent replay OK.");
    }

    if (result.ok) {
      // Reverse the tiny ADD so we don't leave junk
      const reverseKey = `${key}-reverse`;
      const rev = await logTrade({
        idempotencyKey: reverseKey,
        ticker,
        type: "TRIM",
        date: new Date().toISOString().slice(0, 10),
        shares: 0.0001,
        pricePerShare: price,
        notes: [{ type: "paragraph", text: "scripts/test-log-trade.ts reverse" }],
      });
      console.log("\nReverse TRIM:", JSON.stringify(rev, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (!commit) {
    await dryRunMath();
    return;
  }
  await live();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
