/** Parse and sort dated stock notes (ISO property format + Notion page body format). */

export type DatedNoteEntry = { date: string; label: string; body: string };
export type ParsedNotes = { preamble: string | null; entries: DatedNoteEntry[] };

const MONTH_TO_NUM: Record<string, string> = {
	jan: "01",
	feb: "02",
	mar: "03",
	apr: "04",
	may: "05",
	jun: "06",
	jul: "07",
	aug: "08",
	sep: "09",
	oct: "10",
	nov: "11",
	dec: "12",
};

const MONTH =
	"Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

/** Optional markdown bold, optional weekday, month day year, optional (MYT) etc. */
const DATE_PREFIX = new RegExp(
	`^(?:\\*\\*)?(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\s+)?(${MONTH})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?:\\s*\\([A-Z]+\\))?(?:\\*\\*)?`,
	"i",
);

const PAGE_BODY_HINT = new RegExp(
	`^(?:\\*\\*)?(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\s+)?(?:${MONTH})\\b`,
	"im",
);

function monthToIso(monthName: string, day: string, year: string): string | null {
	const month = MONTH_TO_NUM[monthName.slice(0, 3).toLowerCase()];
	if (!month) return null;
	return `${year}-${month}-${day.padStart(2, "0")}`;
}

function extractDateFromLine(line: string): { date: string; label: string } | null {
	const m = DATE_PREFIX.exec(line.trim());
	if (!m) return null;
	const iso = monthToIso(m[2], m[3], m[4]);
	if (!iso) return null;
	const label = m[0].replace(/^\*\*|\*\*$/g, "").trim();
	return { date: iso, label };
}

function lineStartsWithDate(line: string): boolean {
	return DATE_PREFIX.test(line.trim());
}

/** Split on blank lines, `---`, and single newlines before a date header. */
function splitNoteParagraphs(text: string): string[] {
	const raw = text
		.trim()
		.split(/\n\n+/)
		.map((p) => p.trim())
		.filter((p) => p && p !== "---");

	const out: string[] = [];
	for (const para of raw) {
		const lines = para.split("\n");
		let buf: string[] = [];
		for (const line of lines) {
			if (buf.length > 0 && lineStartsWithDate(line)) {
				out.push(buf.join("\n"));
				buf = [line];
			} else {
				buf.push(line);
			}
		}
		if (buf.length) out.push(buf.join("\n"));
	}
	return out;
}

/** Split notes like `…preamble…\n\n2026-05-13: …\n\n2026-05-14: …` into dated entries. */
function parseIsoDatedNotes(text: string): ParsedNotes | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	const chunks = trimmed.split(/\n(?=\d{4}-\d{2}-\d{2}:)/);
	const entries: DatedNoteEntry[] = [];
	let preamble: string | null = null;

	for (const chunk of chunks) {
		const m = /^(\d{4}-\d{2}-\d{2}):\s*([\s\S]*)$/.exec(chunk.trim());
		if (m) {
			const body = m[2].trim();
			if (body) entries.push({ date: m[1], label: m[1], body });
			continue;
		}
		const lead = chunk.trim();
		if (lead && entries.length === 0) preamble = lead;
	}

	if (entries.length === 0) return null;

	entries.sort((a, b) => b.date.localeCompare(a.date));
	return { preamble, entries };
}

/**
 * Parse Notion page body notes. Synced block text has no markdown bold — headers look like:
 * `Jun 11 2026 | $227.63 | …` or `Sun Jun 14 2026 (MYT) | …` or `Mon Jun 15 2026 | …`
 */
function parsePageBodyNotes(text: string): ParsedNotes | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	const paragraphs = splitNoteParagraphs(trimmed);

	const entries: DatedNoteEntry[] = [];
	let current: DatedNoteEntry | null = null;

	for (const para of paragraphs) {
		const firstLine = para.split("\n")[0] ?? para;
		const dateInfo = extractDateFromLine(firstLine);

		if (dateInfo) {
			if (current) entries.push(current);
			current = { date: dateInfo.date, label: dateInfo.label, body: para };
			continue;
		}

		if (current) {
			current.body = `${current.body}\n\n${para}`;
		}
	}

	if (current) entries.push(current);
	if (entries.length === 0) return null;

	entries.sort((a, b) => b.date.localeCompare(a.date));
	return { preamble: null, entries };
}

export function parseStockNotes(text: string): ParsedNotes | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	// Page body: human-readable month headers (with or without ** from Notion markdown).
	if (PAGE_BODY_HINT.test(trimmed)) {
		const page = parsePageBodyNotes(trimmed);
		if (page) return page;
	}

	return parseIsoDatedNotes(trimmed) ?? parsePageBodyNotes(trimmed);
}

/** @internal exported for tests */
export { extractDateFromLine, lineStartsWithDate };
