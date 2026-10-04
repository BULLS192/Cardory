import { CardVariant, TcgDexCard, TcgPlayerPricing } from "./types";

export const TCGDEX_BASE = "https://api.tcgdex.net/v2/en";

export function cardImage(image?: string | null, quality: "low" | "high" = "high") {
  if (!image) return null;
  if (image.includes("assets.tcgdex.net")) return `${image}/${quality}.webp`;
  if (image.includes("tcgplayer-cdn.tcgplayer.com")) {
    return quality === "high" ? image.replace(/_200w\.jpg$/, "_400w.jpg") : image;
  }
  return image;
}

export function availableVariants(card: TcgDexCard): CardVariant[] {
  const out: CardVariant[] = [];
  const v = card.variants ?? {};
  if (v.normal) out.push("normal");
  if (v.holo) out.push("holofoil");
  if (v.reverse) out.push("reverse-holofoil");
  if (v.firstEdition) out.push("1st-edition");
  if (!out.length) out.push("normal");
  return out;
}

function normalizeUpdatedAt(updated?: number | string) {
  if (typeof updated === "string") {
    const parsed = new Date(updated);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof updated === "number") {
    return new Date(updated > 10_000_000_000 ? updated : updated * 1000).toISOString();
  }
  return null;
}

function selectFromPricing(tcg: TcgPlayerPricing, key: CardVariant) {
  const selected = tcg[key];
  if (!selected) return null;
  const price = selected.marketPrice ?? selected.midPrice ?? selected.lowPrice ?? null;
  if (typeof price !== "number") return null;
  return { price, updatedAt: normalizeUpdatedAt(tcg.updated) };
}

export function extractMarketPrice(card: TcgDexCard, variant: CardVariant) {
  const sources: TcgPlayerPricing[] = [
    ...(card.pricing?.tcgplayer ? [card.pricing.tcgplayer] : []),
    ...(card.variants_detailed ?? [])
      .map((entry) => entry.pricing?.tcgplayer)
      .filter((entry): entry is TcgPlayerPricing => Boolean(entry)),
  ];

  if (!sources.length) return { price: null, source: null, updatedAt: null };

  for (const source of sources) {
    const match = selectFromPricing(source, variant);
    if (match) {
      return {
        price: match.price,
        source: card.id.startsWith("tcgcsv-") ? "TCGplayer via TCGCSV" : "TCGplayer via TCGdex",
        updatedAt: match.updatedAt,
      };
    }
  }

  const fallbackKeys: CardVariant[] = [
    "normal",
    "holofoil",
    "reverse-holofoil",
    "1st-edition",
    "1st-edition-holofoil",
    "unlimited",
    "unlimited-holofoil",
  ];

  for (const key of fallbackKeys) {
    for (const source of sources) {
      const match = selectFromPricing(source, key);
      if (match) {
        return {
          price: match.price,
          source: card.id.startsWith("tcgcsv-") ? "TCGplayer via TCGCSV" : "TCGplayer via TCGdex",
          updatedAt: match.updatedAt,
        };
      }
    }
  }

  return { price: null, source: null, updatedAt: null };
}

export function isPriceStale(date?: string | null, hours = 6) {
  if (!date) return true;
  const timestamp = new Date(date).getTime();
  if (Number.isNaN(timestamp)) return true;
  return Date.now() - timestamp > hours * 60 * 60 * 1000;
}
