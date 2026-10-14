import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CatalogLanguage, CatalogSet, CatalogSetDetail } from "./catalogue";

/**
 * Server-side, read-only access to the public Pokémon reference tables.
 * Never use a service-role key in a website route or browser application.
 * Missing/unrestored databases fail closed and fall back to the live catalogue.
 */
function readClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => fetch(input, {
          ...init,
          signal: AbortSignal.timeout(4000),
        }),
      },
    });
  } catch {
    return null;
  }
}

type SetRow = {
  provider: string;
  language: string;
  set_id: string;
  name: string;
  series_id: string | null;
  series_name: string | null;
  release_date: string | null;
  card_count_official: number;
  card_count_total: number;
  logo_url: string | null;
  symbol_url: string | null;
};

type CardRow = {
  card_id: string;
  local_id: string;
  name: string;
  image_url: string | null;
};

function mappedSet(row: SetRow): CatalogSet {
  return {
    id: row.set_id,
    name: row.name,
    logo: row.logo_url,
    symbol: row.symbol_url,
    cardCount: {
      official: row.card_count_official,
      total: row.card_count_total,
    },
  };
}

export async function getIndexedSets(language: CatalogLanguage): Promise<CatalogSet[]> {
  const client = readClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("pokemon_catalog_sets")
      .select("provider,language,set_id,name,series_id,series_name,release_date,card_count_official,card_count_total,logo_url,symbol_url")
      .eq("provider", "tcgdex")
      .eq("language", language)
      .limit(1000);
    if (error) return [];
    return ((data ?? []) as SetRow[]).map(mappedSet);
  } catch {
    return [];
  }
}

export async function getIndexedSetDetail(
  language: CatalogLanguage, id: string
): Promise<CatalogSetDetail | null> {
  const client = readClient();
  if (!client) return null;
  try {
    const { data: rawSet, error: setError } = await client
      .from("pokemon_catalog_sets")
      .select("provider,language,set_id,name,series_id,series_name,release_date,card_count_official,card_count_total,logo_url,symbol_url")
      .eq("provider", "tcgdex")
      .eq("language", language)
      .eq("set_id", id)
      .maybeSingle();
    if (setError || !rawSet) return null;
    const set = rawSet as SetRow;

    // PostgREST defaults to 1000 rows; this is deliberately bounded.
    // If the import is incomplete, fall back to TCGdex rather than
    // misrepresenting an incomplete checklist as a complete set.
    if (!set.card_count_total || set.card_count_total > 1000) return null;

    const { data, error } = await client
      .from("pokemon_catalog_cards")
      .select("card_id,local_id,name,image_url")
      .eq("provider", "tcgdex")
      .eq("language", language)
      .eq("set_id", id)
      .limit(1000);
    if (error) return null;
    const cards = (data ?? []) as CardRow[];
    if (cards.length !== set.card_count_total) return null;
    return {
      ...mappedSet(set),
      releaseDate: set.release_date,
      serie: set.series_id && set.series_name
        ? { id: set.series_id, name: set.series_name } : null,
      cards: cards.map((card) => ({
        id: card.card_id,
        localId: card.local_id,
        name: card.name,
        image: card.image_url,
      })).sort((a, b) => a.localId.localeCompare(b.localId, undefined, { numeric: true })),
    };
  } catch {
    return null;
  }
}

export async function getIndexedFullCard(
  language: CatalogLanguage, id: string
): Promise<Record<string, unknown> | null> {
  const client = readClient();
  if (!client) return null;
  try {
    const { data, error } = await client
      .from("pokemon_catalog_cards")
      .select("metadata,metadata_level")
      .eq("provider", "tcgdex")
      .eq("language", language)
      .eq("card_id", id)
      .maybeSingle();
    if (error || !data || data.metadata_level !== "full" ||
        !data.metadata || typeof data.metadata !== "object" ||
        Array.isArray(data.metadata)) return null;
    return data.metadata as Record<string, unknown>;
  } catch {
    return null;
  }
}
