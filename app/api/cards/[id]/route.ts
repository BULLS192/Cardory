import { NextResponse } from "next/server";
import { TCGDEX_BASE } from "@/lib/tcgdex";
import { enrichRecentCardWithTcgCsv, getTcgCsvCard } from "@/lib/tcgcsv";
import { TcgDexCard } from "@/lib/types";

export const revalidate = 21600;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (id.startsWith("tcgcsv-")) {
    const card = await getTcgCsvCard(id);
    if (!card) {
      return NextResponse.json(
        { error: "Card not found in TCGCSV." },
        { status: 404 }
      );
    }
    return NextResponse.json(card);
  }

  const response = await fetch(`${TCGDEX_BASE}/cards/${encodeURIComponent(id)}`, {
    next: { revalidate: 21600 },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "Card not found in TCGdex." },
      { status: response.status }
    );
  }

  const card = (await response.json()) as TcgDexCard;
  const enriched = await enrichRecentCardWithTcgCsv(card);
  return NextResponse.json(enriched);
}
