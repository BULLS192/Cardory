import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import typescript from "typescript";

const source = await readFile(
  new URL("../lib/set-completion.ts", import.meta.url), "utf8"
);
const js = typescript.transpileModule(source, {
  compilerOptions: {
    target: typescript.ScriptTarget.ES2022,
    module: typescript.ModuleKind.ES2022,
  },
}).outputText;
const { calculateSetCompletion, csvForMissingCards } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);

const set = {
  id: "base1",
  name: "Base Set",
  cardCount: { total: 3, official: 3 },
  cards: [
    { id: "base1-1", localId: "1", name: "Alakazam", image: null },
    { id: "base1-2", localId: "2", name: "Blastoise", image: null },
    { id: "base1-3", localId: "3", name: "Chansey", image: null },
  ],
};

const owned = (id, quantity, language = "English", setId = "base1") => ({
  game: "pokemon",
  language,
  setId,
  tcgdexId: id,
  name: id,
  localId: id.slice(-1),
  quantity,
});

test("one physical copy completes one card identity", () => {
  const c = calculateSetCompletion(set, "en", [owned("base1-1", 1)]);
  assert.equal(c.total, 3);
  assert.equal(c.uniqueOwned, 1);
  assert.equal(c.missing, 2);
  assert.equal(c.percent, 33.3);
  assert.equal(c.duplicates, 0);
});

test("repeated scan acquisitions retain physical quantity and count extras", () => {
  const c = calculateSetCompletion(set, "en", [
    owned("base1-1", 2), owned("base1-1", 1), owned("base1-2", 3),
  ]);
  assert.equal(c.uniqueOwned, 2);
  assert.equal(c.copies, 6);
  assert.equal(c.duplicates, 4);
  assert.equal(c.missing, 1);
  assert.equal(c.entries[0].ownedRecords, 2);
});

test("different languages and non-Pokemon games never complete an English card", () => {
  const c = calculateSetCompletion(set, "en", [
    owned("base1-1", 5, "Japanese"),
    { ...owned("base1-1", 4), game: "riftbound" },
  ]);
  assert.equal(c.uniqueOwned, 0);
  assert.equal(c.missing, 3);
});

test("unknown provider IDs stay unmatched instead of being guessed by name", () => {
  const c = calculateSetCompletion(set, "en", [
    owned("tcgcsv-4-5", 1),
  ]);
  assert.equal(c.uniqueOwned, 0);
  assert.equal(c.unmatchedOwnedRecords, 1);
});

test("duplicate catalogue entries do not inflate the denominator", () => {
  const c = calculateSetCompletion(
    { ...set, cards: [...set.cards, set.cards[0]] }, "en", [owned("base1-1", 1)]
  );
  assert.equal(c.total, 3);
});

test("missing-list CSV quotes comma and protects spreadsheet formula cells", () => {
  const changed = { ...set, name: "Set, Test", cards: [
    { id: "a-1", localId: "1", name: "=HYPERLINK(\"bad\")", image: null },
  ] };
  const c = calculateSetCompletion(changed, "en", []);
  const csv = csvForMissingCards(c, changed.name);
  assert.match(csv, /"Set, Test"/);
  assert.match(csv, /"'=HYPERLINK/);
  assert.equal(csv.trim().split("\r\n").length, 2);
});

test("empty source sets have zero, not NaN, progress", () => {
  const c = calculateSetCompletion({ ...set, cards: [] }, "en", []);
  assert.equal(c.percent, 0);
  assert.equal(c.total, 0);
});
