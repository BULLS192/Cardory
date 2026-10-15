import { createClient } from "npm:@supabase/supabase-js@2.117.2";

type Owned = {
  id: string; owner_id: string; provider_card_id: string; game: string;
  language: string; variant: string;
};
type Quote = { price: number; currency: string; source: string };
const cache = new Map<string, Promise<unknown>>();
const present = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
function locale(language: string) {
  return language === "Japanese" ? "ja" : language === "Chinese" ? "zh-tw" :
    language === "Chinese Simplified" ? "zh-cn" : "en";
}
async function json(url: string): Promise<unknown> {
  if (!cache.has(url)) cache.set(url, (async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Price provider HTTP " + response.status);
    return response.json();
  })());
  return cache.get(url)!;
}
function pickQuote(data: unknown, card: Owned): Quote | null {
  if (!data || typeof data !== "object") return null;
  const item = data as Record<string, unknown>;
  const groupId = card.provider_card_id.match(/^(tcgcsv|riftcsv)-(\d+)-(\d+)$/);
  if (groupId) {
    const result = (item.results as Record<string, unknown>[] | undefined) ?? [];
    const variantNames: Record<string, string[]> = {
      normal: ["normal"], foil: ["foil", "holofoil"], holofoil: ["holofoil"],
      "reverse-holofoil": ["reverse holofoil", "reverse holo"],
      "1st-edition": ["1st edition normal"], "1st-edition-holofoil": ["1st edition holofoil"],
      unlimited: ["unlimited"], "unlimited-holofoil": ["unlimited holofoil"],
    };
    const names = variantNames[card.variant] ?? [card.variant];
    const priceRow = result.find(r =>
      String(r.productId) === groupId[3] &&
      names.includes(String(r.subTypeName || "").toLowerCase()));
    if (!priceRow) return null;
    const price = priceRow.marketPrice ?? priceRow.midPrice ?? priceRow.lowPrice;
    return present(price) ? { price, currency: "USD", source: "TCGplayer via TCGCSV" } : null;
  }
  const pricing = item.pricing as Record<string, unknown> | undefined;
  const sources = [
    pricing?.tcgplayer,
    ...((item.variants_detailed as Record<string, unknown>[] | undefined) ?? [])
      .map(v => (v.pricing as Record<string, unknown> | undefined)?.tcgplayer),
  ].filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  const variants = card.variant === "foil" ? ["foil", "holofoil"] : [card.variant];
  for (const source of sources) {
    for (const key of variants) {
      const record = source[key] as Record<string, unknown> | undefined;
      if (!record) continue;
      const price = record.marketPrice ?? record.midPrice ?? record.lowPrice;
      if (present(price)) return { price,
        currency: typeof source.unit === "string" && /^[A-Z]{3}$/.test(source.unit)
          ? source.unit : "USD", source: "TCGplayer via TCGdex" };
    }
  }
  // Cardmarket trend is a real market observation, but is NOT substituted
  // for a mismatched TCGplayer printing variant.
  const markets = [
    pricing?.cardmarket,
    ...((item.variants_detailed as Record<string, unknown>[] | undefined) ?? [])
      .map(v => (v.pricing as Record<string, unknown> | undefined)?.cardmarket),
  ].filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  for (const market of markets) {
    const foil = ["foil", "holofoil", "reverse-holofoil", "1st-edition-holofoil", "unlimited-holofoil"]
      .includes(card.variant);
    const normal = ["normal", "unlimited", "1st-edition"].includes(card.variant);
    // Cardmarket's trend/avg are standard-finish prices; holo prices have
    // their own fields. Never substitute standard prices for a foil printing.
    const price = foil
      ? market["trend-holo"] ?? market["avg-holo"] ?? market["low-holo"]
      : normal ? market.trend ?? market.avg1 ?? market.avg7 ?? market.avg ?? market.low : null;
    if (present(price)) return { price,
      currency: typeof market.unit === "string" && /^[A-Z]{3}$/.test(market.unit) ? market.unit : "EUR",
      source: "Cardmarket via TCGdex" };
  }
  return null;
}
async function quote(card: Owned): Promise<Quote | null> {
  const csv = card.provider_card_id.match(/^(tcgcsv|riftcsv)-(\d+)-(\d+)$/);
  if (csv) {
    if ((csv[1] === "riftcsv" && card.game !== "riftbound") ||
        (csv[1] === "tcgcsv" && card.game !== "pokemon")) return null;
    const category = csv[1] === "riftcsv" ? 89 : 3;
    return pickQuote(await json(`https://tcgcsv.com/tcgplayer/${category}/${csv[2]}/prices`), card);
  }
  if (card.game !== "pokemon" || !/^[A-Za-z0-9._-]{1,128}$/.test(card.provider_card_id) ||
      card.provider_card_id.startsWith("cardory-custom-")) return null;
  const url = `https://api.tcgdex.net/v2/${locale(card.language)}/cards/${encodeURIComponent(card.provider_card_id)}`;
  return pickQuote(await json(url), card);
}

