import {
  getPromptMarkdown,
  PROMPT_NAMES,
  type PromptName,
} from "@/lib/agent/context";
import { PromptsReader, type PromptDoc } from "@/app/stocks/_components/PromptsReader";

/** Prompt files change with deploys / local edits — always read from disk. */
export const dynamic = "force-dynamic";

async function loadPrompt(name: PromptName): Promise<PromptDoc> {
  try {
    const markdown = await getPromptMarkdown(name);
    return { name, markdown };
  } catch {
    return {
      name,
      markdown: null,
      error: `Missing prompts/${name}.md on disk.`,
    };
  }
}

export default async function PromptsPage() {
  const prompts = await Promise.all(PROMPT_NAMES.map(loadPrompt));

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Agent prompts</h1>
        <p className="text-sm text-gray-500">
          Committed instructions from <code className="text-xs bg-gray-100 px-1 rounded">/prompts</code>
          — what agents read via MCP. Edit in git only; living strategy docs stay under Strategy.
        </p>
      </section>

      <PromptsReader prompts={prompts} />
    </div>
  );
}
