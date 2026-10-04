import { NextResponse } from "next/server";
import { TCGDEX_BASE } from "@/lib/tcgdex";

export const revalidate = 21600;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const response = await fetch(`${TCGDEX_BASE}/cards/${encodeURIComponent(id)}`, {
    next: { revalidate: 21600 },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "Card not found in TCGdex." },
      { status: response.status }
    );
  }

  const card = await response.json();
  return NextResponse.json(card);
}