async function sha256(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
}
function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const supplied = request.headers.get("x-cardory-cron-secret");
  if (!supplied || supplied.length < 32 || supplied.length > 256)
    return reply({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const role = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !role) return reply({ error: "Function not configured" }, 503);
  const client = createClient(url, role, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: config, error: configError } = await client.from("cardory_cron_configuration")
    .select("secret_sha256").eq("config_key", "daily_history").single();
  if (configError || !config || config.secret_sha256 !== await sha256(supplied))
    return reply({ error: "Unauthorized" }, 401);

  try {
    const cards: Owned[] = [];
    for (let offset = 0; offset < 5000; offset += 1000) {
      const { data, error } = await client.from("owned_cards")
        .select("id,owner_id,provider_card_id,game,language,variant")
        .range(offset, offset + 999);
      if (error) throw error;
      cards.push(...((data ?? []) as Owned[]));
      if (!data || data.length < 1000) break;
    }
    if (cards.length >= 5000) throw new Error("Price job exceeds configured safe page limit");
    const groups = new Map<string, Owned[]>();
    for (const card of cards) {
      const key = JSON.stringify([card.provider_card_id, card.game, card.language, card.variant]);
      groups.set(key, [...(groups.get(key) || []), card]);
    }
    const entries = [...groups.values()];
    const results: Array<{ card: Owned; price: Quote }> = [];
    let failed = 0;
    // Limit upstream concurrency; a failed price lookup never becomes a fake 0.
    for (let i = 0; i < entries.length; i += 8) {
      const batch = await Promise.all(entries.slice(i, i + 8).map(async group => {
        try { return quote(group[0]); } catch { failed++; return null; }
      }));
      batch.forEach((q, j) => {
        if (q) entries[i + j].forEach(card => results.push({ card, price: q }));
      });
    }
    const observedAt = new Date().toISOString();
    const snapshotRows = results.map(({ card, price }) => ({
      owner_id: card.owner_id, owned_card_id: card.id,
      market_price: price.price, currency: price.currency,
      source: price.source, observed_at: observedAt,
    }));
    if (snapshotRows.length) {
      const { error } = await client.from("price_snapshots")
        .upsert(snapshotRows, { onConflict: "owned_card_id,snapshot_day" });
      if (error) throw error;
      for (let i = 0; i < results.length; i += 12) {
        const batch = await Promise.all(results.slice(i, i + 12).map(async ({ card, price }) => {
          const { error } = await client.from("owned_cards").update({
            market_price: price.price, market_currency: price.currency,
            price_source: price.source, price_updated_at: observedAt,
          }).eq("id", card.id).eq("owner_id", card.owner_id);
          return error;
        }));
        const first = batch.find(Boolean);
        if (first) throw first;
      }
    }
    return reply({ success: true, observedAt, recorded: snapshotRows.length,
      uniqueLookups: groups.size, unavailable: cards.length - snapshotRows.length, providerErrors: failed });
  } catch (error) {
    console.error("Cardory daily history error", error instanceof Error ? error.message : String(error));
    return reply({ error: "Daily price history recording failed" }, 500);
  }
});
