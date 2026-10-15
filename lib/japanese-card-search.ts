/**
 * Manual Japanese collector numbers usually carry BOTH a printed set code
 * (SV4a, M1S, SV-P, etc.) and a number (123/190).
 * Never infer a card's set from its collector number alone.
 */
export type JapaneseCardQuery = {
  setId: string | null;
  collectorNumber: string | null;
  printedTotal: number | null;
};

export function normalizeJapaneseCollectorId(value: string | number): string {
  const compact = String(value).normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
  const token = compact.split("/")[0] ?? "";
  return token.replace(/^0+(?=\d)/, "");
}

export function parseJapaneseCardQuery(
  number: string | undefined,
  explicitSet: string | undefined
): JapaneseCardQuery {
  const raw = (number ?? "").normalize("NFKC").trim().replace(/[／]/g, "/");
  const setField = (explicitSet ?? "").normalize("NFKC").trim();

  // Printed set code is optional, but always validated before making an HTTP request.
  const setCode = /^[A-Z][A-Z0-9-]{1,15}$/i;
  let setId = setCode.test(setField) ? setField.toLowerCase() : null;
  let collector = raw;

  // "SV4a 123/190", "M1S-001/063", "SV-P 005", including full-width digits.
  const prefixed = raw.match(/^([a-z][a-z0-9-]{1,15})[\s:_#-]+(\d{1,4}[a-z]?)(?:\s*\/\s*([a-z0-9-]{1,16}))?$/i);
  if (prefixed) {
    setId = setId ?? prefixed[1].toLowerCase();
    collector = prefixed[2] + (prefixed[3] ? "/" + prefixed[3] : "");
  } else {
    // "123/190 SV4a" is sometimes how collectors type the printed number.
    const trailing = raw.match(/^(\d{1,4}[a-z]?(?:\s*\/\s*\d{1,4})?)[\s:_#-]+([a-z][a-z0-9-]{1,15})$/i);
    if (trailing) {
      setId = setId ?? trailing[2].toLowerCase();
      collector = trailing[1];
    }
  }

  const parts = collector.replace(/\s+/g, "").toUpperCase().split("/");
  if (parts.length > 2 || !/^\d{1,4}[A-Z]?$/.test(parts[0])) {
    return { setId, collectorNumber: null, printedTotal: null };
  }

  const denominator = parts[1] ?? "";
  // Some Japanese promos print their set code after the slash: 012/SV-P.
  if (!setId && /^[A-Z][A-Z0-9-]{1,15}$/.test(denominator)) {
    setId = denominator.toLowerCase();
  }
  const printedTotal = /^\d{1,4}$/.test(denominator) ? Number(denominator) : null;
  return {
    setId,
    collectorNumber: parts[0],
    printedTotal,
  };
}

export function isJapaneseCardNumberMatch(localId: string, number: string): boolean {
  return normalizeJapaneseCollectorId(localId) === normalizeJapaneseCollectorId(number);
}

import type { CardSearchResult } from "./types";

type TcgDexBrief = {
  id: string;
  localId: string | number;
  name: string;
  image?: string | null;
};

type TcgDexSet = {
  id: string;
  name: string;
  cardCount?: { total?: number; official?: number };
  cards?: TcgDexBrief[];
};

export type JapaneseSearchResult = {
  results: CardSearchResult[];
  notice?: string;
  count: number;
};

async function getJapaneseJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(12000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error("Japanese catalogue temporarily unavailable (" + response.status + ")");
  }
  return response.json();
}

function asBrief(value: unknown): TcgDexBrief | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.name !== "string" ||
      (typeof item.localId !== "string" && typeof item.localId !== "number")) return null;
  return {
    id: item.id,
    localId: item.localId,
    name: item.name,
    image: typeof item.image === "string" ? item.image : null,
  };
}

function cardSetId(id: string): string {
  return id.includes("-") ? id.slice(0, id.lastIndexOf("-")) : "";
}

function asSet(value: unknown): TcgDexSet | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  return {
    id: item.id,
    name: item.name,
    cardCount: item.cardCount && typeof item.cardCount === "object"
      ? item.cardCount as TcgDexSet["cardCount"] : undefined,
    cards: Array.isArray(item.cards)
      ? item.cards.map(asBrief).filter((card): card is TcgDexBrief => Boolean(card))
      : undefined,
  };
}

