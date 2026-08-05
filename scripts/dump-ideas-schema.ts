/**
 * Dump Notion Ideas DB property schema (one-shot).
 * Usage: npx tsx scripts/dump-ideas-schema.ts
 */
import "dotenv/config";
import { Client } from "@notionhq/client";

async function main() {
  const client = new Client({ auth: process.env.NOTION_TOKEN!.trim() });
  const dbId = process.env.NOTION_IDEAS_DB!.trim();

  const db = await client.databases.retrieve({ database_id: dbId });
  const dsId = (db as { data_sources?: { id: string }[] }).data_sources?.[0]?.id;
  if (!dsId) {
    console.error("No data_sources on database", db);
    process.exit(1);
  }

  const ds = await client.dataSources.retrieve({ data_source_id: dsId });
  const props = (ds as { properties?: Record<string, { type: string; [k: string]: unknown }> }).properties ?? {};

  console.log("Database:", (db as { title?: { plain_text: string }[] }).title?.[0]?.plain_text);
  console.log("Data source:", dsId);
  console.log("\nProperties:");
  for (const [name, prop] of Object.entries(props)) {
    const type = prop.type;
    let extra = "";
    const p = prop as Record<string, unknown>;
    const typed = p[type] as Record<string, unknown> | undefined;
    if (typed && Array.isArray(typed.options)) {
      const opts = (typed.options as { name: string }[]).map((o) => o.name);
      extra = ` options=[${opts.join(" | ")}]`;
    } else if (type === "status" && typed && typed.options) {
      const opts = (typed.options as { name: string }[]).map((o) => o.name);
      extra = ` options=[${opts.join(" | ")}]`;
    }
    console.log(`  ${name} | ${type}${extra}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
