import { NextRequest } from "next/server";

const ALLOWED_HOSTS = new Set(["assets.tcgdex.net", "tcgplayer-cdn.tcgplayer.com"]);
const MAX_IMAGE_BYTES = 2_000_000;

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("src");
  if (!input || input.length > 2048) return new Response("Invalid image URL", { status: 400 });

  let source: URL;
  try { source = new URL(input); }
  catch { return new Response("Invalid image URL", { status: 400 }); }
  if (source.protocol !== "https:" || source.port || source.username || source.password ||
      !ALLOWED_HOSTS.has(source.hostname)) {
    return new Response("Unapproved catalogue image host", { status: 400 });
  }

  try {
    const remote = await fetch(source.toString(), {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "image/webp,image/jpeg,image/png" },
      next: { revalidate: 86400 },
    });
    if (!remote.ok) return new Response("Catalogue image unavailable", { status: 404 });
    const kind = remote.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const length = Number(remote.headers.get("content-length") ?? 0);
    if (!["image/webp", "image/jpeg", "image/png"].includes(kind) ||
        !Number.isFinite(length) || length > MAX_IMAGE_BYTES) {
      return new Response("Unsupported catalogue image", { status: 415 });
    }
    const bytes = await remote.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) return new Response("Image too large", { status: 413 });
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": kind,
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Catalogue image unavailable", { status: 502 });
  }
}
