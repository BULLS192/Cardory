import { CardVariant, TcgDexCard } from "./types";

export const TCGDEX_BASE = "https://api.tcgdex.net/v2/en";

export function cardImage(image?: string | null, quality: "low" | "high" = "high") {
  return image ? `${image}/${quality}.webp` : null;
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

export function extractMarketPrice(card: TcgDexCard, variant: CardVariant) {
  const tcg = card.pricing?.tcgplayer;
  if (!tcg) return { price: null, source: null, updatedAt: null };

  const variantPrice = tcg[variant] as
    | { marketPrice?: number; midPrice?: number; lowPrice?: number }
    | undefined;

  const fallbackKeys: CardVariant[] = [
    "normal",
    "holofoil",
    "reverse-holofoil",
    "1st-edition",
    "1st-edition-holofoil",
    "unlimited",
    "unlimited-holofoil",
  ];

  let selected = variantPrice;
  if (!selected) {
    for (const key of fallbackKeys) {
      const maybe = tcg[key] as
        | { marketPrice?: number; midPrice?: number; lowPrice?: number }
        | undefined;
      if (maybe) {
        selected = maybe;
        break;
      }
    }
  }

  const price = selected?.marketPrice ?? selected?.midPrice ?? selected?.lowPrice ?? null;
  const updatedAt =
    typeof tcg.updated === "number"
      ? new Date(tcg.updated > 10_000_000_000 ? tcg.updated : tcg.updated * 1000).toISOString()
      : null;

  return {
    price: typeof price === "number" ? price : null,
    source: price != null ? "TCGplayer via TCGdex" : null,
    updatedAt,
  };
}

export function isPriceStale(date?: string | null, hours = 6) {
  if (!date) return true;
  const timestamp = new Date(date).getTime();
  if (Number.isNaN(timestamp)) return true;
  return Date.now() - timestamp > hours * 60 * 60 * 1000;
}
