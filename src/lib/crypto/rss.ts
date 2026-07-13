/**
 * RSS catalyst fetcher — 4 crypto news feeds, regex-parsed (no XML dep).
 * Matches article titles against tracked symbols + names (word-boundary) so
 * only relevant news is stored. Uses `cache: "no-store"`, 8s timeout, []-on-error.
 */

const FEEDS: { source: string; url: string }[] = [
  { source: "coindesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "theblock", url: "https://www.theblock.co/rss.xml" },
  { source: "decrypt", url: "https://decrypt.co/feed" },
];

export type Catalyst = {
  title: string;
  url: string;
  source: string;
  publishedAt: Date | null;
  symbols: string[];
};

/** A tracked asset for catalyst matching. */
export type TrackedForNews = { symbol: string; name: string };

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function firstTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Symbols/names present in the title (case-insensitive, word-boundary). */
function matchSymbols(title: string, tracked: TrackedForNews[]): string[] {
  const hits = new Set<string>();
  for (const t of tracked) {
    const terms = [t.symbol, t.name].filter(Boolean);
    for (const term of terms) {
      const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, "i");
      if (re.test(title)) {
        hits.add(t.symbol.toUpperCase());
        break;
      }
    }
  }
  return [...hits];
}

async function fetchFeed(
  source: string,
  url: string,
  tracked: TrackedForNews[],
): Promise<Catalyst[]> {
  let xml: string;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "crypto-dashboard/1.0" },
    });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }

  const out: Catalyst[] = [];
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const item of items) {
    const title = firstTag(item, "title");
    const link = firstTag(item, "link");
    if (!title || !link) continue;
    const symbols = matchSymbols(title, tracked);
    if (symbols.length === 0) continue;
    const pub = firstTag(item, "pubDate");
    const publishedAt = pub ? new Date(pub) : null;
    out.push({
      title,
      url: link,
      source,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      symbols,
    });
  }
  return out;
}

/** Fetch all feeds and return catalysts matching any tracked asset. */
export async function fetchCatalysts(tracked: TrackedForNews[]): Promise<Catalyst[]> {
  if (tracked.length === 0) return [];
  const results = await Promise.all(
    FEEDS.map((f) => fetchFeed(f.source, f.url, tracked)),
  );
  return results.flat();
}
