import { NextResponse } from "next/server";
import { tcgdexBase } from "@/lib/tcgdex";
import { enrichRecentCardWithTcgCsv, getTcgCsvCard } from "@/lib/tcgcsv";
import { getRiftboundCard } from "@/lib/riftbound";
import { CardLanguage, TcgDexCard } from "@/lib/types";

export const revalidate = 21600;

function languageFromUrl(request: Request): CardLanguage {
  const value = new URL(request.url).searchParams.get("language");
  if (value === "Japanese") return "Japanese";
  if (value === "Chinese") return "Chinese";
  return "English";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const language = languageFromUrl(request);

  if (id.startsWith("riftcsv-")) {
    const card = await getRiftboundCard(id, language);
    if (!card) {
      return NextResponse.json(
        { error: "Riftbound card not found in TCGCSV." },
        { status: 404 }
      );
    }
    return NextResponse.json(card);
  }

  if (id.startsWith("tcgcsv-")) {
    const card = await getTcgCsvCard(id);
    if (!card) {
      return NextResponse.json(
        { error: "Card not found in TCGCSV." },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ...card,
      game: "pokemon",
      language: "English",
      marketCurrency: "USD",
    });
  }

  const response = await fetch(
    `${tcgdexBase(language)}/cards/${encodeURIComponent(id)}`,
    { next: { revalidate: 21600 } }
  );

  if (!response.ok) {
    return NextResponse.json(
      { error: "Card not found in TCGdex." },
      { status: response.status }
    );
  }

  const card = (await response.json()) as TcgDexCard;
  const enriched =
    language === "English" ? await enrichRecentCardWithTcgCsv(card) : card;

  return NextResponse.json({
    ...enriched,
    game: "pokemon",
    language,
    marketCurrency: enriched.pricing?.tcgplayer?.unit ?? "USD",
  });
}
