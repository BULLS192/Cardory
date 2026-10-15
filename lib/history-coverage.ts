import type { OwnedCard } from "./types";
import { portfolioIdentity } from "./portfolio";
import type { PriceObservation } from "./portfolio-history";

export type CardHistoryCoverage = {
  identity: string;
  recordId: string;
  name: string;
  localId: string;
  setId: string;
  setName: string;
  game: string;
  language: string;
  variant: string;
  recordCount: number;
  quantity: number;
  observedDays: number;
  firstDate: string | null;
  lastDate: string | null;
  firstPrice: number | null;
  lastPrice: number | null;
  lastCurrency: string | null;
  source: string | null;
};

function quoteIsValid(item: PriceObservation): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(item.snapshot_day) &&
    Number.isFinite(Number(item.market_price)) && Number(item.market_price) >= 0 &&
    /^[A-Z]{3}$/.test((item.currency || "").toUpperCase());
}

/**
 * Every unique provider printing/language/variant stays visible, even if it
 * has zero quotes. This is source coverage, not a reconstructed market price.
 * If several acquisition records represent one printing, a day is counted
 * once and never inflated by duplicate owned rows.
 */
export function buildCardHistoryCoverage(
  cards: OwnedCard[], observations: PriceObservation[],
): CardHistoryCoverage[] {
  const groupById = new Map<string, OwnedCard[]>();
  for (const card of cards) {
    const key = portfolioIdentity(card);
    groupById.set(key, [...(groupById.get(key) ?? []), card]);
  }
  const readings = new Map<string, PriceObservation[]>();
  const identityByRecord = new Map<string, string>();
  for (const [id, group] of groupById) {
    for (const card of group) identityByRecord.set(card.id, id);
  }
  for (const item of observations) {
    if (!quoteIsValid(item)) continue;
    const id = identityByRecord.get(item.owned_card_id);
    if (!id) continue;
    readings.set(id, [...(readings.get(id) ?? []), item]);
  }
  const result: CardHistoryCoverage[] = [];
  for (const [id, group] of groupById) {
    const sample = group[0];
    const all = readings.get(id) ?? [];
    const dates = [...new Set(all.map(x => x.snapshot_day))].sort();
    const sorted = [...all].sort((a, b) => a.snapshot_day.localeCompare(b.snapshot_day)
      || a.observed_at.localeCompare(b.observed_at));
    const earliest = sorted[0] ?? null;
    const latest = sorted.at(-1) ?? null;
    result.push({
      identity: id, recordId: sample.id,
      name: sample.name, localId: sample.localId,
      setId: sample.setId || "", setName: sample.setName || "Unknown set",
      game: sample.game || "pokemon", language: sample.language || "English",
      variant: sample.variant,
      recordCount: group.length,
      quantity: group.reduce((count, card) => count + Math.max(0, Math.trunc(card.quantity || 0)), 0),
      observedDays: dates.length,
      firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null,
      firstPrice: earliest ? Number(earliest.market_price) : null,
      lastPrice: latest ? Number(latest.market_price) : null,
      lastCurrency: latest?.currency || null,
      source: earliest?.source || null,
    });
  }
  return result.sort((a, b) => a.setName.localeCompare(b.setName)
    || a.localId.localeCompare(b.localId, undefined, { numeric: true })
    || a.language.localeCompare(b.language));
}

export function summarizeHistoryCoverage(rows: CardHistoryCoverage[], baseline = "2026-10-15") {
  return {
    printings: rows.length,
    records: rows.reduce((sum, item) => sum + item.recordCount, 0),
    withAnyHistory: rows.filter(item => item.observedDays > 0).length,
    withOlderHistory: rows.filter(item => item.firstDate && item.firstDate < baseline).length,
    withoutOlderHistory: rows.filter(item => !item.firstDate || item.firstDate >= baseline).length,
    withoutAnyHistory: rows.filter(item => item.observedDays === 0).length,
  };
}
