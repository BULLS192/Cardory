import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Load the real TypeScript module without a Next.js runtime. Mock only the
// upstream HTTP transport so provider identity and number matching are tested.
const source = readFileSync(new URL("../lib/tcgcsv.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", "require", compiled)(exports, () => {
  throw new Error("Unexpected runtime dependency in tcgcsv.ts");
});

test("anniversary energy 012 is discoverable in its own MEE group", async () => {
  const saved = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const group = /\/3\/(\d+)\/(products|prices)$/.exec(String(url));
    if (!group) throw new Error("Unexpected URL " + url);
    const [_, id, resource] = group;
    const results = resource === "prices" ? [] : id === "24461"
      ? [
          { productId: 713251, name: "Basic Lightning Energy - 012 (30th Celebration)",
            imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/713251_200w.jpg",
            extendedData: [{ name: "Number", value: "012" },
              { name: "Rarity", value: "Futuristic Rare" }] },
          { productId: 712000, name: "Basic Lightning Energy - 004",
            extendedData: [{ name: "Number", value: "004" }] },
          { productId: 8, name: "30th Celebration Booster Pack" },
        ]
      : [];
    return { ok: true, json: async () => ({ success: true, results }) };
  };
  try {
    const sets = await exports.getSupplementalTcgCsvSets();
    const mee = sets.find((set) => set.id === "tcgplayer-24461");
    assert.ok(mee);
    assert.equal(mee.cardCount.total, 2);
    const detail = await exports.getSupplementalTcgCsvSet(mee.id);
    assert.equal(detail.cards.length, 2);
    const energy = detail.cards.find((card) => card.localId === "012");
    assert.equal(energy.id, "tcgcsv-24461-713251");
    const matches = await exports.searchRecentTcgCsv("Basic Lightning Energy", "012");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, energy.id);
    const info = await exports.getTcgCsvCard(energy.id);
    assert.equal(info.localId, "012");
    assert.equal(info.category, "Energy");
    assert.equal(info.hp, null);
    assert.equal(info.variants.holo, true);
    assert.equal(info.set.id, "tcgplayer-24461");
    assert.ok(requests.some((url) => url.endsWith("/24461/products")));
  } finally {
    globalThis.fetch = saved;
  }
});
