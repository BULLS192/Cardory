import { NextRequest, NextResponse } from "next/server";
import { tcgdexBase } from "@/lib/tcgdex";
import { searchJapaneseCards } from "@/lib/japanese-card-search";
import { searchChineseCards } from "@/lib/chinese-card-search";
import { searchRecentTcgCsv } from "@/lib/tcgcsv";
import { searchRiftbound } from "@/lib/riftbound";
import { CardLanguage } from "@/lib/types";

export const revalidate = 3600;

function tcgdexNumber(value?: string) {
  if (!value) return undefined;
  const first = value.trim().split("/")[0]?.trim();
  return first || undefined;
}

function normalizeName(value?: string) {
  return (value ?? "")
    .replace(/\s*-\s*\d+\s*\/\s*\d+\s*$/i, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function languageFromQuery(value: string | null): CardLanguage {
  if (value === "Japanese") return "Japanese";
  if (value === "Chinese") return "Chinese";
  if (value === "Chinese Simplified") return "Chinese Simplified";
  return "English";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim() || undefined;
  const number = searchParams.get("number")?.trim() || undefined;
  const setCode = searchParams.get("set")?.trim() || undefined;
  const game = searchParams.get("game") === "riftbound" ? "riftbound" : "pokemon";
  const language = languageFromQuery(searchParams.get("language"));

  if (!name && !number && !setCode) {
    return NextResponse.json({ results: [] });
  }

  if (game === "riftbound") {
    const results = await searchRiftbound(name, number, language);
    return NextResponse.json({ results });
  }

  // Printed Japanese set codes disambiguate otherwise identical collector numbers.
  // Keep OCR unchanged: this also works when the user types the number manually.
  if (language === "Japanese" && (number || setCode)) {
    try {
      const matches = await searchJapaneseCards(name, number, setCode);
      return NextResponse.json(matches);
    } catch {
      return NextResponse.json(
        { error: "Japanese card catalogue is temporarily unavailable. Please retry." },
        { status: 502 }
      );
    }
  }

  if ((language === "Chinese" || language === "Chinese Simplified") && (number || setCode)) {
    try {
      return NextResponse.json(await searchChineseCards(name, number, setCode, language));
    } catch {
      return NextResponse.json({ error: "Chinese card catalogue temporarily unavailable. Please retry or save the unlisted printing." }, { status: 502 });
    }
  }

  const params = new URLSearchParams();
  if (name) params.set("name", name);
  const dexNumber = tcgdexNumber(number);
  if (dexNumber) params.set("localId", dexNumber);
  params.set("pagination:page", "1");
  params.set("pagination:itemsPerPage", "40");

  const recentPromise =
    language === "English"
      ? searchRecentTcgCsv(name, number)
      : Promise.resolve([]);

  const [dexResponse, recentResults] = await Promise.all([
    fetch(`${tcgdexBase(language)}/cards?${params.toString()}`, {
      next: { revalidate: 3600 },
    }).catch(() => null),
    recentPromise.catch(() => []),
  ]);

  const upstream = dexResponse?.ok
    ? await dexResponse.json().catch(() => [])
    : [];
  const rawDexResults: Record<string, unknown>[] = Array.isArray(upstream) ? upstream : [];
  const dexResults = rawDexResults
    .filter((card): card is Record<string, unknown> & { id: string; name: string } =>
      typeof card.id === "string" && typeof card.name === "string"
    )
    .map((card) => {
    const cardId = typeof card.id === "string" ? card.id : "";
    const rawSet = card.set as { id?: string; name?: string } | undefined;
    const derivedSetId =
      rawSet?.id ||
      (cardId.includes("-") ? cardId.split("-").slice(0, -1).join("-") : undefined);

    return {
      ...card,
      setId: derivedSetId,
      setName: rawSet?.name,
      game: "pokemon",
      language,
    };
  });

  const recentNames = new Set(recentResults.map((card) => normalizeName(card.name)));

  const filteredDexResults = dexResults.filter((card: { id?: string; name?: string }) => {
    const isRecentDex = card.id?.startsWith("30th-") || card.id?.startsWith("30th-c-");
    return !(isRecentDex && recentNames.has(normalizeName(card.name)));
  });

  const seen = new Set<string>();
  const results = [...recentResults, ...filteredDexResults].filter((card) => {
    if (!card?.id || seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });

  if (!dexResponse?.ok && !recentResults.length) {
    return NextResponse.json(
      { error: "Unable to search the Pokémon card catalogue." },
      { status: 502 }
    );
  }

  return NextResponse.json({ results });
}
