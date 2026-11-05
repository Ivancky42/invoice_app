/**
 * Email-address parsing shared by settings, schedules and the sender. Dependency-free so any
 * module can import it without a cycle.
 */
export class InvalidAddressError extends Error {}

/** "a@x.com, b@y.com" → ["a@x.com", "b@y.com"]; drops blanks; accepts "Name <a@b.c>". */
export function parseAddressList(raw: string | string[] | null | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : (raw ?? "").split(/[,;\n]/)).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const addr = /<([^>]+)>\s*$/.exec(p)?.[1] ?? p;
    if (!/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(addr)) {
      throw new InvalidAddressError(`Not an email address: "${p}"`);
    }
  }
  return parts;
}

/**
 * Prefix on a FAILED email record whose outcome Resend didn't confirm (a timeout, a 409):
 * it may have been delivered. Shared by the sender and the billing report.
 */
export const UNCONFIRMED_EMAIL = "[unconfirmed] ";
