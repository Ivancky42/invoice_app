import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { del, put } from "@vercel/blob";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"]);
const MAX_BYTES = 2 * 1024 * 1024;

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function extFor(file: File): string {
  if (file.type === "image/svg+xml") return "svg";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/png") return "png";
  return "jpg";
}

export function assertValidLogoFile(file: File): void {
  if (!ALLOWED.has(file.type)) throw new Error(`Unsupported file type: ${file.type}`);
  if (file.size > MAX_BYTES) throw new Error("Logo is larger than 2MB");
}

/**
 * Persists a logo: Vercel Blob when BLOB_READ_WRITE_TOKEN is set (production on Vercel),
 * otherwise local `public/logos` (ephemeral on Vercel — token required there).
 */
export async function saveLogoFile(file: File, profileId: string): Promise<string> {
  assertValidLogoFile(file);
  const ext = extFor(file);
  const basename = `${profileId}-${Date.now()}.${ext}`;

  if (blobEnabled()) {
    const pathname = `logos/${basename}`;
    const blob = await put(pathname, file, {
      access: "public",
      addRandomSuffix: false,
      contentType: file.type || undefined,
    });
    return blob.url;
  }

  if (process.env.VERCEL) {
    throw new Error(
      "Logo upload requires Vercel Blob on this platform. Create a Blob store in the Vercel project so BLOB_READ_WRITE_TOKEN is available.",
    );
  }

  const dir = path.join(process.cwd(), "public", "logos");
  await fsPromises.mkdir(dir, { recursive: true });
  const abs = path.join(dir, basename);
  const bytes = Buffer.from(await file.arrayBuffer());
  await fsPromises.writeFile(abs, bytes);
  return `/logos/${basename}`;
}

export async function removeStoredLogo(logoPath: string | null | undefined): Promise<void> {
  if (!logoPath) return;
  if (logoPath.startsWith("https://") || logoPath.startsWith("http://")) {
    if (blobEnabled()) {
      try {
        await del(logoPath);
      } catch {
        /* ignore missing or stale URLs */
      }
    }
    return;
  }
  if (!logoPath.startsWith("/logos/")) return;
  const abs = path.join(process.cwd(), "public", logoPath.replace(/^\//, ""));
  try {
    await fsPromises.unlink(abs);
  } catch {
    /* ignore */
  }
}

/** Path or URL suitable for @react-pdf/renderer Image `src` */
export function resolveLogoSourceForPdf(logoPath?: string | null): string | undefined {
  if (!logoPath) return undefined;
  if (logoPath.startsWith("https://") || logoPath.startsWith("http://")) return logoPath;
  const clean = logoPath.startsWith("/") ? logoPath.slice(1) : logoPath;
  const abs = path.join(process.cwd(), "public", clean);
  if (fs.existsSync(abs)) return abs;
  return undefined;
}
