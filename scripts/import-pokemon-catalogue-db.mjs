#!/usr/bin/env node
/**
 * Populate Cardory's public Pokémon metadata tables from TCGdex.
 * Does NOT modify collections / owned_cards or download copyrighted images.
 *
 * Defaults to DRY RUN and THREE sets in English:
 *   npm run catalogue:db-import
 *   npm run catalogue:db-import -- --language=en --set=base1
 *
 * Explicit write to the known Cardory Supabase project:
 *   SUPABASE_URL=https://xnmsilokjrnjfdnovaof.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<server-only-value> \
 *   npm run catalogue:db-import -- --language=en --set=base1 --write
 *
 * --all processes every set in the chosen language (can take a long time).
 * --full additionally retrieves the full detail payload for every card.
 * Provider API responses can be incomplete; card and artwork gaps are logged.
 */
import { createClient } from "@supabase/supabase-js";

const ROOT = "https://api.tcgdex.net/v2";
const EXPECTED_PROJECT_REF = "xnmsilokjrnjfdnovaof";
const args = process.argv.slice(2);
const option = (name) => {
  const match = args.find((arg) => arg.startsWith(name + "="));
  return match ? match.substring(name.length + 1) : null;
};

const language = option("--language") || "en";
const setId = option("--set");
const write = args.includes("--write");
const all = args.includes("--all");
const full = args.includes("--full");
const take = Math.max(1, Math.min(100, Number(option("--limit") || 3)));

if (!["en", "ja", "zh-tw"].includes(language) ||
    (setId && !/^[a-zA-Z0-9_-]{1,64}$/.test(setId))) {
  throw new Error("Invalid language or set identifier");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function json(url) {
  let lastError;
  for (let n = 0; n < 3; n++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Cardory-Catalogue/1.0" },
        signal: AbortSignal.timeout(25000),
      });
      if (response.status === 429 || response.status >= 500) {
        throw new Error("Transient upstream HTTP " + response.status);
      }
      if (!response.ok) throw new Error("Upstream HTTP " + response.status + ": " + url);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (n < 2) await wait((n + 1) * 1600);
    }
  }
  throw lastError;
}

function asset(value) {
  return typeof value === "string" && value.startsWith("https://assets.tcgdex.net/")
    ? value : null;
}

function makeSet(raw) {
  return {
    provider: "tcgdex",
    language,
    set_id: raw.id,
    name: raw.name,
    series_id: raw.serie?.id || null,
    series_name: raw.serie?.name || null,
    release_date: raw.releaseDate || null,
    card_count_total: Number(raw.cardCount?.total) || raw.cards?.length || 0,
    card_count_official: Number(raw.cardCount?.official) || 0,
    logo_url: asset(raw.logo),
    symbol_url: asset(raw.symbol),
    source_url: ROOT + "/" + language + "/sets/" + raw.id,
    indexed_at: new Date().toISOString(),
  };
}

function makeCard(card, parentSet, level) {
  return {
    provider: "tcgdex",
    language,
    card_id: card.id,
    set_id: parentSet,
    local_id: String(card.localId ?? ""),
    name: card.name,
    image_url: asset(card.image),
    rarity: card.rarity || null,
    category: card.category || null,
    illustrator: card.illustrator || null,
    hp: Number.isFinite(Number(card.hp)) && card.hp !== undefined && card.hp !== null
      ? Number(card.hp) : null,
    types: Array.isArray(card.types) ? card.types : [],
    metadata: card,
    metadata_level: level,
    source_url: ROOT + "/" + language + "/cards/" + card.id,
    indexed_at: new Date().toISOString(),
  };
}

async function writeChunks(client, table, rows, chunkSize = 100) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await client.from(table).upsert(rows.slice(i, i + chunkSize), {
      onConflict: table === "pokemon_catalog_sets"
        ? "provider,language,set_id" : "provider,language,card_id",
    });
    if (error) throw new Error(table + ": " + error.message);
  }
}

async function main() {
  let client = null;
  if (write) {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !secret) {
      throw new Error("Write mode requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-only)");
    }
    // This project guard prevents accidental writes to Atlas, SGBuddy or TTT-OS.
    if (new URL(url).hostname !== EXPECTED_PROJECT_REF + ".supabase.co") {
      throw new Error("Refusing to write outside the confirmed Cardory Supabase project");
    }
    client = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  const rawSets = await json(ROOT + "/" + language + "/sets");
  if (!Array.isArray(rawSets)) throw new Error("Unexpected upstream set listing");

  let chosen = rawSets.filter((set) =>
    typeof set.id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(set.id)
  );
  if (setId) chosen = chosen.filter((set) => set.id === setId);
  else if (!all) chosen = chosen.slice(0, take);
  if (!chosen.length) throw new Error("No matching sets from TCGdex");

  const report = { language, write, full, sets: 0, cards: 0, imagesMissing: 0, errors: [] };
  console.log((write ? "WRITE" : "DRY RUN") + " · " + language +
    " · " + chosen.length + " sets · full details: " + full);

  for (const listing of chosen) {
    try {
      const detail = await json(ROOT + "/" + language + "/sets/" + listing.id);
      if (!detail || detail.id !== listing.id || !Array.isArray(detail.cards)) {
        throw new Error("Unexpected source set payload");
      }

      const set = makeSet(detail);
      const cards = [];
      const unique = new Set();
      for (const brief of detail.cards) {
        if (!brief || typeof brief.id !== "string" ||
            !/^[a-zA-Z0-9_-]{1,128}$/.test(brief.id) ||
            typeof brief.name !== "string" || unique.has(brief.id)) continue;
        unique.add(brief.id);
        let raw = brief;
        let level = "brief";
        if (full) {
          raw = await json(ROOT + "/" + language + "/cards/" + brief.id);
          if (!raw || raw.id !== brief.id) throw new Error("Unexpected full card detail " + brief.id);
          level = "full";
          await wait(60); // polite pacing when fetching full details
        }
        cards.push(makeCard(raw, listing.id, level));
      }

      if (client) {
        // Set must be inserted before its dependent cards (FK).
        await writeChunks(client, "pokemon_catalog_sets", [set]);
        await writeChunks(client, "pokemon_catalog_cards", cards);
      }
      report.sets += 1;
      report.cards += cards.length;
      report.imagesMissing += cards.filter((card) => !card.image_url).length;
      console.log(listing.id + " — " + cards.length + " cards" +
        (client ? " saved" : " validated") + "; " +
        cards.filter((card) => !card.image_url).length + " without artwork");
    } catch (error) {
      const message = listing.id + ": " + (error instanceof Error ? error.message : String(error));
      console.error(message);
      report.errors.push(message);
    }
    await wait(125);
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
