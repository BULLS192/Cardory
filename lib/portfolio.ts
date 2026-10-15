import type { OwnedCard } from "./types";

export type ValueMode = "copies" | "unique";
export type PortfolioValue = {
  amounts: Record<string, number>;
  records: number;
  copies: number;
  unique: number;
  counted: number;
  priced: number;
  unpriced: number;
  duplicates: number;
};
export type OwnedSetPortfolio = {
  key: string;
  setId: string | null;
  setName: string;
  game: string;
  language: string;
  cards: OwnedCard[];
};

function quantity(card: OwnedCard): number {
  const value = Number(card.quantity);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function price(card: OwnedCard): number | null {
  const value = card.marketPrice;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value : null;
}

function currency(card: OwnedCard): string {
  const value = (card.marketCurrency || "USD").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : "USD";
}

/**
 * Duplicates mean additional physical copies of the SAME provider card,
 * game, language and printing variant, even across acquisition batches.
 * Don't combine distinct Japanese, Chinese or English printings by name.
 * Cards without a provider ID remain distinct rather than guessing.
 */
export function portfolioIdentity(card: OwnedCard): string {
  const source = card.tcgdexId?.trim() || ("record:" + card.id);
  return JSON.stringify([card.game || "pokemon", card.language || "English",
    source, card.variant || "normal"]);
}

/** Never add different currency amounts into one number, or convert using
 * an arbitrary FX rate. Missing prices are excluded and counted. */
export function calculatePortfolioValue(
  cards: OwnedCard[], mode: ValueMode = "copies"
): PortfolioValue {
  const valued = cards.filter((card) => quantity(card) > 0);
  const grouped = new Map<string, OwnedCard[]>();
  for (const card of valued) {
    const key = portfolioIdentity(card);
    const list = grouped.get(key) ?? [];
    list.push(card);
    grouped.set(key, list);
  }
  const copies = valued.reduce((sum, card) => sum + quantity(card), 0);
  const amounts: Record<string, number> = {};
  let priced = 0;
  let unpriced = 0;
  if (mode === "copies") {
    for (const card of valued) {
      const units = quantity(card);
      const market = price(card);
      if (market == null) {
        unpriced += units;
      } else {
        priced += units;
        const unit = currency(card);
        amounts[unit] = (amounts[unit] ?? 0) + market * units;
      }
    }
  } else {
    for (const duplicates of grouped.values()) {
      // Prefer the latest priced acquisition as the single reference copy.
      const representative = [...duplicates].sort((a, b) => {
        const hasA = price(a) == null ? 0 : 1;
        const hasB = price(b) == null ? 0 : 1;
        if (hasA !== hasB) return hasB - hasA;
        return (Date.parse(b.priceUpdatedAt || b.addedAt || "") || 0) -
          (Date.parse(a.priceUpdatedAt || a.addedAt || "") || 0);
      })[0];
      if (price(representative) == null) {
        unpriced += 1;
      } else {
        priced += 1;
        const unit = currency(representative);
        amounts[unit] = (amounts[unit] ?? 0) + price(representative)!;
      }
    }
  }
  const unique = grouped.size;
  return {
    amounts, records: valued.length, copies, unique,
    counted: mode === "copies" ? copies : unique,
    priced, unpriced, duplicates: Math.max(0, copies - unique),
  };
}

export function formatPortfolioAmounts(amounts: Record<string, number>): string {
  const parts = Object.entries(amounts)
    .filter(([, amount]) => Number.isFinite(amount))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unit, amount]) => {
      try {
        return new Intl.NumberFormat("en-US", {
          style: "currency", currency: unit, currencyDisplay: "code",
          maximumFractionDigits: 2,
        }).format(amount);
      } catch {
        return unit + " " + amount.toFixed(2);
      }
    });
  return parts.join(" · ") || "—";
}

export function groupOwnedSets(cards: OwnedCard[]): OwnedSetPortfolio[] {
  const map = new Map<string, OwnedSetPortfolio>();
  for (const card of cards) {
    if (!card.setId && !card.setName) continue;
    const language = card.language || "English";
    const game = card.game || "pokemon";
    const setId = card.setId?.trim() || null;
    const setName = card.setName?.trim() || setId || "Unknown set";
    const key = JSON.stringify([game, language,
      setId ? "id:" + setId : "name:" + setName]);
    const group = map.get(key) ?? { key, setId, setName, game, language, cards: [] };
    group.cards.push(card);
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) =>
    a.game.localeCompare(b.game) ||
    a.language.localeCompare(b.language) ||
    a.setName.localeCompare(b.setName)
  );
}
