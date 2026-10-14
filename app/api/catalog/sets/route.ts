import { NextRequest, NextResponse } from "next/server";
import { asCatalogLanguage, getCatalogResource, normaliseSet } from "@/lib/catalogue";

export async function GET(request: NextRequest) {
  const language = asCatalogLanguage(
    new URL(request.url).searchParams.get("language") ?? "en"
  );
  if (!language) {
    return NextResponse.json({ error: "Unsupported catalogue language." }, { status: 400 });
  }

  try {
    const response = await getCatalogResource(language, "sets");
    if (!response.ok) {
      return NextResponse.json(
        { error: "TCGdex catalogue is temporarily unavailable." },
        { status: 502 }
      );
    }
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) throw new Error("Unexpected set index payload");
    const sets = raw.map(normaliseSet).filter((set) => set !== null);
    return NextResponse.json({ source: "TCGdex", language, sets });
  } catch {
    return NextResponse.json(
      { error: "Could not load the Pokémon set catalogue." },
      { status: 502 }
    );
  }
}
