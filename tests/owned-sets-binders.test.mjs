import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function readModule(path) {
  const src = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, () => {
    throw new Error("Unexpected runtime import");
  });
  return exports;
}

const { mergeSetsWithOwned } = readModule("../lib/owned-set-fallbacks.ts");
const { newBinder, replaceBinderCards, validateBinder } = readModule("../lib/binder-helpers.ts");

test("recognize a main 30th set and separate Classic Collection even without source checklists", () => {
  const cards = [
    { game: "pokemon", language: "English", tcgdexId: "tcgcsv-24722-716466",
      setId: "tcgplayer-24722", setName: "30th Celebration" },
    { game: "pokemon", language: "English", tcgdexId: "tcgcsv-24837-716210",
      setId: "tcgplayer-24837", setName: "30th Celebration Classic Collection" },
  ];
  const result = mergeSetsWithOwned([], cards, "en");
  assert.equal(result.sets.length, 2);
  assert.equal(result.sets[0].name, "30th Celebration");
  assert.equal(result.sets[0].cardCount.total, 0);
  assert.equal(result.missingChecklists.length, 2);
  const indexed = [{ id: "tcgplayer-24722", name: "30th Celebration",
    cardCount: { official: 0, total: 128 } }];
  const updated = mergeSetsWithOwned(indexed, cards, "en");
  assert.equal(updated.sets.length, 2);
  assert.equal(updated.sets[0].cardCount.total, 128);
  assert.deepEqual(updated.missingChecklists, ["tcgplayer-24837"]);
  assert.deepEqual(mergeSetsWithOwned([], cards, "ja").sets, []);
});

test("manual binder is creatable with zero cards, then editable without changing owned cards", () => {
  const input = { name: " 30th Celebration ", description: "",
    kind: "manual", cardIds: [], field: "tag", operator: "contains", value: "" };
  assert.equal(validateBinder(input), null);
  const binder = newBinder(input, "binder-1", "2026-10-15T00:00:00.000Z");
  assert.equal(binder.name, "30th Celebration");
  assert.deepEqual(binder.cardIds, []);
  const cards = ["owned-A", "owned-B"];
  const modified = replaceBinderCards([binder], "binder-1", [...cards, cards[0]]);
  assert.deepEqual(modified[0].cardIds, cards);
  assert.deepEqual(binder.cardIds, []);
});

test("binder names and smart rules must be meaningful", () => {
  const input = { name: "", description: "", kind: "manual", cardIds: [],
    field: "tag", operator: "contains", value: "" };
  assert.match(validateBinder(input), /name/);
  assert.match(validateBinder({ ...input, name: "Smart", kind: "smart" }), /rule/);
  assert.equal(validateBinder({ ...input, name: "Smart", kind: "smart", value: "30th" }), null);
  assert.match(validateBinder({ ...input, name: "Smart", kind: "smart",
    field: "marketPrice", operator: "gte", value: "nope" }), /market/);
});
