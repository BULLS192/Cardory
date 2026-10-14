import { NextRequest, NextResponse } from "next/server";
import {
  asCatalogLanguage,
  getCatalogResource,
  normaliseSetDetail,
  validCatalogueId,
} from "@/lib/catalogue";

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

  try {
    const response = await getCatalogResource(language, `sets/${id}`);
    if (response.status === 404) {
      return NextResponse.json(
        { error: "This set is not available in the chosen language." },
        { status: 404 }
      );
    }
    if (!response.ok) {
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
    return NextResponse.json(
      { error: "Could not load the cards in this set." },
      { status: 502 }
    );
  }
}
