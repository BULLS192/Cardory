import type { CardSearchResult, CardLanguage } from "./types";

/** Chinese printings are not interchangeable with Japanese / English, or
 * Simplified China products with Traditional Chinese products. Preserve
 * printed set codes and never invent a match from a similar card name. */
export type ChinesePrintLanguage = Extract<CardLanguage, "Chinese" | "Chinese Simplified">;
export type ChineseNumber = {
  setCode: string | null;
  collectorNumber: string | null;
  printedTotal: number | null;
};
const CODE = /^(?:[a-z]{1,7}[0-9][a-z0-9.\-]{0,16}|[0-9]{2,4}[a-z]|[a-z]{1,3}-[a-z])$/i;
const NUMBER = /^\d{1,4}[a-z]?$/i;
const clean = (s: string) => s.normalize("NFKC").replace(/[／⁄]/g, "/").trim();
const canonicalNumber = (s: string) => s.toUpperCase().replace(/^0+(?=\d)/, "");

export function parseChineseNumber(number?: string, explicitSet?: string): ChineseNumber {
  const raw = clean(number ?? "");
  const setInput = clean(explicitSet ?? "").replace(/\s+/g, "");
  let setCode = CODE.test(setInput) ? setInput.toUpperCase() : null;
  let local = raw;
  // "CSV9C 023/190", "CBB4C: 005/020", "151C 001/165",
  // and common Chinese set names with dotted series numbers.
  const prefix = raw.match(/^([A-Z0-9][A-Z0-9.\-]{1,20})\s*[:#\s]+(\d{1,4}[A-Z]?)(?:\s*\/\s*([A-Z0-9-]{1,16}))?$/i);
  if (prefix && CODE.test(prefix[1])) {
    setCode ??= prefix[1].toUpperCase();
    local = prefix[2] + (prefix[3] ? "/" + prefix[3] : "");
  }
  const suffix = raw.match(/^(\d{1,4}[A-Z]?(?:\s*\/\s*\d{1,4})?)\s+([A-Z0-9][A-Z0-9.\-]{1,20})$/i);
  if (suffix && CODE.test(suffix[2])) {
    setCode ??= suffix[2].toUpperCase();
    local = suffix[1];
  }
  const parts = local.replace(/\s+/g, "").split("/");
  const numerator = parts[0] ?? "";
  if (parts.length > 2 || !NUMBER.test(numerator)) {
    return { setCode, collectorNumber: null, printedTotal: null };
  }
  const denom = parts[1] ?? "";
  if (denom && CODE.test(denom) && !setCode) setCode = denom.toUpperCase();
  return {
    setCode,
    collectorNumber: numerator.toUpperCase(),
    printedTotal: /^\d{1,4}$/.test(denom) ? Number(denom) : null,
  };
}

export function equalChineseNumber(a: string | number, b: string | number) {
  return canonicalNumber(String(a).normalize("NFKC").split("/")[0]) ===
    canonicalNumber(String(b).normalize("NFKC").split("/")[0]);
}

function parseBrief(raw: unknown): { id: string; name: string; localId: string; image?: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const card = raw as Record<string, unknown>;
  if (typeof card.id !== "string" || typeof card.name !== "string" ||
      (typeof card.localId !== "string" && typeof card.localId !== "number")) return null;
  return { id: card.id, name: card.name, localId: String(card.localId),
    image: typeof card.image === "string" ? card.image : null };
}

type Brief = NonNullable<ReturnType<typeof parseBrief>>;
type SetInfo = { id: string; name: string; cardCount?: { official?: number }; cards?: Brief[] };
function parseSet(raw: unknown): SetInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.id !== "string" || typeof data.name !== "string") return null;
  const count = data.cardCount as Record<string, unknown> | undefined;
  return { id: data.id, name: data.name,
    cardCount: { official: typeof count?.official === "number" ? count.official : undefined },
    cards: Array.isArray(data.cards) ? data.cards.map(parseBrief).filter((card): card is Brief => Boolean(card)) : undefined };
}
const setFromCard = (id: string) => id.includes("-") ? id.slice(0, id.lastIndexOf("-")) : "";

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { next: { revalidate: 3600 },
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Chinese catalogue unavailable");
  return response.json();
}

