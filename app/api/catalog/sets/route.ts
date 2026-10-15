import { NextRequest, NextResponse } from "next/server";
import { asCatalogLanguage, getCatalogResource, normaliseSet } from "@/lib/catalogue";
import { getIndexedSets } from "@/lib/catalogue-store";
import { getSupplementalTcgCsvSets } from "@/lib/tcgcsv";

export async function GET(request: NextRequest) {
  const language = asCatalogLanguage(
    new URL(request.url).searchParams.get("language") ?? "en"
  );
  if (!language) {
    return NextResponse.json({ error: "Unsupported catalogue language." }, { status: 400 });
  }

  // Keep recently released sets discoverable even if they have not yet been
  // imported into Cardory's database. If TCGdex goes down, indexed sets remain.
  const [cachedResult, upstreamResult, supplementalResult] = await Promise.allSettled([
    getIndexedSets(language),
    getCatalogResource(language, "sets"),
    language === "en" ? getSupplementalTcgCsvSets() : Promise.resolve([]),
  ]);
  const indexed = cachedResult.status === "fulfilled" ? cachedResult.value : [];
  let upstream: ReturnType<typeof normaliseSet>[] = [];
  if (upstreamResult.status === "fulfilled" && upstreamResult.value.ok) {
    try {
      const raw: unknown = await upstreamResult.value.json();
      if (Array.isArray(raw)) upstream = raw.map(normaliseSet);
    } catch {
      // Cached catalogue remains available during a malformed upstream response.
    }
  }

  const supplemental = supplementalResult.status === "fulfilled" ? supplementalResult.value : [];
  const merged = new Map(indexed.map((set) => [set.id, set]));
  // Prefer the live source for set headers; imported cards remain cached locally.
  for (const set of upstream) if (set) merged.set(set.id, set);
  // Keep supplemental source IDs distinct: MEE-012 (anniversary) must not
  // be conflated with a similarly numbered standard energy printing.
  for (const set of supplemental) merged.set(set.id, set);
  if (!merged.size && (upstreamResult.status !== "fulfilled" || !upstreamResult.value.ok)) {
    return NextResponse.json({ error: "Catalogue is currently unavailable." }, { status: 502 });
  }

  return NextResponse.json({
    source: supplemental.length ? "TCGdex + TCGCSV" : indexed.length ? "Cardory + TCGdex" : "TCGdex",
    indexedSets: indexed.length,
    supplementalSets: supplemental.length,
    language,
    sets: [...merged.values()],
  });
}
