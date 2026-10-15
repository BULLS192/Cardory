/**
 * Historical-provider CSV contract. Require an exact provider identity and
 * quoted market price. No lookup by name, no interpolated dates, no FX guess.
 */
export function parseCsv(text) {
  const cells=[];let row=[],field="",quoted=false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (ch==='"') {
      if (quoted && text[i+1]==='"'){field+='"';i++;}
      else quoted=!quoted;
    } else if(ch===","&&!quoted){row.push(field);field="";}
    else if((ch==="\n"||ch==="\r")&&!quoted){
      if(ch==="\r"&&text[i+1]==="\n")i++;
      row.push(field);field="";
      if(row.some(v=>v.trim()))cells.push(row);
      row=[];
    } else field+=ch;
  }
  if(quoted)throw new Error("Malformed CSV: missing closing quote");
  if(field||row.length){row.push(field);if(row.some(v=>v.trim()))cells.push(row);}
  return cells;
}
const REQUIRED=["provider_card_id","game","language","variant","date",
  "market_price","currency","source_url"];
export function validateHistoricalQuotes(raw,opts={}) {
  const rows=parseCsv(raw.replace(/^\uFEFF/,""));
  if(!rows.length)throw new Error("Empty historical-price CSV");
  const header=rows.shift().map(x=>x.trim());
  const missing=REQUIRED.filter(key=>!header.includes(key));
  if(missing.length)throw new Error("Missing required columns: "+missing.join(", "));
  if(rows.length>100000)throw new Error("Limit exceeded: 100000 observations per CSV");
  const seen=new Set(),quotes=[],rejected=[];
  const dateToday=opts.today||new Date().toISOString().slice(0,10);
  for(const [i,row] of rows.entries()){
    try {
      const obj=Object.fromEntries(header.map((name,k)=>[name,(row[k]||"").trim()]));
      const {provider_card_id,game,language,variant,date,market_price,currency,source_url}=obj;
      if(!/^(?:tcgcsv|riftcsv)-\d+-\d+$|^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(provider_card_id))
        throw new Error("Invalid exact provider card ID");
      if(!["pokemon","riftbound"].includes(game))throw new Error("Unsupported game");
      if(!["English","Japanese","Chinese","Chinese Simplified"].includes(language))
        throw new Error("Unsupported language");
      if(!["normal","foil","holofoil","reverse-holofoil","1st-edition",
        "1st-edition-holofoil","unlimited","unlimited-holofoil"].includes(variant))
        throw new Error("Unsupported exact variant");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        new Date(date+"T00:00:00Z").toISOString().slice(0,10)!==date || date>dateToday)
        throw new Error("Invalid historical date");
      const price=Number(market_price);
      if(!market_price||!Number.isFinite(price)||price<0)
        throw new Error("Invalid quoted market price");
      if(!/^[A-Z]{3}$/.test(currency))throw new Error("Currency must be ISO code");
      const source=new URL(source_url);
      if(source.protocol!=="https:"||source.username||source.password)
        throw new Error("Source must be public HTTPS URL");
      const identity=JSON.stringify([provider_card_id,game,language,variant,date,currency]);
      if(seen.has(identity))throw new Error("Duplicate identity/date in CSV");
      seen.add(identity);
      quotes.push({provider_card_id,game,language,variant,date,price,currency,
        source_url:source.toString()});
    }catch(e){rejected.push({line:i+2,reason:e.message||String(e)});}
  }
  return {quotes,rejected};
}
