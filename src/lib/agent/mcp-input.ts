import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { validationFailure } from "@/lib/agent/schemas";

/**
 * Wrap a zod schema as an MCP tool `inputSchema` (a Standard Schema with JSON Schema).
 *
 * tools/list advertises the schema's JSON Schema unchanged, and the SDK still validates
 * every call before the handler runs. The difference from passing the zod schema itself
 * is the failure text: instead of the SDK's flat `path: message` list it carries the same
 * structured payload as the REST routes (`error`, `field`, `legalValues` for bad enums,
 * `issues`), so an agent sees the legal values and can correct its call.
 */
export function mcpInput<S extends z.ZodType>(schema: S): StandardSchemaWithJSON<z.input<S>, z.output<S>> {
  const std = schema["~standard"];
  return {
    "~standard": {
      version: 1,
      vendor: std.vendor,
      jsonSchema: std.jsonSchema,
      validate(value: unknown) {
        const parsed = schema.safeParse(value);
        if (parsed.success) return { value: parsed.data as z.output<S> };
        return { issues: [{ message: JSON.stringify(validationFailure(parsed.error)) }] };
      },
    },
  };
}
