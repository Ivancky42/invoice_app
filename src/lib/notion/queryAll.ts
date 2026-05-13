import type { PageObjectResponse } from "@notionhq/client";
import { notionClient } from "./client";

const dataSourceIdCache = new Map<string, string>();

/**
 * Notion API 2025-09-03 introduced multi-source databases: a database now
 * contains one or more data sources, and queries target a data source id,
 * not the database id. For our use we assume each database has a single
 * data source (the typical case for the user's hand-built dashboards) and
 * cache the lookup.
 */
async function resolveDataSourceId(databaseId: string): Promise<string> {
  const cached = dataSourceIdCache.get(databaseId);
  if (cached) return cached;
  const client = notionClient();
  const db = await client.databases.retrieve({ database_id: databaseId });
  const sources = (db as { data_sources?: Array<{ id: string }> }).data_sources;
  if (!sources || sources.length === 0) {
    throw new Error(`Database ${databaseId} has no data sources`);
  }
  const id = sources[0].id;
  dataSourceIdCache.set(databaseId, id);
  return id;
}

/**
 * Paginate a Notion data source and return all full page objects. Awaits
 * each page sequentially so we stay under Notion's 3 req/s rate limit.
 */
export async function queryAllPages(databaseId: string): Promise<PageObjectResponse[]> {
  const client = notionClient();
  const dataSourceId = await resolveDataSourceId(databaseId);
  const out: PageObjectResponse[] = [];
  let cursor: string | undefined = undefined;
  do {
    const res = await client.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const r of res.results) {
      if ((r as { object?: string }).object === "page" && "properties" in r) {
        out.push(r as PageObjectResponse);
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}
