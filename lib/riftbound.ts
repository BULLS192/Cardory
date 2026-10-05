import {
  CardLanguage,
  CardSearchResult,
  CardVariant,
  TcgDexCard,
  TcgPlayerPricing,
} from "./types";

const CATEGORY_ID = 89;
const TCGCSV_BASE = `https://tcgcsv.com/tcgplayer/${CATEGORY_ID}`;
const USER_AGENT = "Cardory/0.3";

const GROUPS = [
  { groupId: 24343, name: "Riftbound Promotional Cards" },
  { groupId: 24344, name: "Origins" },
  { groupId: 24439, name: "Origins: Proving Grounds" },
  { groupId: 24502, name: "Riftbound Worlds Bundle 2025" },
  { groupId: 24519, name: "Spiritforged" },
  { groupId: 24528, name: "Riftbound Organized Play Promotional Cards" },
  { groupId: 24552, name: "Riftbound Judge Promotional Cards" },
  { groupId: 24560, name: "Unleashed" },
  { groupId: 24698, name: "Vendetta" },
  { groupId: 24797, name: "Secret Garden" },
  { groupId: 24819, name: "Radiance" },
  { groupId: 24832, name: "Legacy" },
  { groupId: 24861, name: "Riftbound Bundles" },
] as const;

type ExtendedField = {
  name?: string;
  displayName?: string;
  value?: string;
};

type Product = {
  productId: number;
  name: string;
  cleanName?: string;
  imageUrl?: string;
  extendedData?: ExtendedField[];
};

type Price = {
  productId: number;
  lowPrice?: number;
  midPrice?: number;
  highPrice?: number;
  marketPrice?: number;
  directLowPrice?: number | null;
  subTypeName?: string;
};

type TcgCsvResponse<T> = {
  success?: boolean;
  results?: T[];
};

function field(product: Product, key: string) {
  return product.extendedData?.find(
    (entry) => entry.name?.toLowerCase() === key.toLowerCase()
  )?.value;
}

function normalize(value?: string | number | null) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeNumber(value?: string | number | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^0+(?=\d)/, "");
}

function numerator(value?: string | number | null) {
  return normalizeNumber(value).split("/")[0] ?? "";
}

function matchesNumber(cardNumber: string | undefined, query: string | undefined) {
  if (!query) return true;
  const a = normalizeNumber(cardNumber);
  const b = normalizeNumber(query);
  return a === b || numerator(a) === numerator(b);
}

function displayName(product: Product) {
  const raw = product.cleanName || product.name || "";
  return raw.replace(/\s*-\s*\d+\s*\/\s*\d+\s*$/i, "").trim();
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
  const data = await json<TcgCsvResponse<Product>>(
    `${TCGCSV_BASE}/${groupId}/products`
  );
  return data?.results ?? [];
}

async function pricesForGroup(groupId: number) {
  const data = await json<TcgCsvResponse<Price>>(
    `${TCGCSV_BASE}/${groupId}/prices`,
    21600
  );
  return data?.results ?? [];
}

function variantKey(subTypeName?: string): CardVariant | null {
  const value = normalize(subTypeName);
  if (value.includes("foil")) return "foil";
  if (value.includes("normal")) return "normal";
  return null;
}

function buildCard(
  group: (typeof GROUPS)[number],
  product: Product,
  prices: Price[],
  language: CardLanguage
): TcgDexCard {
  const productPrices = prices.filter((row) => row.productId === product.productId);
  const tcgplayer: TcgPlayerPricing = {
    updated: new Date().toISOString(),
    unit: "USD",
  };

  let hasNormal = false;
  let hasFoil = false;

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
    if (key === "foil") hasFoil = true;
  }

  if (!hasNormal && !hasFoil) hasNormal = true;

  const domain = field(product, "Domain");
  const number = field(product, "Number") ?? String(product.productId);

  return {
    id: `riftcsv-${group.groupId}-${product.productId}`,
    localId: number,
    name: displayName(product),
    // Riot's Riftbound digital tools policy requires card assets to come
    // through Riot's API. Keep TCGplayer artwork out of the app until a
    // Riot app-specific API key is connected.
    image: null,
    rarity: field(product, "Rarity") ?? null,
    category: field(product, "Card Type") ?? "Riftbound",
    types: domain ? domain.split(";").map((item) => item.trim()).filter(Boolean) : [],
    game: "riftbound",
    language,
    marketCurrency: "USD",
    variants: {
      normal: hasNormal,
      foil: hasFoil,
      holo: false,
      reverse: false,
      firstEdition: false,
      wPromo: false,
    },
    set: {
      id: `riftbound-${group.groupId}`,
      name: group.name,
    },
    pricing: {
      tcgplayer,
    },
  };
}

export async function searchRiftbound(
  name?: string,
  number?: string,
  language: CardLanguage = "English"
): Promise<CardSearchResult[]> {
  const wantedName = normalize(name);
  const groupProducts = await Promise.all(
    GROUPS.map(async (group) => ({
      ...group,
      products: await productsForGroup(group.groupId),
    }))
  );

  const results: CardSearchResult[] = [];

  for (const group of groupProducts) {
    for (const product of group.products) {
      const cardNumber = field(product, "Number");
      const rarity = field(product, "Rarity");

      // Sealed products generally do not have a card number/rarity.
      if (!cardNumber && !rarity) continue;

      if (wantedName && !normalize(displayName(product)).includes(wantedName)) continue;
      if (!matchesNumber(cardNumber, number)) continue;

      results.push({
        id: `riftcsv-${group.groupId}-${product.productId}`,
        localId: cardNumber ?? String(product.productId),
        name: displayName(product),
        image: null,
        setId: `riftbound-${group.groupId}`,
        setName: group.name,
        rarity: rarity ?? null,
        source: "TCGCSV",
        game: "riftbound",
        language,
      });
    }
  }

  return results.slice(0, 80);
}

export async function getRiftboundCard(
  id: string,
  language: CardLanguage = "English"
): Promise<TcgDexCard | null> {
  const match = /^riftcsv-(\d+)-(\d+)$/.exec(id);
  if (!match) return null;

  const groupId = Number(match[1]);
  const productId = Number(match[2]);
  const group = GROUPS.find((item) => item.groupId === groupId);
  if (!group) return null;

  const [products, prices] = await Promise.all([
    productsForGroup(groupId),
    pricesForGroup(groupId),
  ]);

  const product = products.find((item) => item.productId === productId);
  if (!product) return null;

  return buildCard(group, product, prices, language);
}
