import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/japanese-card-search.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const japanese = {};
new Function("exports", "require", compiled)(japanese, () => {
  throw new Error("Unexpected runtime import from Japanese search");
});
const { parseJapaneseCardQuery, searchJapaneseCards, isJapaneseCardNumberMatch } = japanese;

test("parse Japanese printed codes and full-width numbers without OCR", () => {
  assert.deepEqual(parseJapaneseCardQuery("SV5a 051/066"), {
    setId: "sv5a", collectorNumber: "051", printedTotal: 66,
  });
  assert.deepEqual(parseJapaneseCardQuery("Ｍ１Ｓ ００１／０６３"), {
    setId: "m1s", collectorNumber: "001", printedTotal: 63,
  });
  assert.deepEqual(parseJapaneseCardQuery("051/066 SV5a"), {
    setId: "sv5a", collectorNumber: "051", printedTotal: 66,
  });
  assert.deepEqual(parseJapaneseCardQuery("051/066", "SV5a"), {
    setId: "sv5a", collectorNumber: "051", printedTotal: 66,
  });
  assert.deepEqual(parseJapaneseCardQuery("327/S-P"), {
    setId: "s-p", collectorNumber: "327", printedTotal: null,
  });
  assert.ok(isJapaneseCardNumberMatch("051", "51"));
  assert.equal(isJapaneseCardNumberMatch("051", "052"), false);
});

test("Japanese lookup resolves the exact set and number rather than arbitrary first 40 results", async () => {
  const oldFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    assert.equal(url, "https://api.tcgdex.net/v2/ja/sets/sv5a");
    return { ok: true, json: async () => ({
      id: "sv5a", name: "クリムゾンヘイズ", cardCount: { official: 66, total: 80 },
      cards: [
        { id: "sv5a-050", localId: "050", name: "イーブイ" },
        { id: "sv5a-051", localId: "051", name: "カビゴン",
          image: "https://assets.tcgdex.net/ja/sv/sv5a/051" },
      ],
    }) };
  };
  try {
    const found = await searchJapaneseCards("Snorlax", "051/066", "SV5a");
    assert.equal(found.count, 1);
    assert.equal(found.results[0].id, "sv5a-051");
    assert.equal(found.results[0].setId, "sv5a");
    assert.equal(found.results[0].setName, "クリムゾンヘイズ");
    assert.equal(found.results[0].language, "Japanese");
    assert.equal(urls.length, 1);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("a bare printed number shows competing Japanese printings and prioritizes matching set totals", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const address = new URL(String(url));
    if (address.pathname.endsWith("/sets")) return { ok: true, json: async () => [
      { id: "sv5a", name: "Set 66", cardCount: { official: 66 } },
      { id: "sv3", name: "Set 108", cardCount: { official: 108 } },
    ] };
    assert.equal(address.searchParams.get("localId"), "eq:051");
    return { ok: true, json: async () => [
      { id: "sv3-051", name: "ポケモンA", localId: "051" },
      { id: "sv5a-051", name: "カビゴン", localId: "051" },
      { id: "sv5a-052", name: "Different card", localId: "052" },
    ] };
  };
  try {
    const result = await searchJapaneseCards(undefined, "051/066");
    assert.equal(result.count, 2);
    assert.equal(result.results[0].setId, "sv5a");
    assert.equal(result.results[1].setId, "sv3");
    assert.match(result.notice, /set code/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("reject invalid collector inputs without fetching or inventing an identity", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Should not fetch"); };
  try {
    const result = await searchJapaneseCards(undefined, "banana", "../evil");
    assert.equal(result.count, 0);
    assert.match(result.notice, /number|code/i);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("missing source set returns guidance, not a false English printing", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  try {
    const result = await searchJapaneseCards(undefined, "051", "SV5a");
    assert.deepEqual(result.results, []);
    assert.match(result.notice, /not available/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
