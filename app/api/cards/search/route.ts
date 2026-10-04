import { NextRequest, NextResponse } from "next/server";
import { TCGDEX_BASE } from "@/lib/tcgdex";

export const revalidate = 3600;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim();
  const number = searchParams.get("number")?.trim();

  if (!name && !number) {
    return NextResponse.json({ results: [] });
  }

  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (number) params.set("localId", number);
  params.set("pagination:page", "1");
  params.set("pagination:itemsPerPage", "40");

  const response = await fetch(`${TCGDEX_BASE}/cards?${params.toString()}`, {
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "Unable to search the Pokémon card catalogue." },
      { status: response.status }
    );
  }

  const results = await response.json();
  return NextResponse.json({ results });
}
