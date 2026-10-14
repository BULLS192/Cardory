#!/usr/bin/env node
/**
 * Cardory Pokémon catalogue snapshot (metadata only).
 *
 * Usage:
 *   node scripts/import-pokemon-catalogue.mjs
 *   node scripts/import-pokemon-catalogue.mjs --languages=en,ja
 *
 * Writes data/pokemon/catalogue-<language>.json and summary.json.
 * No API keys, DB writes, card image downloads or production changes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SUPPORTED = new Set(["en", "ja", "zh-tw"]);
const option = process.argv.find((arg) => arg.startsWith("--languages="));
const languages = option
  ? option.slice("--languages=".length).split(",").map((v) => v.trim())
  : ["en", "ja", "zh-tw"];

if (!languages.length || languages.some((v) => !SUPPORTED.has(v))) {
  console.error("Allowed languages: en, ja, zh-tw");
  process.exit(1);
}

const root = "https://api.tcgdex.net/v2";
const destination = resolve(process.cwd(), "data/pokemon");

async function getJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Cardory-Catalogue/1.0" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("HTTP " + response.status + ": " + url);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Expected a JSON array: " + url);
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((r) => setTimeout(r, (attempt + 1) * 1000));
    }
  }
  throw lastError;
}

function safeAsset(value) {
  if (typeof value !== "string" || !value.startsWith("https://assets.tcgdex.net/")) return null;
  return value;
}

function extractSetId(cardId) {
  const separator = cardId.lastIndexOf("-");
  return separator < 1 ? null : cardId.slice(0, separator);
}

async function run() {
  await mkdir(destination, { recursive: true });
  const summary = { source: "TCGdex", generatedAt: new Date().toISOString(), languages: {} };

  for (const language of languages) {
    const [rawSets, rawCards] = await Promise.all([
      getJson(root + "/" + language + "/sets"),
      getJson(root + "/" + language + "/cards"),
    ]);

    const sets = rawSets
      .filter((set) => set && typeof set.id === "string" && typeof set.name === "string")
      .map((set) => ({
        id: set.id,
        name: set.name,
        cardCount: {
          official: Number(set.cardCount?.official) || 0,
          total: Number(set.cardCount?.total) || 0,
        },
        logo: safeAsset(set.logo),
        symbol: safeAsset(set.symbol),
      }));
    const setIds = new Set(sets.map((set) => set.id));
    const seen = new Set();
    const cards = rawCards
      .filter((card) => {
        if (!card || typeof card.id !== "string" || typeof card.name !== "string") return false;
        if (seen.has(card.id)) return false;
        seen.add(card.id);
        return true;
      })
      .map((card) => ({
        id: card.id,
        localId: String(card.localId ?? ""),
        name: card.name,
        setId: extractSetId(card.id),
        image: safeAsset(card.image),
      }));

    const orphanCards = cards.filter((card) => !setIds.has(card.setId)).length;
    const missingArtwork = cards.filter((card) => !card.image).length;
    const file = "catalogue-" + language + ".json";
    await writeFile(resolve(destination, file), JSON.stringify({
      source: "TCGdex",
      sourceEndpoint: root + "/" + language,
      generatedAt: summary.generatedAt,
      language,
      sets,
      cards,
    }, null, 2) + "\n");

    summary.languages[language] = {
      sets: sets.length,
      cards: cards.length,
      missingArtwork,
      orphanCards,
      file,
    };
    console.log(language + ": " + sets.length + " sets, " + cards.length +
      " cards, " + missingArtwork + " missing artwork references, " +
      orphanCards + " cards without matching set");
  }
  await writeFile(resolve(destination, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log("Catalogue snapshots saved to " + destination);
}

run().catch((error) => {
  console.error("Catalogue import failed:", error);
  process.exitCode = 1;
});
