import type { CatalogLanguage, CatalogSet } from "./catalogue";
import type { OwnedCard } from "./types";

/**
 * A collector's recorded set must remain visible when an upstream provider
 * temporarily disappears. These are IDENTIFICATION ONLY, never a full set
 * checklist or a denominator for completion percentages.
 */
export function mergeSetsWithOwned(
  indexed: CatalogSet[],
  ownedCards: OwnedCard[],
  language: CatalogLanguage
): { sets: CatalogSet[]; missingChecklists: string[] } {
  const targetLanguage = language === "en" ? "English"
    : language === "ja" ? "Japanese" : language === "zh-cn" ? "Chinese Simplified" : "Chinese";
  const merged = new Map(indexed.map((set) => [set.id, set]));
  const missingChecklists = new Set<string>();
  for (const card of ownedCards) {
    if ((card.game ?? "pokemon") !== "pokemon" ||
        (card.language ?? "English") !== targetLanguage ||
        !card.setId || !card.setId.trim()) continue;
    if (!merged.has(card.setId)) {
      merged.set(card.setId, {
        id: card.setId,
        name: card.setName?.trim() || card.setId,
        logo: null,
        symbol: null,
        cardCount: { official: 0, total: 0 },
      });
      missingChecklists.add(card.setId);
    }
  }
  return { sets: [...merged.values()], missingChecklists: [...missingChecklists] };
}
