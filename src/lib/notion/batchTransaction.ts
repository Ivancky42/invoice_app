import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Keep each interactive transaction short enough for Neon under load. */
const BATCH_SIZE = 25;

const TX_OPTS: { timeout: number; maxWait: number } = {
	timeout: 30_000,
	maxWait: 10_000,
};

/**
 * Run Prisma operations in chunked interactive transactions so large Notion
 * syncs do not hit the default 5s transaction timeout.
 */
export async function runInTransactionBatches(
	ops: Prisma.PrismaPromise<unknown>[],
	batchSize = BATCH_SIZE,
): Promise<void> {
	for (let i = 0; i < ops.length; i += batchSize) {
		const chunk = ops.slice(i, i + batchSize);
		await prisma.$transaction(chunk, TX_OPTS);
	}
}
