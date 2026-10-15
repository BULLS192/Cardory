import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parseCsv, validateHistoricalQuotes } from "../scripts/lib/history-csv.mjs";

function moduleFromTs(path, imports={}) {
  const source=readFileSync(new URL(path,import.meta.url),"utf8");
  const js=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const exports={};
  new Function("exports","require",js)(exports,name=>{
    if(!(name in imports))throw new Error("Unknown dependency: "+name);
    return imports[name];
  });
  return exports;
}
const portfolio=moduleFromTs("../lib/portfolio.ts");
const { buildCardHistoryCoverage, summarizeHistoryCoverage, isHistoricalEstimate } =
  moduleFromTs("../lib/history-coverage.ts",{"./portfolio":portfolio});
const BASE={
  tcgdexId:"tcgcsv-24722-100",game:"pokemon",language:"English",variant:"holofoil",
  setId:"tcgplayer-24722",setName:"30th Celebration",localId:"026/128",name:"Pikachu",
  quantity:1,
};
const observed=(owned_card_id,snapshot_day,market_price=1)=>({
  owned_card_id,snapshot_day,market_price,currency:"USD",
  observed_at:snapshot_day+"T12:00:00Z",source:"TCGplayer market quote",
});
test("every printing appears in coverage including completely missing histories",()=>{
  const cards=[{...BASE,id:"a"},{...BASE,id:"b"},{
    ...BASE,id:"c",tcgdexId:"tcgcsv-24722-101",localId:"027/128",name:"Pikachu 027",
  }];
  const quotes=[observed("a","2026-09-16",4.01),observed("b","2026-10-15",.7),
    observed("a","2026-10-15",.7)];
  const result=buildCardHistoryCoverage(cards,quotes);
  assert.equal(result.length,2);
  const found=result.find(row=>row.localId==="026/128");
  assert.equal(found.quantity,2);
  assert.equal(found.recordCount,2);
  assert.equal(found.observedDays,2);
  assert.equal(found.firstDate,"2026-09-16");
  assert.equal(found.lastDate,"2026-10-15");
  const missing=result.find(row=>row.localId==="027/128");
  assert.equal(missing.observedDays,0);
  const summary=summarizeHistoryCoverage(result);
  assert.equal(summary.printings,2);
  assert.equal(summary.records,3);
  assert.equal(summary.withOlderHistory,1);
  assert.equal(summary.withoutOlderHistory,1);
  assert.equal(summary.withoutAnyHistory,1);
});
test("cross-language variants never combine historical coverage",()=>{
  const cards=[{...BASE,id:"a"},{...BASE,id:"b",language:"Chinese"},{...BASE,id:"c",variant:"normal"}];
  assert.equal(buildCardHistoryCoverage(cards,[observed("a","2026-09-16")]).length,3);
  assert.equal(summarizeHistoryCoverage(buildCardHistoryCoverage(cards,[])).withoutOlderHistory,3);
});
test("CSV parsing preserves quoted fields with commas and newline",()=>{
  const a=parseCsv('x,y\n"Hi, there",1\n"Other\nline",2\n');
  assert.deepEqual(a,[["x","y"],["Hi, there","1"],["Other\nline","2"]]);
});
test("CSV backfill accepts only exact provider identity dated sourced quotes",()=>{
  const header="provider_card_id,game,language,variant,date,market_price,currency,source_url";
  const good="tcgcsv-24722-716218,pokemon,English,holofoil,2026-09-16,5.95,USD,https://billsarchive.com/articles/30th-celebration-prices-release-to-now.html";
  const csv=header+"\n"+good+"\n";
  const report=validateHistoricalQuotes(csv,{today:"2026-10-15"});
  assert.equal(report.quotes.length,1);
  assert.equal(report.rejected.length,0);
  assert.equal(report.quotes[0].price,5.95);
  const bad=validateHistoricalQuotes(csv+good.replace("2026-09-16","2026-12-16")+"\n",{today:"2026-10-15"});
  assert.equal(bad.rejected.length,1);
  const dupe=validateHistoricalQuotes(csv+good+"\n",{today:"2026-10-15"});
  assert.equal(dupe.rejected.length,1);
  const mismatched=validateHistoricalQuotes(csv+good.replace("holofoil","fakevariant")+"\n",{today:"2026-10-15"});
  assert.equal(mismatched.rejected.length,1);
});
test("verified Bill's Archive SQL imports 58 exact set numbers on two real dates only",()=>{
  const sql=readFileSync(new URL("../scripts/backfill-30th-release-2026.sql",import.meta.url),"utf8");
  const values=sql.match(/\('\\d{3}',\\d+\.\\d{2},\\d+\.\\d{2}\)/g) || [];
  // Match the source values as literal SQL tuples; no interpolated index levels.
  assert.equal((sql.match(/\('[0-9]{3}',[0-9]+\.[0-9]{2},[0-9]+\.[0-9]{2}\)/g)||[]).length,58);
  assert.match(sql,/ON CONFLICT \(owned_card_id,snapshot_day\) DO NOTHING/);
  assert.match(sql,/set_id='tcgplayer-24722'/);
  assert.match(sql,/2026-09-16T18:23:00Z/);
  assert.match(sql,/2026-10-13T12:00:00Z/);
});

test("estimated provider history is clearly separated from reported market quotes",()=>{
  const cards=[{...BASE,id:"estimated",tcgdexId:"tcgcsv-24722-201"},{
    ...BASE,id:"reported",tcgdexId:"tcgcsv-24722-202",localId:"027/128"
  }];
  const model={
    ...observed("estimated","2026-09-16",0.28),
    source:"historical:ESTIMATE:KnowMyCards:PokemonPriceTracker:https://knowmycards.com/cards/english/123/slug/"
  };
  const verified={
    ...observed("reported","2026-09-16",2.8),
    source:"historical:TCGplayer-via-BillsArchive:https://billsarchive.com/articles/pricing"
  };
  const baseline=observed("estimated","2026-10-15",0.18);
  const rows=buildCardHistoryCoverage(cards,[model,verified,baseline]);
  const summary=summarizeHistoryCoverage(rows);
  assert.equal(summary.withOlderHistory,2);
  assert.equal(summary.withOlderReportedQuote,1);
  assert.equal(summary.withOnlyEstimatedOlder,1);
  assert.equal(isHistoricalEstimate(model.source),true);
  assert.equal(isHistoricalEstimate("historical:USER_CSV_UNVERIFIED:https://example.org"),true);
  assert.equal(isHistoricalEstimate(verified.source),false);
  assert.equal(rows.find(row=>row.recordId==="estimated").firstIsEstimate,true);
  assert.equal(rows.find(row=>row.recordId==="reported").firstIsEstimate,false);
});
