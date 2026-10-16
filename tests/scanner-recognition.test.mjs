import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/scanner-recognition.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const scanner = {};
new Function("exports", "require", compiled)(scanner, () => { throw Error("Unexpected runtime import"); });
const { parsePrintedIdentity, fingerprintPixels, fingerprintSimilarity } = scanner;

test("recognizes printed set codes, collector numbers and full-width script punctuation", () => {
  assert.deepEqual(parsePrintedIdentity("SV5a 051/066"), {
    setCode: "SV5A", number: "051/066", confidence: "high",
  });
  assert.deepEqual(parsePrintedIdentity("ＣＳＶ９Ｃ ０２３／１９０"), {
    setCode: "CSV9C", number: "023/190", confidence: "high",
  });
  assert.deepEqual(parsePrintedIdentity("M1S 001/063"), {
    setCode: "M1S", number: "001/063", confidence: "high",
  });
  assert.deepEqual(parsePrintedIdentity("030a/298"), {
    setCode: null, number: "030A/298", confidence: "medium",
  });
});

test("rejects HP and year false positives, and ranks number-only scans below coded IDs", () => {
  assert.equal(parsePrintedIdentity("HP 170\nDamage 120\n©2026"), null);
  assert.deepEqual(parsePrintedIdentity("Pikachu 203/193"), {
    setCode: null, number: "203/193", confidence: "medium",
  });
  assert.deepEqual(parsePrintedIdentity("057/071 SV5A"), {
    setCode: "SV5A", number: "057/071", confidence: "high",
  });
});

function gradient(reverse = false, boost = 0) {
  const width = 72, height = 96;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const value = reverse ? 200 - 2 * x : 30 + 2 * x;
    data[at] = Math.min(255, value + boost);
    data[at + 1] = Math.min(255, value / 2 + boost);
    data[at + 2] = Math.min(255, 200 - value / 2 + boost);
    data[at + 3] = 255;
  }
  return { data, width, height };
}

test("visual fingerprint ranks identical artwork above reversed artwork", () => {
  const a = gradient();
  const b = gradient(true);
  const same = fingerprintPixels(a.data, a.width, a.height);
  const different = fingerprintPixels(b.data, b.width, b.height);
  assert.equal(fingerprintSimilarity(same, same), 1);
  assert.ok(fingerprintSimilarity(same, different) < .7);
  assert.equal(fingerprintSimilarity(same, { gradients: [], colors: [] }), 0);
});

test("fingerprint rejects invalid data before visual comparison", () => {
  assert.throws(() => fingerprintPixels(new Uint8ClampedArray(1), 72, 96), /Invalid image/);
});