export async function searchChineseCards(
  name: string | undefined, number: string | undefined,
  printedSet: string | undefined, language: ChinesePrintLanguage
): Promise<{ results: CardSearchResult[]; notice: string; count: number }> {
  const locale = language === "Chinese Simplified" ? "zh-cn" : "zh-tw";
  const parsed = parseChineseNumber(number, printedSet);
  if (printedSet?.trim() && !CODE.test(clean(printedSet).replace(/\s+/g, ""))) {
    return { results: [], notice: "Set code is invalid. Examples: CBB4C, CSV9C, 151C.", count: 0 };
  }
  if (number?.trim() && !parsed.collectorNumber) {
    return { results: [], notice: "Check the printed number (for example 023/190).", count: 0 };
  }

  let cards: Brief[] = [];
  const sets: SetInfo[] = [];
  if (parsed.setCode) {
    const upstream = parseSet(await fetchJson(
      `https://api.tcgdex.net/v2/${locale}/sets/${encodeURIComponent(parsed.setCode.toLowerCase())}`
    ));
    if (!upstream?.cards) {
      return { results: [], count: 0,
        notice: `This ${language === "Chinese" ? "Traditional" : "Simplified"} Chinese printing (${parsed.setCode}) is not indexed by the source. Use "Add unlisted Chinese card" to preserve your actual printing without substituting an English or Japanese card.` };
    }
    sets.push(upstream);
    cards = upstream.cards;
  } else if (parsed.collectorNumber) {
    const nums = [...new Set([parsed.collectorNumber, canonicalNumber(parsed.collectorNumber)])];
    const [responses, headers] = await Promise.all([
      Promise.all(nums.map(async num => {
        const params = new URLSearchParams({ localId: "eq:" + num });
        const result = await fetchJson(`https://api.tcgdex.net/v2/${locale}/cards?${params}`);
        return Array.isArray(result) ? result.map(parseBrief).filter((card): card is Brief => Boolean(card)) : [];
      })),
      fetchJson(`https://api.tcgdex.net/v2/${locale}/sets`).catch(() => []),
    ]);
    cards = responses.flat();
    if (Array.isArray(headers)) sets.push(...headers.map(parseSet).filter((item): item is SetInfo => Boolean(item)));
  }

  const nameTerm = clean(name ?? "").toLocaleLowerCase(locale);
  const matchName = Boolean(nameTerm) && (!parsed.collectorNumber || /[\u3400-\u9fff]/u.test(nameTerm));
  const seen = new Set<string>();
  const matched = cards.filter(card => {
    if (seen.has(card.id)) return false;
    if (parsed.collectorNumber && !equalChineseNumber(card.localId, parsed.collectorNumber)) return false;
    if (matchName && !card.name.normalize("NFKC").toLocaleLowerCase(locale).includes(nameTerm)) return false;
    seen.add(card.id);
    return true;
  });
  const byId = new Map(sets.map(set => [set.id.toLowerCase(), set]));
  if (parsed.printedTotal && !parsed.setCode) {
    matched.sort((a, b) => Number(byId.get(setFromCard(b.id).toLowerCase())?.cardCount?.official === parsed.printedTotal) -
      Number(byId.get(setFromCard(a.id).toLowerCase())?.cardCount?.official === parsed.printedTotal));
  }
  const results = matched.slice(0, 150).map(card => {
    const id = setFromCard(card.id);
    return { id: card.id, name: card.name, localId: card.localId, image: card.image,
      setId: id, setName: byId.get(id.toLowerCase())?.name ?? id,
      source: "TCGdex", game: "pokemon" as const, language };
  });
  const notice = !results.length
    ? `No verified ${language === "Chinese" ? "Traditional" : "Simplified"} Chinese printing was found. You can record the real printed set code and number using "Add unlisted Chinese card".`
    : matched.length > 1 && !parsed.setCode
      ? `${matched.length} matches share this number. Enter the printed set code to choose the correct Chinese printing.`
      : language === "Chinese Simplified"
        ? "Confirm the printed set code and artwork: this source can contain Simplified Chinese translations of international printings, not an actual China-market release."
        : !parsed.setCode
          ? "Confirm the printed set code: a collector number alone is not unique."
          : "";
  return { results, count: matched.length, notice };
}

/** Creates a clearly user-supplied, unverified identity for a real printing
 * absent from the external catalogue. Never fabricates artwork or a price. */
export function makeUnlistedChineseIdentity(
  language: ChinesePrintLanguage, printedNumber: string, printedCode: string,
  name: string, setName?: string
) {
  const parsed = parseChineseNumber(printedNumber, printedCode);
  if (!parsed.setCode || !parsed.collectorNumber) {
    throw new Error("Enter the actual printed Chinese set code and collector number.");
  }
  if (!name.trim()) throw new Error("Enter the printed Chinese card name.");
  if (name.trim().length > 120 || (setName ?? "").length > 120)
    throw new Error("Card or set name is too long.");
  const prefix = language === "Chinese Simplified" ? "zh-cn" : "zh-tw";
  const key = parsed.setCode.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const setId = `cardory-custom-${prefix}-${key}`;
  return {
    id: `${setId}-${parsed.collectorNumber.toLowerCase()}`,
    localId: parsed.collectorNumber,
    name: name.trim(),
    image: null,
    rarity: null,
    set: { id: setId, name: setName?.trim() || parsed.setCode },
    variants: { normal: true, foil: false, holo: false, reverse: false, firstEdition: false },
    marketCurrency: null,
    category: "Unverified manual entry",
  };
}
