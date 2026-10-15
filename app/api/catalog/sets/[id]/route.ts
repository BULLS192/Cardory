import { NextRequest, NextResponse } from "next/server";
import {
  asCatalogLanguage,
  getCatalogResource,
  normaliseSetDetail,
  validCatalogueId,
} from "@/lib/catalogue";
import { getIndexedSetDetail } from "@/lib/catalogue-store";
import { getSupplementalTcgCsvSet } from "@/lib/tcgcsv";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const language = asCatalogLanguage(
    new URL(request.url).searchParams.get("language") ?? "en"
  );
  const { id } = await context.params;
  if (!language || !validCatalogueId(id)) {
    return NextResponse.json({ error: "Invalid set or language." }, { status: 400 });
  }

  if (id.startsWith("tcgplayer-")) {
    if (language !== "en") {
      return NextResponse.json({ error: "This source currently supports English only." }, { status: 404 });
    }
    const supplemental = await getSupplementalTcgCsvSet(id);
    if (!supplemental) {
      return NextResponse.json({ error: "TCGCSV set is unavailable or unknown." }, { status: 404 });
    }
    return NextResponse.json({ source: "TCGplayer via TCGCSV", language, set: supplemental });
  }

  const indexed = await getIndexedSetDetail(language, id);
  // An indexed set without artwork links should still render artwork from the
  // provider while online; use our complete metadata as an outage fallback.
  if (indexed?.cards.every((card) => Boolean(card.image))) {
    return NextResponse.json({ source: "Cardory index (TCGdex)", language, set: indexed });
  }

  try {
    const response = await getCatalogResource(language, `sets/${id}`);
    if (response.status === 404) {
      if (indexed) return NextResponse.json({ source: "Cardory offline index", language, set: indexed });
      return NextResponse.json(
        { error: "This set is not available in the chosen language." },
        { status: 404 }
      );
    }
    if (!response.ok) {
      if (indexed) return NextResponse.json({ source: "Cardory offline index", language, set: indexed });
      return NextResponse.json(
        { error: "TCGdex catalogue is temporarily unavailable." },
        { status: 502 }
      );
    }
    const raw: unknown = await response.json();
    const set = normaliseSetDetail(raw);
    if (!set) throw new Error("Unexpected set payload");
    return NextResponse.json({ source: "TCGdex", language, set });
  } catch {
    if (indexed) return NextResponse.json({ source: "Cardory offline index", language, set: indexed });
    return NextResponse.json(
      { error: "Could not load the cards in this set." },
      { status: 502 }
    );
  }
}
