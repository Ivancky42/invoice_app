import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";
import { validationFailure } from "@/lib/agent/schemas";

export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function parseOr400<T>(
  schema: ZodSchema<T>,
  body: unknown,
): { ok: true; data: T } | { ok: false; response: NextResponse } {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const failure = validationFailure(parsed.error);
  return {
    ok: false,
    response: NextResponse.json(failure, { status: 400 }),
  };
}
