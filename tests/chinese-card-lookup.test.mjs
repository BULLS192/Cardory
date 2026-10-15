import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function tsModule(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const content = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exported = {};
  new Function("exports", "require", content)(exported, () => { throw Error("Unexpected runtime require"); });
  return exported;
}
const { parseChineseNumber, equalChineseNumber, searchChineseCards,
  makeUnlistedChineseIdentity } = tsModule("../lib/chinese-card-search.ts");
const { extractChineseCollectorNumber } = tsModule("../lib/chinese-collector-ocr.ts");

test("printed Simplified and Traditional set codes stay distinct", () => {
  assert.deepEqual(parseChineseNumber("CSV9C 023/190"), {
    setCode: "CSV9C", collectorNumber: "023", printedTotal: 190,
  });
  assert.deepEqual(parseChineseNumber("ＣＢＢ４Ｃ ００５／０２０"), {
    setCode: "CBB4C", collectorNumber: "005", printedTotal: 20,
  });
  assert.deepEqual(parseChineseNumber("151C 001/165"), {
    setCode: "151C", collectorNumber: "001", printedTotal: 165,
  });
  assert.deepEqual(parseChineseNumber("023/190", "cs5.5c"), {
    setCode: "CS5.5C", collectorNumber: "023", printedTotal: 190,
  });
  assert.equal(equalChineseNumber("023", "23"), true);
});

test("OCR identifies Chinese set code next to number but rejects standalone HP/year", () => {
  assert.equal(extractChineseCollectorNumber("HP 170\nCSV9C 023/190\n©2026"), "CSV9C 023/190");
  assert.equal(extractChineseCollectorNumber("CBB4C 005／020"), "CBB4C 005/020");
  assert.equal(extractChineseCollectorNumber("寶可夢 皮卡丘 HP 70 2026"), "");
  assert.equal(extractChineseCollectorNumber("卡牌 015/020"), "015/020");
});

test("Chinese locale and printed set are used in scoped lookups", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, "https://api.tcgdex.net/v2/zh-tw/sets/abc2c");
    return { status: 200, ok: true, json: async () => ({
      id: "abc2c", name: "特別系列",
      cards: [
        { id: "abc2c-023", localId: "023", name: "皮卡丘" },
        { id: "abc2c-024", localId: "024", name: "另一張" },
      ],
    }) };
  };
  try {
    const found = await searchChineseCards("", "023/190", "ABC2C", "Chinese");
    assert.equal(found.count, 1);
    assert.equal(found.results[0].language, "Chinese");
    assert.equal(found.results[0].setName, "特別系列");
  } finally { globalThis.fetch = old; }
});

test("if Chinese printing not in TCGdex, do not invent a translated card", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, "https://api.tcgdex.net/v2/zh-cn/sets/cbb4c");
    return { status: 404, ok: false };
  };
  try {
    const found = await searchChineseCards("", "005/020", "CBB4C", "Chinese Simplified");
    assert.equal(found.count, 0);
    assert.match(found.notice, /not indexed/);
  } finally { globalThis.fetch = old; }
});

test("unlisted Chinese cards use stable, provider-qualified IDs and no fake image or market price", () => {
  const simplified = makeUnlistedChineseIdentity("Chinese Simplified", "005/020", "CBB4C", "皮卡丘");
  const traditional = makeUnlistedChineseIdentity("Chinese", "005/020", "CBB4C", "皮卡丘");
  assert.equal(simplified.id, "cardory-custom-zh-cn-cbb4c-005");
  assert.equal(traditional.id, "cardory-custom-zh-tw-cbb4c-005");
  assert.notEqual(simplified.id, traditional.id);
  assert.equal(simplified.image, null);
  assert.equal(simplified.marketCurrency, null);
  assert.equal(simplified.set.name, "CBB4C");
  assert.throws(() => makeUnlistedChineseIdentity("Chinese Simplified", "005/020", "", ""), /actual printed/);
});
