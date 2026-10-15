#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/import-history-csv.mjs provider.csv [--apply]
 *
 * Requires historical quotes with provider_card_id, game, language, variant,
 * date, market_price, currency, source_url. Identity is exact, including
 * printing variant. --apply requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * and CARDORY_OWNER_ID in trusted shell environment.
 *
 * Default is dry-run. Imported quotes are explicitly tagged UNVERIFIED; a
 * quoted source URL does not itself prove correctness.
 */
import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { validateHistoricalQuotes } from "./lib/history-csv.mjs";

async function main() {
  const file=process.argv[2];
  const apply=process.argv.includes("--apply");
  if(!file||file.startsWith("--"))throw new Error("Pass a history CSV filename");
  const data=fs.readFileSync(file,"utf8");
  const {quotes,rejected}=validateHistoricalQuotes(data);
  process.stdout.write(`Parsed ${quotes.length} valid dated quotes, ${rejected.length} rejected.\n`);
  for(const item of rejected.slice(0,15)) {
    process.stdout.write(`Rejected line ${item.line}: ${item.reason}\n`);
  }
  if(rejected.length)throw new Error("Resolve all validation errors before importing");
  if(!apply){process.stdout.write("Dry-run only. Add --apply when verified.\n");return;}
  const url=process.env.SUPABASE_URL;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const owner=process.env.CARDORY_OWNER_ID;
  if(!url||!secret||!owner||!/^[0-9a-f-]{36}$/i.test(owner))
    throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CARDORY_OWNER_ID in protected environment");
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const owned=[];
  for(let offset=0;offset<20000;offset+=1000){
    const {data,error}=await db.from("owned_cards")
      .select("id,provider_card_id,game,language,variant,owner_id")
      .eq("owner_id",owner).range(offset,offset+999);
    if(error)throw error;
    owned.push(...(data||[]));
    if((data||[]).length<1000)break;
    if(offset===19000)throw new Error("Too many cards; increase pagination deliberately");
  }
  const byIdentity=new Map();
  for(const card of owned){
    const id=JSON.stringify([card.provider_card_id,card.game,card.language,card.variant]);
    byIdentity.set(id,[...(byIdentity.get(id)||[]),card.id]);
  }
  const rows=[];
  let unmatched=0;
  for(const q of quotes){
    const id=JSON.stringify([q.provider_card_id,q.game,q.language,q.variant]);
    const cards=byIdentity.get(id)||[];
    if(!cards.length)unmatched++;
    for(const cardId of cards)rows.push({
      owner_id:owner,owned_card_id:cardId,market_price:q.price,
      currency:q.currency,
      source:"historical:USER_CSV_UNVERIFIED:"+q.source_url,
      observed_at:q.date+"T12:00:00Z",
    });
  }
  let saved=0;
  for(let i=0;i<rows.length;i+=250){
    const {error}=await db.from("price_snapshots").upsert(rows.slice(i,i+250),{
      onConflict:"owned_card_id,snapshot_day",
      ignoreDuplicates:true, // never replace independently verified history
    });
    if(error)throw error;
    saved+=Math.min(250,rows.length-i);
  }
  process.stdout.write(`Imported up to ${saved} card-date observations (existing days preserved). ${unmatched} provider quotes unmatched.\n`);
}
main().catch(err=>{process.stderr.write("History import failed: "+err.message+"\n");process.exitCode=1;});
