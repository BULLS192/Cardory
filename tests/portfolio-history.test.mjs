import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
function moduleFromTs(path, imports = {}) {
  const raw = readFileSync(new URL(path, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(raw, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", transpiled)(exports, name => {
    if (!(name in imports)) throw Error("Unexpected require: " + name);
    return imports[name];
  });
  return exports;
}
const portfolio = moduleFromTs("../lib/portfolio.ts");
const { buildPortfolioHistory, rangeHistory, availableHistoryCurrencies } =
  moduleFromTs("../lib/portfolio-history.ts", {"./portfolio": portfolio});
const card = (id, variant, acquired, quantity, language = "English") => ({
  id,tcgdexId:"sv1-001",game:"pokemon",language,variant,quantity,
  addedAt:acquired+"T09:00:00Z",acquisition:{date:acquired},
  marketPrice:9,marketCurrency:"USD",
});
const observation=(id,date,price,currency="USD")=>({
  owned_card_id:id,market_price:price,currency,source:"verified price",
  snapshot_day:date,observed_at:date+"T12:00:00Z",
});

test("portfolio history has no prices before first observed date",()=>{
  const cards=[card("a","normal","2026-10-01",2)];
  const p=buildPortfolioHistory(cards,[observation("a","2026-10-15",4)],"copies");
  assert.deepEqual(p.map(x=>x.date),["2026-10-15"]);
  assert.equal(p[0].amounts.USD,8);
  assert.equal(p[0].copies,2);
});

test("value movement is distinct from cashflow as new cards are acquired",()=>{
  const cards=[card("a","normal","2026-10-01",1),card("b","foil","2026-10-16",1)];
  const quotes=[observation("a","2026-10-15",10),observation("b","2026-10-15",20),
    observation("a","2026-10-16",11),observation("b","2026-10-16",25)];
  const p=buildPortfolioHistory(cards,quotes,"copies");
  assert.equal(p[0].amounts.USD,10);
  assert.equal(p[1].amounts.USD,36);
  assert.equal(p[0].copies,1);
  assert.equal(p[1].copies,2);
});

test("copies vs unique printings changes holdings value without mixing language",()=>{
  const cards=[card("a","normal","2026-10-01",2),
    card("b","normal","2026-10-01",3),
    card("c","normal","2026-10-01",1,"Japanese")];
  const quotes=[observation("a","2026-10-15",4),
    observation("b","2026-10-15",5),
    observation("c","2026-10-15",400,"JPY")];
  const copies=buildPortfolioHistory(cards,quotes,"copies")[0];
  const unique=buildPortfolioHistory(cards,quotes,"unique")[0];
  assert.equal(copies.amounts.USD,23);
  assert.equal(unique.amounts.USD,5);
  assert.equal(unique.amounts.JPY,400);
  assert.equal(unique.copies,2);
  assert.equal(copies.copies,6);
});

test("missing quotes are not zero, last observed quote carries forward only",()=>{
  const cards=[card("a","normal","2026-10-01",1),
    card("c","foil","2026-10-01",2)];
  const quotes=[observation("a","2026-10-15",1),
    observation("c","2026-10-16",2)];
  const p=buildPortfolioHistory(cards,quotes,"copies");
  assert.equal(p[0].priced,1);
  assert.equal(p[0].unpriced,2);
  assert.equal(p[1].amounts.USD,5);
  assert.equal(p[1].priced,3);
});

test("historical range selection and currencies are deterministic",()=>{
  const a=Array.from({length:12},(_,i)=>({
    date:`2026-10-${String(i+1).padStart(2,"0")}`,
    amounts:{USD:i+10,JPY:100},priced:1,unpriced:0,copies:1,
  }));
  assert.deepEqual(rangeHistory(a,"ALL"),a);
  assert.equal(rangeHistory(a,"1M").length,12);
  assert.deepEqual(availableHistoryCurrencies(a),["JPY","USD"]);
});

const { HISTORICAL_SET_BENCHMARKS, lookupSetBenchmark } =
  moduleFromTs("../lib/set-market-benchmarks.ts");

test("release market basis can show a real price before acquisition, never as owned P/L", () => {
  const cards = [card("early","holofoil","2026-10-01",1)];
  const quotes = [
    observation("early","2026-09-16",5.95),
    observation("early","2026-10-15",1.58),
  ];
  const purchased = buildPortfolioHistory(cards,quotes,"copies","owned");
  assert.equal(purchased.length,1);
  assert.equal(purchased[0].date,"2026-10-15");
  assert.equal(purchased[0].amounts.USD,1.58);
  const market = buildPortfolioHistory(cards,quotes,"copies","market");
  assert.deepEqual(market.map(p=>p.date),["2026-09-16","2026-10-15"]);
  assert.equal(market[0].amounts.USD,5.95);
  assert.equal(market[1].amounts.USD,1.58);
});

test("set indexes are separate, cited historical index points, never USD values", () => {
  const main=lookupSetBenchmark("tcgplayer-24722");
  const classic=lookupSetBenchmark("tcgplayer-24837");
  assert.equal(HISTORICAL_SET_BENCHMARKS.length,2);
  for (const item of [main,classic]) {
    assert.equal(item.releaseDate,"2026-09-16");
    assert.equal(item.points[0].date,"2026-09-16");
    assert.equal(item.points[0].level,1000);
    assert.equal(item.points.at(-1).date,"2026-10-14");
    assert.equal(item.license,"CC BY 4.0");
    assert.match(item.sourceUrl,/^https:\/\/doubleholo.com/);
  }
  assert.equal(main.points.length,29);
  assert.equal(classic.points.length,28);
  assert.equal(main.points.at(-1).level,981.02);
  assert.equal(classic.points.at(-1).level,634.63);
  assert.equal(lookupSetBenchmark("other"),null);
});
