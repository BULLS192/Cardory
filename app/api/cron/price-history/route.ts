import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Vercel calls this only in production. Authorization is never derived
 * from query parameters, user agents, or a browser session. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 ||
      request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base)) {
    return NextResponse.json({ error: "Price history updater not configured" }, { status: 503 });
  }
  try {
    const response = await fetch(
      base.replace(/\/$/, "") + "/functions/v1/daily-price-history", {
        method: "POST",
        headers: {
          "x-cardory-cron-secret": secret,
          "content-type": "application/json",
        },
        body: "{}",
        cache: "no-store",
        signal: AbortSignal.timeout(110000),
      }
    );
    const result = await response.json().catch(() => ({ error: "Updater returned an invalid response" }));
    return NextResponse.json(result, {
      status: response.ok ? 200 : 502,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("Daily price history invocation failed", error instanceof Error ? error.message : "Unknown");
    return NextResponse.json({ error: "Daily price recording unavailable" }, { status: 502 });
  }
}
