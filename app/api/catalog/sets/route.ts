import { NextRequest, NextResponse } from "next/server";
import { asCatalogLanguage, getCatalogResource, normaliseSet } from "@/lib/catalogue";
import { getIndexedSets } from "@/lib/catalogue-store";

export async function GET(request: NextRequest) {
  const language = asCatalogLanguage(
    new URL(request.url).searchParams.get("language") ?? "en"
  );
  if (!language) {
    return NextResponse.json({ error: "Unsupported catalogue language." }, { status: 400 });
  }

  // Keep recently released sets discoverable even if they have not yet been
  // imported into Cardory's database. If TCGdex goes down, indexed sets remain.
  const [cachedResult, upstreamResult] = await Promise.allSettled([
    getIndexedSets(language),
    getCatalogResource(language, "sets"),
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

  const merged = new Map(indexed.map((set) => [set.id, set]));
  // Prefer the live source for set headers; imported cards remain cached locally.
  for (const set of upstream) if (set) merged.set(set.id, set);
  if (!merged.size && upstreamResult.status !== "fulfilled") {
    return NextResponse.json({ error: "Catalogue is currently unavailable." }, { status: 502 });
  }
  if (!merged.size && (!upstreamResult.value?.ok)) {
    return NextResponse.json({ error: "Catalogue is currently unavailable." }, { status: 502 });
  }

  return NextResponse.json({
    source: indexed.length ? "Cardory + TCGdex" : "TCGdex",
    indexedSets: indexed.length,
    language,
    sets: [...merged.values()],
  });
}
