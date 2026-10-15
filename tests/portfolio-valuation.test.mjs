import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function readModule(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", js)(exports, () => { throw Error("Unexpected runtime import"); });
  return exports;
}
const { calculatePortfolioValue, formatPortfolioAmounts, portfolioIdentity, groupOwnedSets } =
  readModule("../lib/portfolio.ts");
const { replaceBinderDetails, validateBinderUpdate } = readModule("../lib/binder-helpers.ts");

const cards = [
  { id: "one", tcgdexId: "sv-050", game: "pokemon", language: "English",
    variant: "normal", quantity: 2, marketPrice: 10, marketCurrency: "USD",
    priceUpdatedAt: "2026-01-01", setId: "sv", setName: "English Set" },
  { id: "two", tcgdexId: "sv-050", game: "pokemon", language: "English",
    variant: "normal", quantity: 1, marketPrice: 12, marketCurrency: "USD",
    priceUpdatedAt: "2026-04-01", setId: "sv", setName: "English Set" },
  { id: "three", tcgdexId: "ja-002", game: "pokemon", language: "Japanese",
    variant: "foil", quantity: 3, marketPrice: 100, marketCurrency: "JPY",
    setId: "sv", setName: "日本語" },
  { id: "four", tcgdexId: "sv-050", game: "pokemon", language: "Chinese",
    variant: "normal", quantity: 1, marketPrice: 5, marketCurrency: "USD",
    setId: "sv", setName: "繁體" },
  { id: "five", tcgdexId: "sv-060", game: "pokemon", language: "English",
    variant: "normal", quantity: 2, marketPrice: null, marketCurrency: "USD",
    setId: "sv", setName: "English Set" },
];

test("include duplicates uses copies and avoids silent currency conversion", () => {
  const result = calculatePortfolioValue(cards, "copies");
  assert.equal(result.copies, 9);
  assert.equal(result.unique, 4);
  assert.equal(result.duplicates, 5);
  assert.equal(result.counted, 9);
  assert.equal(result.amounts.USD, 37);
  assert.equal(result.amounts.JPY, 300);
  assert.equal(result.unpriced, 2);
  assert.match(formatPortfolioAmounts(result.amounts), /JPY/);
  assert.match(formatPortfolioAmounts(result.amounts), /USD/);
});

test("exclude duplicates values one priced representative by exact variant/language/ID", () => {
  const result = calculatePortfolioValue(cards, "unique");
  assert.equal(result.counted, 4);
  assert.equal(result.amounts.USD, 17);
  assert.equal(result.amounts.JPY, 100);
  assert.equal(result.unpriced, 1);
  assert.notEqual(portfolioIdentity(cards[0]), portfolioIdentity(cards[3]));
  assert.equal(portfolioIdentity(cards[0]), portfolioIdentity(cards[1]));
  assert.notEqual(portfolioIdentity(cards[0]), portfolioIdentity({ ...cards[0], variant: "holofoil" }));
});

test("unpriced cards cannot inflate value or become valued at zero; zero quantity ignored", () => {
  assert.deepEqual(calculatePortfolioValue([{ ...cards[4], quantity: 0 }]).amounts, {});
  assert.equal(calculatePortfolioValue([cards[4]], "copies").unpriced, 2);
  assert.equal(calculatePortfolioValue([cards[4]], "unique").unpriced, 1);
  assert.equal(formatPortfolioAmounts({}), "—");
});

test("sets separate localized editions; rows of the same set combine", () => {
  const grouped = groupOwnedSets(cards);
  assert.equal(grouped.length, 3);
  const english = grouped.find((group) => group.language === "English");
  assert.equal(english.cards.length, 3);
  assert.equal(calculatePortfolioValue(english.cards, "copies").amounts.USD, 32);
});

test("binder rename, description, rule edits preserve immutable identity and membership", () => {
  const manual = { id: "binder-001", name: "Before", description: "", kind: "manual",
    cardIds: ["one", "two"], rules: [], match: "all", createdAt: "2026-10-01" };
  const unrelated = { ...manual, id: "binder-002", name: "Other" };
  const changes = { name: " After ", description: "Updated binder", rules: [], match: "any" };
  const updated = replaceBinderDetails([manual, unrelated], "binder-001", changes);
  assert.equal(updated[0].name, "After");
  assert.equal(updated[0].description, "Updated binder");
  assert.deepEqual(updated[0].cardIds, ["one", "two"]);
  assert.equal(updated[0].createdAt, manual.createdAt);
  assert.equal(updated[0].match, "all");
  assert.strictEqual(updated[1], unrelated);
  assert.deepEqual(manual.cardIds, ["one", "two"]);
});

test("smart binder can edit multiple rules, while invalid smart edits are rejected", () => {
  const smart = { id: "smart1", name: "Smart", kind: "smart", cardIds: [],
    rules: [{ field: "tag", operator: "contains", value: "pikachu" }],
    match: "all", createdAt: "2026-10-01" };
  const change = { name: "Smart updated", description: "Now two rules", match: "any",
    rules: [
      { field: "tag", operator: "contains", value: "rare" },
      { field: "marketPrice", operator: "gte", value: "50" },
    ] };
  assert.equal(validateBinderUpdate(smart, change), null);
  const updated = replaceBinderDetails([smart], smart.id, change)[0];
  assert.equal(updated.rules.length, 2);
  assert.equal(updated.match, "any");
  assert.equal(updated.id, smart.id);
  assert.match(validateBinderUpdate(smart, { ...change, rules: [] }), /at least one/);
  assert.match(validateBinderUpdate(smart, { ...change,
    rules: [{ field: "marketPrice", operator: "contains", value: "50" }] }), /comparison/);
});
