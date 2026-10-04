import { NextRequest, NextResponse } from "next/server";
import { TCGDEX_BASE } from "@/lib/tcgdex";
import { searchRecentTcgCsv } from "@/lib/tcgcsv";

export const revalidate = 3600;

function tcgdexNumber(value?: string) {
  if (!value) return undefined;
  const first = value.trim().split("/")[0]?.trim();
  return first || undefined;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim() || undefined;
  const number = searchParams.get("number")?.trim() || undefined;

  if (!name && !number) {
    return NextResponse.json({ results: [] });
  }

  const params = new URLSearchParams();
  if (name) params.set("name", name);
  const dexNumber = tcgdexNumber(number);
  if (dexNumber) params.set("localId", dexNumber);
  params.set("pagination:page", "1");
  params.set("pagination:itemsPerPage", "40");

  const [dexResponse, recentResults] = await Promise.all([
    fetch(`${TCGDEX_BASE}/cards?${params.toString()}`, {
      next: { revalidate: 3600 },
    }),
    searchRecentTcgCsv(name, number),
  ]);

  const dexResults = dexResponse.ok ? await dexResponse.json() : [];

  // Prefer exact/new TCGCSV matches first, then append TCGdex results.
  // De-dupe by provider id so cards from different printings remain distinct.
  const seen = new Set<string>();
  const results = [...recentResults, ...dexResults].filter((card) => {
    if (!card?.id || seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });

  if (!dexResponse.ok && !recentResults.length) {
    return NextResponse.json(
      { error: "Unable to search the Pokémon card catalogue." },
      { status: dexResponse.status }
    );
  }

  return NextResponse.json({ results });
}