const MAX_RESULTS = 150;

export async function searchJapaneseCards(
  name: string | undefined,
  number: string | undefined,
  setCode: string | undefined
): Promise<JapaneseSearchResult> {
  const parsed = parseJapaneseCardQuery(number, setCode);
  const wanted = parsed.collectorNumber;
  const nameLower = (name ?? "").normalize("NFKC").trim().toLocaleLowerCase("ja");

  if (number && !wanted) {
    return { results: [], count: 0,
      notice: "Check the printed collector number. Enter it as SV4a 123/190 or set code SV4a with number 123/190." };
  }

  if (setCode?.trim() && !parsed.setId) {
    return { results: [], count: 0, notice: "Invalid Japanese set code. Examples: SV4a, SV10, M1S, SV-P." };
  }

  let briefs: TcgDexBrief[] = [];
  let sourceSets: TcgDexSet[] = [];

  if (parsed.setId) {
    const rawSet = await getJapaneseJson(
      "https://api.tcgdex.net/v2/ja/sets/" + encodeURIComponent(parsed.setId)
    );
    const set = asSet(rawSet);
    if (!set?.cards) {
      return { results: [], count: 0,
        notice: "Set code " + parsed.setId.toUpperCase() +
          " was not available in the Japanese catalogue. Check its printed code or try the collector number without a set code." };
    }
    briefs = set.cards;
    sourceSets = [set];
  } else if (wanted) {
    const numberVariants = [...new Set([wanted, normalizeJapaneseCollectorId(wanted)])];
    const requests = numberVariants.map(async (variant) => {
      const params = new URLSearchParams({
        localId: "eq:" + variant,
      });
      const value = await getJapaneseJson(
        "https://api.tcgdex.net/v2/ja/cards?" + params.toString()
      );
      return Array.isArray(value)
        ? value.map(asBrief).filter((card): card is TcgDexBrief => Boolean(card))
        : [];
    });
    const [groups, setHeaders] = await Promise.all([
      Promise.all(requests),
      getJapaneseJson("https://api.tcgdex.net/v2/ja/sets").catch(() => []),
    ]);
    briefs = groups.flat();
    sourceSets = Array.isArray(setHeaders)
      ? setHeaders.map(asSet).filter((set): set is TcgDexSet => Boolean(set))
      : [];
  }

  const matching = briefs.filter((card) =>
    (!wanted || isJapaneseCardNumberMatch(String(card.localId), wanted)) &&
    (!nameLower || card.name.normalize("NFKC").toLocaleLowerCase("ja").includes(nameLower))
  );
  const setsById = new Map(sourceSets.map((set) => [set.id.toLowerCase(), set]));
  const seen = new Set<string>();
  const unique = matching.filter((card) => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });

  if (parsed.printedTotal != null && !parsed.setId) {
    unique.sort((a, b) => {
      const aCount = setsById.get(cardSetId(a.id).toLowerCase())?.cardCount?.official;
      const bCount = setsById.get(cardSetId(b.id).toLowerCase())?.cardCount?.official;
      return Number(bCount === parsed.printedTotal) - Number(aCount === parsed.printedTotal);
    });
  }

  const results: CardSearchResult[] = unique.slice(0, MAX_RESULTS).map((card) => {
    const id = cardSetId(card.id);
    return {
      id: card.id,
      localId: String(card.localId),
      name: card.name,
      image: card.image,
      setId: id || undefined,
      setName: setsById.get(id.toLowerCase())?.name ?? id,
      source: "TCGdex",
      game: "pokemon",
      language: "Japanese",
    };
  });

  let notice: string | undefined;
  if (!unique.length) {
    notice = parsed.setId
      ? "No matching Japanese card in " + parsed.setId.toUpperCase() +
        ". Verify the card number and printed set code."
      : nameLower
        ? "No matching Japanese card. TCGdex uses Japanese names; try the printed number and set code instead."
        : "No matching Japanese card found. Add the printed set code to narrow the search.";
  } else if (!parsed.setId && unique.length > 1) {
    notice = unique.length + " Japanese cards share this collector number. Enter the set code printed on the card (for example SV4a) to identify the correct printing.";
  }

  return { results, count: unique.length, notice };
}
