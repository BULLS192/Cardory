import { CardSearchResult, CardVariant, TcgDexCard, TcgPlayerPricing } from "./types";

const TCGCSV_BASE = "https://tcgcsv.com/tcgplayer/3";
const USER_AGENT = "PokedexVault/0.1 (github.com/BULLS192/Pokedex)";

// TCGdex can lag newly released sets. These recent TCGplayer groups are queried
// as a fallback so brand-new cards are searchable as soon as TCGCSV publishes them.
const RECENT_GROUPS = [
  { groupId: 24722, name: "30th Celebration" },
  { groupId: 24837, name: "30th Celebration Classic Collection" },
] as const;

type ExtendedField = {
  name?: string;
  displayName?: string;
  value?: string;
};

type TcgCsvProduct = {
  productId: number;
  name: string;
  cleanName?: string;
  imageUrl?: string;
  url?: string;
  extendedData?: ExtendedField[];
};

type TcgCsvPrice = {
  productId: number;
  lowPrice?: number;
  midPrice?: number;
  highPrice?: number;
  marketPrice?: number;
  directLowPrice?: number;
  subTypeName?: string;
};

type TcgCsvResponse<T> = {
  success?: boolean;
  results?: T[];
};

function field(product: TcgCsvProduct, key: string) {
  return product.extendedData?.find(
    (entry) => entry.name?.toLowerCase() === key.toLowerCase()
  )?.value;
}

function normalizeNumber(value?: string | null) {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/^0+(?=\d)/, "");
}

function numerator(value?: string | null) {
  return normalizeNumber(value).split("/")[0] ?? "";
}

function matchesNumber(cardNumber: string | undefined, query: string | undefined) {
  if (!query) return true;
  const a = normalizeNumber(cardNumber);
  const b = normalizeNumber(query);
  return a === b || numerator(a) === numerator(b);
}

async function json<T>(url: string, revalidate = 86400): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function productsForGroup(groupId: number) {
  const data = await json<TcgCsvResponse<TcgCsvProduct>>(
    `${TCGCSV_BASE}/${groupId}/products`
  );
  return data?.results ?? [];
}

async function pricesForGroup(groupId: number) {
  const data = await json<TcgCsvResponse<TcgCsvPrice>>(
    `${TCGCSV_BASE}/${groupId}/prices`,
    21600
  );
  return data?.results ?? [];
}

export async function searchRecentTcgCsv(
  name?: string,
  number?: string
): Promise<CardSearchResult[]> {
  const queryName = name?.trim().toLowerCase();

  const groups = await Promise.all(
    RECENT_GROUPS.map(async (group) => ({
      ...group,
      products: await productsForGroup(group.groupId),
    }))
  );

  const results: CardSearchResult[] = [];

  for (const group of groups) {
    for (const product of group.products) {
      const cardNumber = field(product, "Number");
      if (!cardNumber) continue;

      const productName = (product.cleanName || product.name || "").toLowerCase();
      if (queryName && !productName.includes(queryName)) continue;
      if (!matchesNumber(cardNumber, number)) continue;

      results.push({
        id: `tcgcsv-${group.groupId}-${product.productId}`,
        localId: cardNumber,
        name: product.name,
        image: product.imageUrl ?? null,
        setName: group.name,
        rarity: field(product, "Rarity") ?? null,
        source: "TCGCSV",
      });
    }
  }

  return results;
}

function variantKey(subTypeName?: string): CardVariant | null {
  const value = (subTypeName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (value.includes("reverse") && value.includes("holo")) return "reverse-holofoil";
  if (value.includes("holo")) return "holofoil";
  if (value.includes("1st") || value.includes("first edition")) return "1st-edition";
  if (value.includes("unlimited")) return "unlimited";
  if (value.includes("normal")) return "normal";
  return null;
}

export async function getTcgCsvCard(id: string): Promise<TcgDexCard | null> {
  const match = /^tcgcsv-(\d+)-(\d+)$/.exec(id);
  if (!match) return null;

  const groupId = Number(match[1]);
  const productId = Number(match[2]);
  const group = RECENT_GROUPS.find((item) => item.groupId === groupId);
  if (!group) return null;

  const [products, prices] = await Promise.all([
    productsForGroup(groupId),
    pricesForGroup(groupId),
  ]);

  const product = products.find((item) => item.productId === productId);
  if (!product) return null;

  const productPrices = prices.filter((item) => item.productId === productId);
  const tcgplayer: TcgPlayerPricing = {
    updated: new Date().toISOString(),
    unit: "USD",
  };

  let hasNormal = false;
  let hasHolo = false;
  let hasReverse = false;

  for (const row of productPrices) {
    const key = variantKey(row.subTypeName);
    if (!key) continue;
    tcgplayer[key] = {
      lowPrice: row.lowPrice,
      midPrice: row.midPrice,
      highPrice: row.highPrice,
      marketPrice: row.marketPrice,
      directLowPrice: row.directLowPrice,
    };
    if (key === "normal") hasNormal = true;
    if (key === "holofoil") hasHolo = true;
    if (key === "reverse-holofoil") hasReverse = true;
  }

  const rarity = field(product, "Rarity") ?? null;
  if (!productPrices.length && /classic collection/i.test(rarity ?? "")) hasHolo = true;
  if (!hasNormal && !hasHolo && !hasReverse) hasNormal = true;

  const hpValue = Number(field(product, "HP"));
  const cardType = field(product, "Card Type");

  return {
    id,
    localId: field(product, "Number") ?? String(productId),
    name: product.name,
    image: product.imageUrl ?? null,
    rarity,
    category: "Pokemon",
    hp: Number.isFinite(hpValue) ? hpValue : null,
    types: cardType && !/energy|trainer/i.test(cardType) ? [cardType] : [],
    variants: {
      normal: hasNormal,
      holo: hasHolo,
      reverse: hasReverse,
      firstEdition: false,
      wPromo: false,
    },
    set: {
      id: `tcgplayer-${groupId}`,
      name: group.name,
    },
    pricing: {
      tcgplayer,
    },
  };
}
