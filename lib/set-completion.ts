import type { CatalogCard, CatalogSetDetail, CatalogLanguage } from "./catalogue";
import type { OwnedCard } from "./types";

export type CardOwnership = {
  card: CatalogCard;
  quantity: number;
  duplicateCopies: number;
  ownedRecords: number;
};

export type SetCompletion = {
  language: CatalogLanguage;
  setId: string;
  total: number;
  uniqueOwned: number;
  missing: number;
  copies: number;
  duplicates: number;
  percent: number;
  unmatchedOwnedRecords: number;
  entries: CardOwnership[];
};

/**
 * A "complete set" here means one copy of each provider-indexed card in a
 * single language. Holo/reverse/1st-edition master sets require a separate
 * printing-level checklist, and must not be assumed complete from this number.
 *
 * Multiple acquisition records for the same card are deliberately summed;
 * this preserves purchase/scan provenance in the existing collection model.
 */
export function calculateSetCompletion(
  set: CatalogSetDetail,
  language: CatalogLanguage,
  owned: OwnedCard[]
): SetCompletion {
  const languageName = language === "en" ? "English"
    : language === "ja" ? "Japanese" : language === "zh-cn" ? "Chinese Simplified" : "Chinese";
  const relevant = owned.filter(
    (item) => (item.game ?? "pokemon") === "pokemon" &&
      (item.language ?? "English") === languageName
  );

  const quantityById = new Map<string, { quantity: number; records: number }>();
  for (const item of relevant) {
    if (!item.tcgdexId) continue;
    const quantity = Math.max(0, Math.trunc(Number(item.quantity) || 0));
    if (!quantity) continue;
    const existing = quantityById.get(item.tcgdexId) ?? { quantity: 0, records: 0 };
    existing.quantity += quantity;
    existing.records += 1;
    quantityById.set(item.tcgdexId, existing);
  }

  const seen = new Set<string>();
  const entries: CardOwnership[] = [];
  for (const card of set.cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    const ownedEntry = quantityById.get(card.id) ?? { quantity: 0, records: 0 };
    entries.push({
      card,
      quantity: ownedEntry.quantity,
      duplicateCopies: Math.max(0, ownedEntry.quantity - 1),
      ownedRecords: ownedEntry.records,
    });
  }

  const total = entries.length;
  const uniqueOwned = entries.filter((entry) => entry.quantity > 0).length;
  const copies = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const duplicates = entries.reduce((sum, entry) => sum + entry.duplicateCopies, 0);
  // Count recorded cards referencing this same set but not indexed by TCGdex
  // separately; never mark catalogue cards owned by name-only guessing.
  const unmatchedOwnedRecords = relevant.filter((item) =>
    item.setId === set.id && !seen.has(item.tcgdexId)
  ).length;

  return {
    language,
    setId: set.id,
    total,
    uniqueOwned,
    missing: total - uniqueOwned,
    copies,
    duplicates,
    percent: total ? Math.round((uniqueOwned / total) * 1000) / 10 : 0,
    unmatchedOwnedRecords,
    entries,
  };
}

export function csvForMissingCards(completion: SetCompletion, setName: string): string {
  const csvCell = (value: string) => {
    // Escape CSV syntax and prevent spreadsheet-formula execution on import.
    const safe = /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  return [
    ["Set", "Set ID", "Language", "Card ID", "Number", "Card Name"]
      .map(csvCell).join(","),
    ...completion.entries.filter((entry) => !entry.quantity).map((entry) =>
      [setName, completion.setId, completion.language,
        entry.card.id, entry.card.localId, entry.card.name].map(csvCell).join(",")
    ),
  ].join("\r\n") + "\r\n";
}
