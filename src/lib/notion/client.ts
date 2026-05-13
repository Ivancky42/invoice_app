import { Client } from "@notionhq/client";

let cached: Client | null = null;

export function notionClient(): Client {
  if (cached) return cached;
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new Error("NOTION_TOKEN is not set. Add it to your environment to use the Notion sync.");
  }
  cached = new Client({ auth: token });
  return cached;
}

export function notionDbId(envKey: string): string {
  const v = process.env[envKey]?.trim();
  if (!v) throw new Error(`${envKey} is not set`);
  return v;
}
