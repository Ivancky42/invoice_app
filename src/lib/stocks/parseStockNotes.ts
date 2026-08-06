/** Parse and sort dated stock notes (ISO + human month headers). */

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
const MONTH_DATE_PREFIX = new RegExp(
	`^(?:\\*\\*)?(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\s+)?(${MONTH})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?:\\s*\\([A-Z]+\\))?(?:\\*\\*)?`,
	"i",
);

/** ISO date at line start, optional bullet, then `:` / `—` / `|` / space. */
const ISO_DATE_PREFIX =
	/^(?:[-•*]\s+)?(\d{4}-\d{2}-\d{2})(?:\s*\([^)]*\))?(?=\s*(?:[:—–\-|]|\s|$))/;

function monthToIso(monthName: string, day: string, year: string): string | null {
	const month = MONTH_TO_NUM[monthName.slice(0, 3).toLowerCase()];
	if (!month) return null;
	return `${year}-${month}-${day.padStart(2, "0")}`;
}

function extractDateFromLine(line: string): { date: string; label: string } | null {
	const trimmed = line.trim();

	const iso = ISO_DATE_PREFIX.exec(trimmed);
	if (iso) {
		return { date: iso[1]!, label: iso[1]! };
	}

	const m = MONTH_DATE_PREFIX.exec(trimmed);
	if (!m) return null;
	const date = monthToIso(m[2]!, m[3]!, m[4]!);
	if (!date) return null;
	const label = m[0].replace(/^\*\*|\*\*$/g, "").trim();
	return { date, label };
}

function lineStartsWithDate(line: string): boolean {
	return extractDateFromLine(line) !== null;
}

/**
 * Split on blank lines / `---`, and on a newline that starts a new dated header
 * (ISO or month-style), so append-only history becomes one paragraph per entry.
 */
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

/**
 * Parse ticker notes into dated entries. Supports:
 * - `2026-08-06 — $54.11 …`
 * - `2026-07-12: …` / `- 2026-07-12 (Weekly): …`
 * - `Jun 3, 2026 | $56.46 | …` / `Mon Jun 15 2026 | …`
 * Newest date first.
 */
export function parseStockNotes(text: string): ParsedNotes | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	const paragraphs = splitNoteParagraphs(trimmed);
	const entries: DatedNoteEntry[] = [];
	let current: DatedNoteEntry | null = null;
	const preambleParts: string[] = [];

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
		} else {
			preambleParts.push(para);
		}
	}

	if (current) entries.push(current);
	if (entries.length === 0) return null;

	entries.sort((a, b) => b.date.localeCompare(a.date));
	return {
		preamble: preambleParts.length > 0 ? preambleParts.join("\n\n") : null,
		entries,
	};
}

/** Merge multiple parsed note sets; newest date first. */
export function mergeParsedNotes(
	parts: Array<ParsedNotes | null | undefined>,
): ParsedNotes | null {
	const entries: DatedNoteEntry[] = [];
	const preambles: string[] = [];
	for (const p of parts) {
		if (!p) continue;
		if (p.preamble?.trim()) preambles.push(p.preamble.trim());
		entries.push(...p.entries);
	}
	if (entries.length === 0) return null;
	entries.sort((a, b) => b.date.localeCompare(a.date));

	const seen = new Set<string>();
	const unique: DatedNoteEntry[] = [];
	for (const e of entries) {
		const key = `${e.date}|${e.body.replace(/\s+/g, " ").slice(0, 100)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(e);
	}
	return {
		preamble: preambles.length > 0 ? preambles.join("\n\n") : null,
		entries: unique,
	};
}

/** Display body with the leading date header stripped when redundant. */
export function noteEntryDisplayBody(entry: DatedNoteEntry): string {
	const lines = entry.body.split("\n");
	const first = (lines[0] ?? "").trim();
	const rest = lines.slice(1).join("\n").trim();

	if (
		first === entry.label ||
		/^\d{4}-\d{2}-\d{2}/.test(first) ||
		first.startsWith(`${entry.label} |`) ||
		first.startsWith(`${entry.label}|`)
	) {
		// Keep pipe-style content after the date: `Jun 3, 2026 | $56 …`
		const pipeIdx = first.indexOf("|");
		if (pipeIdx > 0) {
			const afterPipe = first.slice(pipeIdx + 1).trim();
			return afterPipe + (rest ? `\n${rest}` : "");
		}
		// ISO / em-dash: `2026-08-06 — $54.11 …`
		const afterDate = first
			.replace(/^(?:[-•*]\s+)?\d{4}-\d{2}-\d{2}(?:\s*\([^)]*\))?\s*(?:[:—–\-]\s*)?/, "")
			.trim();
		if (afterDate) return afterDate + (rest ? `\n${rest}` : "");
		return rest || entry.body;
	}
	return entry.body;
}

/** One-line preview of the newest entry for card surfaces. */
export function newestNotePreview(
	text: string | null | undefined,
	maxLen = 140,
): { date: string; label: string; preview: string } | null {
	if (!text?.trim()) return null;
	const parsed = parseStockNotes(text);
	return newestFromParsed(parsed, maxLen);
}

function newestFromParsed(
	parsed: ParsedNotes | null,
	maxLen = 140,
): { date: string; label: string; preview: string } | null {
	const newest = parsed?.entries[0];
	if (!newest) return null;
	const body = noteEntryDisplayBody(newest).replace(/\s+/g, " ").trim();
	const preview =
		body.length > maxLen ? `${body.slice(0, maxLen - 1).trimEnd()}…` : body;
	return { date: newest.date, label: newest.label, preview };
}

/** Newest entry across multiple note texts / ReportBlock plain strings. */
export function newestNoteFromTexts(
	texts: Array<string | null | undefined>,
	maxLen = 140,
): { date: string; label: string; preview: string } | null {
	const merged = mergeParsedNotes(
		texts.filter((t): t is string => !!t?.trim()).map((t) => parseStockNotes(t)),
	);
	return newestFromParsed(merged, maxLen);
}

/** @internal exported for tests */
export { extractDateFromLine, lineStartsWithDate };
