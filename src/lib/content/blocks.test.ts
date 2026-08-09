import { describe, expect, it } from "vitest";
import {
	expandPageNoteEntries,
	splitDatedNoteText,
	truncatePageNotes,
} from "./blocks";

describe("splitDatedNoteText", () => {
	it("splits blank-line-separated dated daily notes", () => {
		const text = [
			"Jun 3, 2026 | Price: $10 | WATCH — first",
			"Jun 4 2026 | $9 | WATCH — second",
			"2026-08-06 — $8. WATCH — third",
		].join("\n\n");
		expect(splitDatedNoteText(text)).toHaveLength(3);
	});

	it("keeps a single undated paragraph intact", () => {
		expect(splitDatedNoteText("Just a thesis note without dates.")).toEqual([
			"Just a thesis note without dates.",
		]);
	});
});

describe("truncatePageNotes", () => {
	it("keeps newest dated entries from a legacy mega-block", () => {
		const days = Array.from({ length: 40 }, (_, i) => {
			const d = 1 + (i % 28);
			return `2026-06-${String(d).padStart(2, "0")} | note ${i}`;
		});
		const mega = [{ type: "paragraph" as const, text: days.join("\n\n") }];
		const recent = [
			{ type: "paragraph" as const, text: "2026-08-06 — recent A" },
			{ type: "paragraph" as const, text: "2026-08-09 — recent B" },
		];
		const result = truncatePageNotes([...mega, ...recent], 3);
		expect(result.truncated).toBe(true);
		expect(result.totalBlocks).toBe(42);
		expect(result.blocks).toHaveLength(3);
		expect(result.blocks.map((b) => ("text" in b ? b.text : "")).join("\n")).toContain(
			"2026-08-09",
		);
		expect(result.blocks.map((b) => ("text" in b ? b.text : "")).join("\n")).not.toContain(
			"note 0",
		);
	});

	it("does not mark truncated when everything fits", () => {
		const result = truncatePageNotes([
			{ type: "paragraph", text: "2026-08-06 — one" },
			{ type: "paragraph", text: "2026-08-09 — two" },
		]);
		expect(result.truncated).toBe(false);
		expect(result.totalBlocks).toBe(2);
		expect(result.blocks).toHaveLength(2);
	});

	it("enforces a char budget on a single oversized entry", () => {
		const huge = `2026-08-09 — ${"x".repeat(10_000)}`;
		const result = truncatePageNotes([{ type: "paragraph", text: huge }], 3, 500);
		expect(result.truncated).toBe(true);
		expect(result.blocks).toHaveLength(1);
		const text = "text" in result.blocks[0] ? result.blocks[0].text : "";
		expect(text.length).toBeLessThanOrEqual(502); // … + ≤500
	});
});

describe("expandPageNoteEntries", () => {
	it("expands one mega paragraph into many entries", () => {
		const text = ["Jun 3, 2026 | a", "Jun 4, 2026 | b", "Jun 5, 2026 | c"].join("\n\n");
		const expanded = expandPageNoteEntries([{ type: "paragraph", text }]);
		expect(expanded).toHaveLength(3);
	});
});
