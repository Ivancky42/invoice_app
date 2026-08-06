import type { PageObjectResponse } from "@notionhq/client";

type AnyProp = { type: string } & Record<string, unknown>;

/**
 * Reads the plain-text value of whichever property is this database row’s primary
 * `title` column — whatever its UI label (“Name”, “Title”, etc.).
 */
export function readPrimaryTitle(page: PageObjectResponse): string | null {
	const props = page.properties as Record<string, AnyProp | undefined>;
	for (const p of Object.values(props)) {
		if (p?.type !== "title") continue;
		const arr = (p as unknown as { title: { plain_text: string }[] }).title;
		const s = arr.map((t) => t.plain_text).join("").trim();
		if (s.length > 0) return s;
	}
	return null;
}

/**
 * Universal Notion property reader. Switches on `p.type` and returns the
 * scalar value the value lives under (`p[p.type]`). Returns `null` for
 * unknown / missing properties so callers can rely on a uniform shape.
 *
 * Supported: title, rich_text, number, select, date, checkbox, url, email,
 * phone_number, multi_select.
 */
export function readProp(page: PageObjectResponse, name: string): unknown {
  const props = page.properties as Record<string, AnyProp | undefined>;
  const p = props[name];
  if (!p) return null;
  switch (p.type) {
    case "title": {
      const arr = (p as unknown as { title: { plain_text: string }[] }).title;
      const s = arr.map((t) => t.plain_text).join("");
      return s.length > 0 ? s : null;
    }
    case "rich_text": {
      const arr = (p as unknown as { rich_text: { plain_text: string }[] }).rich_text;
      const s = arr.map((t) => t.plain_text).join("");
      return s.length > 0 ? s : null;
    }
    case "number":
      return (p as unknown as { number: number | null }).number ?? null;
    case "select":
      return (p as unknown as { select: { name: string } | null }).select?.name ?? null;
    case "multi_select": {
      const arr = (p as unknown as { multi_select: { name: string }[] }).multi_select;
      return arr.length > 0 ? arr.map((s) => s.name).join(", ") : null;
    }
    case "date": {
      const start = (p as unknown as { date: { start: string } | null }).date?.start;
      return start ? new Date(start) : null;
    }
    case "checkbox":
      return (p as unknown as { checkbox: boolean }).checkbox;
    case "url":
      return (p as unknown as { url: string | null }).url ?? null;
    case "email":
      return (p as unknown as { email: string | null }).email ?? null;
    case "phone_number":
      return (p as unknown as { phone_number: string | null }).phone_number ?? null;
    default:
      return null;
  }
}

export function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Notion `number_format: percent` stores fractions (`0.025` = 2.5%).
 * Decision Review `return*Pct` (and Trend perf when percent-formatted) store
 * percentage points (`-2.5` = −2.5%). Convert at the Notion → Neon boundary.
 */
export function asNotionPercentPoints(v: unknown): number | null {
  const n = asNumber(v);
  return n === null ? null : n * 100;
}

export function asInt(v: unknown): number | null {
  const n = asNumber(v);
  return n === null ? null : Math.trunc(n);
}

export function asDate(v: unknown): Date | null {
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v : null;
}

export function asBoolean(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/**
 * Reads a multi_select property as a string array (unlike readProp which joins).
 */
export function readMultiSelect(page: PageObjectResponse, name: string): string[] {
  const props = page.properties as Record<string, AnyProp | undefined>;
  const p = props[name];
  if (!p || p.type !== "multi_select") return [];
  const arr = (p as unknown as { multi_select: { name: string }[] }).multi_select;
  return arr.map((s) => s.name).filter(Boolean);
}
