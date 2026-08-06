import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchPageBlocks } from "@/lib/notion/blocks";
import { blocksToJsonValue } from "@/lib/notion/jsonBlocks";
import type { ContentPageKey } from "@/generated/prisma/client";

const CONTENT_PAGES: {
  key: ContentPageKey;
  title: string;
  envVar: string;
  fallbackId: string;
}[] = [
  {
    key: "STRATEGY_LESSONS",
    title: "Strategy Lessons Summary",
    envVar: "NOTION_STRATEGY_LESSONS_PAGE_ID",
    fallbackId: "3606d1ee-f72a-81ef-8484-e03747cd8f1c",
  },
  {
    key: "INVESTMENT_STYLE",
    title: "Investment Style Profile",
    envVar: "NOTION_INVESTMENT_STYLE_PAGE_ID",
    fallbackId: "35f6d1ee-f72a-8198-a5bf-dd2f227318e4",
  },
];

function pageId(envVar: string, fallback: string): string {
  return (process.env[envVar]?.trim() || fallback).replace(
    /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i,
    "$1-$2-$3-$4-$5",
  );
}

export async function syncContentPages(): Promise<{
  strategyLessons: number;
  investmentStyle: number;
}> {
  const counts = { strategyLessons: 0, investmentStyle: 0 };
  for (const spec of CONTENT_PAGES) {
    const id = pageId(spec.envVar, spec.fallbackId);
    const body = await fetchPageBlocks(id);
    const json = blocksToJsonValue(body);
    const bodyValue: Prisma.InputJsonValue =
      json === Prisma.DbNull ? [] : (json as Prisma.InputJsonValue);
    await prisma.contentPage.upsert({
      where: { key: spec.key },
      create: {
        key: spec.key,
        title: spec.title,
        body: bodyValue,
        notionPageId: id,
        syncedAt: new Date(),
      },
      update: {
        title: spec.title,
        body: bodyValue,
        notionPageId: id,
        syncedAt: new Date(),
      },
    });
    const n = Array.isArray(body) ? body.length : 0;
    if (spec.key === "STRATEGY_LESSONS") counts.strategyLessons = n;
    else counts.investmentStyle = n;
  }
  return counts;
}
