import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { notionClient, notionDbId } from "@/lib/notion/client";

/** Narrow shape of `databases.retrieve` payload we rely on (SDK types omit `properties` in some versions). */
type DbRetrieve = {
	id: string;
	url?: string;
	title?: Array<{ plain_text?: string }>;
	properties: Record<string, { id: string; type: string }>;
};

export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return r === 0;
}

function authorized(req: NextRequest): boolean {
	const sync = process.env.SYNC_SECRET?.trim();
	const provided = req.nextUrl.searchParams.get("secret")?.trim() ?? "";
	if (sync && provided && timingSafeEqual(sync, provided)) return true;

	const auth = req.headers.get("authorization") ?? "";
	const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
	if (sync && bearer && timingSafeEqual(sync, bearer)) return true;

	return process.env.NODE_ENV !== "production";
}

/**
 * Read-only introspection so you can see exact Notion property **names** and **types**
 * used in the Daily Log database (`readProp(..., NAME)` keys must match `name`).
 *
 * Same auth rules as notion sync (`secret=` or `Bearer`, or unrestricted in dev only).
 *
 * Usage (local dev):
 *
 * ```
 * http://localhost:3000/api/debug/notion-daily-log-schema
 * ```
 *
 * Prod:
 *
 * ```
 * /api/debug/notion-daily-log-schema?secret=$SYNC_SECRET
 * ```
 */
export async function GET(req: NextRequest) {
	if (!authorized(req)) {
		return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
	}

	const raw = process.env.NOTION_DAILY_LOG_DB?.trim();
	if (!raw) {
		return NextResponse.json(
			{ ok: false, error: "NOTION_DAILY_LOG_DB is not set" },
			{ status: 400 },
		);
	}

	try {
		const dbId = notionDbId("NOTION_DAILY_LOG_DB");
		const db = (await notionClient().databases.retrieve({
			database_id: dbId,
		})) as unknown as DbRetrieve;

		const props: Record<string, { id: string; type: string }> = {};
		for (const [name, meta] of Object.entries(db.properties ?? {})) {
			props[name] = { id: meta.id, type: meta.type };
		}

		const titleLike = Object.entries(props).filter(([, v]) => v.type === "title");

		const expectedDailyLogColumns = [
			"Date",
			"Action Taken",
			"Alert Email Sent",
			"Flagged Tickers",
			"Flags Count",
			"Market Context",
			"Notes",
			"Portfolio Move",
			"Top News",
			"Watchlist Move",
		];
		const present = expectedDailyLogColumns.map((col) => ({
			column: col,
			ok: Boolean(db.properties[col]),
		}));

		return NextResponse.json({
			ok: true,
			databaseId: db.id,
			url: db.url,
			titleAsArray: db.title ?? [],
			properties: props,
			primaryTitleCandidates: Object.fromEntries(titleLike),
			mapperExpectsTheseColumnsPresent: present,
		});
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		return NextResponse.json({ ok: false, error: msg }, { status: 502 });
	}
}
