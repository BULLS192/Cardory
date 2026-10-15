/**
 * Public Pokémon TCGdex catalogue integration.
 *
 * All IDs and language codes are validated before contacting the fixed upstream.
 * Card images are referenced, never downloaded or mirrored.
 */
export const CATALOG_LANGUAGES = ["en", "ja", "zh-tw", "zh-cn"] as const;
export type CatalogLanguage = (typeof CATALOG_LANGUAGES)[number];

export type CatalogCard = {
  id: string;
  localId: string;
  name: string;
  image?: string | null;
};

export type CatalogSet = {
  id: string;
  name: string;
  logo?: string | null;
  symbol?: string | null;
  cardCount: { total: number; official: number };
};

export type CatalogSetDetail = CatalogSet & {
  releaseDate?: string | null;
  serie?: { id: string; name: string } | null;
  cards: CatalogCard[];
};

export function asCatalogLanguage(value: string | null): CatalogLanguage | null {
  return CATALOG_LANGUAGES.find((language) => language === value) ?? null;
}

export function validCatalogueId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

function imageReference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "assets.tcgdex.net"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function normaliseSet(input: unknown): CatalogSet | null {
  if (!input || typeof input !== "object") return null;
  const set = input as Record<string, unknown>;
  if (typeof set.id !== "string" || !validCatalogueId(set.id) ||
      typeof set.name !== "string") return null;
  const count = (set.cardCount ?? {}) as Record<string, unknown>;
  return {
    id: set.id,
    name: set.name,
    logo: imageReference(set.logo),
    symbol: imageReference(set.symbol),
    cardCount: {
      official: typeof count.official === "number" ? count.official : 0,
      total: typeof count.total === "number" ? count.total : 0,
    },
  };
}

export function normaliseSetDetail(input: unknown): CatalogSetDetail | null {
  const base = normaliseSet(input);
  if (!base || !input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const rawSerie = raw.serie && typeof raw.serie === "object"
    ? raw.serie as Record<string, unknown>
    : null;
  const cards: CatalogCard[] = Array.isArray(raw.cards)
    ? raw.cards.flatMap((item: unknown) => {
        if (!item || typeof item !== "object") return [];
        const card = item as Record<string, unknown>;
        if (typeof card.id !== "string" || typeof card.name !== "string" ||
            typeof card.localId !== "string") return [];
        return [{
          id: card.id,
          localId: card.localId,
          name: card.name,
          image: imageReference(card.image),
        }];
      })
    : [];
  return {
    ...base,
    cards,
    releaseDate: typeof raw.releaseDate === "string" ? raw.releaseDate : null,
    serie: rawSerie && typeof rawSerie.id === "string" &&
      typeof rawSerie.name === "string"
      ? { id: rawSerie.id, name: rawSerie.name }
      : null,
  };
}

export async function getCatalogResource(
  language: CatalogLanguage, resource: "sets" | `sets/${string}`
): Promise<Response> {
  return fetch(`https://api.tcgdex.net/v2/${language}/${resource}`, {
    next: { revalidate: 60 * 60 * 6 },
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
}
