import type { OwnedCard } from "./types";
import { portfolioIdentity, type ValueMode } from "./portfolio";

export type PriceObservation = {
  owned_card_id: string;
  market_price: number;
  currency: string;
  source: string | null;
  snapshot_day: string;
  observed_at: string;
};
export type HistoryPoint = {
  date: string;
  amounts: Record<string, number>;
  priced: number;
  unpriced: number;
  copies: number;
};
export type HistoryRange = "1M" | "3M" | "1Y" | "ALL";
export type HistoryBasis = "owned" | "market";

const day = (value: string) => value.slice(0, 10);
const cardQty = (card: OwnedCard) => Math.max(0, Math.trunc(Number(card.quantity) || 0));
const validPrice = (price: number) => typeof price === "number" && Number.isFinite(price) && price >= 0;
const validUnit = (unit: string) => /^[A-Z]{3}$/.test(unit) ? unit : null;

/** Real observation dates only: no synthetic backfill to release or purchase.
 * Forward carry is an explicitly disclosed last-known quote, not an observed
 * price for that date. Actual holdings start on their recorded acquisition date.
 * Market basis is a hypothetical current basket priced at the source date,
 * with no assumption that the user owned the cards at that time.
 * Current holdings only: no reconstruction of previously sold/deleted cards. */
export function buildPortfolioHistory(
  cards: OwnedCard[], readings: PriceObservation[], mode: ValueMode,
  basis: HistoryBasis = "owned"
): HistoryPoint[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  const observations = readings.filter(item =>
    byId.has(item.owned_card_id) &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.snapshot_day) &&
    validPrice(Number(item.market_price)) &&
    Boolean(validUnit((item.currency || "").toUpperCase()))
  ).sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  if (!observations.length) return [];
  const dates = [...new Set(observations.map(item => item.snapshot_day))].sort();
  const observed = new Map<string, PriceObservation>();
  let position = 0;
  const result: HistoryPoint[] = [];
  for (const date of dates) {
    while (position < observations.length && observations[position].snapshot_day <= date) {
      observed.set(observations[position].owned_card_id, observations[position]);
      position++;
    }
    const eligible = cards.filter(card =>
      cardQty(card) > 0 &&
      (basis === "market" || day(card.acquisition?.date || card.addedAt || date) <= date)
    );
    if (!eligible.length) continue;
    const valued = new Map<string, { card: OwnedCard; quote: PriceObservation }[]>();
    let copies = 0;
    for (const card of eligible) {
      copies += cardQty(card);
      const quote = observed.get(card.id);
      if (!quote) continue;
      const key = portfolioIdentity(card);
      const group = valued.get(key) || [];
      group.push({ card, quote });
      valued.set(key, group);
    }
    const amounts: Record<string, number> = {};
    let priced = 0;
    for (const group of valued.values()) {
      if (mode === "unique") {
        const entry = [...group].sort((a, b) => b.quote.observed_at.localeCompare(a.quote.observed_at) || Number(b.quote.market_price) - Number(a.quote.market_price))[0];
        const unit = entry.quote.currency.toUpperCase();
        amounts[unit] = (amounts[unit] || 0) + Number(entry.quote.market_price);
        priced++;
      } else {
        for (const entry of group) {
          const unit = entry.quote.currency.toUpperCase();
          const quantity = cardQty(entry.card);
          amounts[unit] = (amounts[unit] || 0) + Number(entry.quote.market_price) * quantity;
          priced += quantity;
        }
      }
    }
    const unique = new Set(eligible.map(portfolioIdentity)).size;
    const considered = mode === "unique" ? unique : copies;
    result.push({ date, amounts, priced, unpriced: Math.max(0, considered - priced), copies: considered });
  }
  return result;
}

export function rangeHistory(points: HistoryPoint[], range: HistoryRange): HistoryPoint[] {
  if (!points.length || range === "ALL") return points;
  const last = new Date(points[points.length - 1].date + "T00:00:00Z");
  const cutoff = new Date(last);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - (range === "1M" ? 1 : range === "3M" ? 3 : 12));
  return points.filter(point => point.date >= cutoff.toISOString().slice(0, 10));
}

export function availableHistoryCurrencies(points: HistoryPoint[]): string[] {
  return [...new Set(points.flatMap(p => Object.keys(p.amounts)))].sort();
}
