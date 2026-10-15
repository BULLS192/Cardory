"use client";

import { useEffect, useMemo, useState } from "react";
import type { OwnedCard, Binder } from "@/lib/types";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { formatPortfolioAmounts, groupOwnedSets, type ValueMode } from "@/lib/portfolio";
import { buildPortfolioHistory, rangeHistory, availableHistoryCurrencies,
  type HistoryRange, type PriceObservation } from "@/lib/portfolio-history";
import { ValueModeSwitch } from "@/components/PortfolioValueSummary";
import SetMarketBenchmarks from "@/components/SetMarketBenchmarks";
import HistoryCoverageTable from "@/components/HistoryCoverageTable";
import { isHistoricalEstimate } from "@/lib/history-coverage";
import type { HistoryBasis } from "@/lib/portfolio-history";

export type HistoricalScope = {
  id: string;
  label: string;
  cards: OwnedCard[];
};
function money(value: number, currency: string): string {
  return formatPortfolioAmounts({ [currency]: value });
}
function dateLabel(date: string): string {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-SG", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
}

/** Exact-dated source points are plotted; some imported source readings are
 * estimated market values and may be interpolated by their publisher.
 * No CARDORY-generated backfill or unsupported FX conversion is performed. */
function PriceHistoryChart({ values, currency }: {
  values: { date: string; amount: number }[]; currency: string;
}) {
  const W = 760, H = 260, L = 78, R = 18, T = 18, B = 45;
  if (!values.length) return <div className="history-empty">
    No priced observations for this currency yet.
  </div>;
  const dated = values.map(row => ({
    ...row, time: Date.parse(row.date + "T00:00:00Z"),
  }));
  const minT = dated[0].time, maxT = dated[dated.length - 1].time;
  const figures = dated.map(row => row.amount);
  const minVal = Math.min(...figures), maxVal = Math.max(...figures);
  const padding = Math.max(0.01, (maxVal - minVal) * .16);
  const lo = Math.max(0, minVal - padding), hi = maxVal + padding;
  const x = (t: number) => L + (maxT > minT ? ((t - minT) / (maxT - minT)) * (W - L - R) : (W - L - R) / 2);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const points = dated.map(row => [x(row.time), y(row.amount)] as const);
  const segments = points.slice(1).map((end, i) => ({
    d: `M ${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)} L ${end[0].toFixed(2)} ${end[1].toFixed(2)}`,
    gap: dated[i+1].time - dated[i].time > 3 * 86400000,
  }));
  const grid = [0,1,2,3,4].map(i => hi - i * (hi - lo) / 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="history-chart"
      role="img" aria-label={`Recorded ${currency} portfolio market value, ${dateLabel(values[0].date)} to ${dateLabel(values.at(-1)!.date)}`}>
      {grid.map((v, i) => (
        <g key={i}>
          <line x1={L} y1={y(v)} x2={W-R} y2={y(v)} stroke="currentColor" strokeOpacity=".12" />
          <text x={L-11} y={y(v)+4} textAnchor="end" fontSize="11" fill="currentColor">
            {v.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </text>
        </g>
      ))}
      {segments.map((segment, i) => (
        <path key={i} d={segment.d} fill="none" stroke="#3678b7"
          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={segment.gap ? "5 7" : undefined}
          opacity={segment.gap ? 0.58 : 1} />
      ))}
      {points.map(([px,py],i) => (
        <circle key={i} cx={px} cy={py} r={points.length === 1 || i === points.length-1 ? 4.5 : 2}
          fill="#3678b7">
          <title>{dateLabel(dated[i].date)}: {money(dated[i].amount,currency)}</title>
        </circle>
      ))}
      <text x={L} y={H-12} textAnchor="start" fontSize="11" fill="currentColor">
        {dateLabel(values[0].date)}
      </text>
      <text x={W-R} y={H-12} textAnchor="end" fontSize="11" fill="currentColor">
        {dateLabel(values.at(-1)!.date)}
      </text>
    </svg>
  );
}

export default function PortfolioHistory({
  cards, binders, ownerId, valueMode, onValueModeChange, priceRefresh,
}: {
  cards: OwnedCard[]; binders: Binder[]; ownerId: string | null;
  valueMode: ValueMode; onValueModeChange: (mode: ValueMode) => void;
  priceRefresh?: string | null;
}) {
  const [readings, setReadings] = useState<PriceObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [scopeId, setScopeId] = useState("all");
  const [historyBasis, setHistoryBasis] = useState<HistoryBasis>("owned");
  const [historySource, setHistorySource] = useState<"all" | "reported">("all");
  const [range, setRange] = useState<HistoryRange>("ALL");
  const [unit, setUnit] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!ownerId) { setReadings([]); setLoading(false); return; }
    const client = getSupabaseBrowserClient();
    if (!client) { setLoading(false); setError("Supabase is not configured."); return; }
    let stopped = false;
    async function load() {
      setLoading(true); setError(""); setTruncated(false);
      const entries: PriceObservation[] = [];
      try {
        // Paginate explicitly; PostgREST silently caps the default result at 1,000.
        for (let start=0; start<50000; start+=1000) {
          const { data, error: failure } = await client!.from("price_snapshots")
            .select("owned_card_id,market_price,currency,source,observed_at,snapshot_day")
            .eq("owner_id", ownerId)
            .order("observed_at", { ascending: true })
            .range(start, start+999);
          if (failure) throw failure;
          entries.push(...((data || []) as PriceObservation[]));
          if (!data || data.length < 1000) break;
          if (start === 49000) setTruncated(true);
        }
        if (!stopped) setReadings(entries);
      } catch (failure) {
        if (!stopped) setError(failure instanceof Error ? failure.message : "Could not load historical prices.");
      } finally {
        if (!stopped) setLoading(false);
      }
    }
    void load();
    return () => { stopped = true; };
  }, [ownerId, priceRefresh, refresh]);

  const options: HistoricalScope[] = useMemo(() => {
    const sets = groupOwnedSets(cards);
    return [
      { id: "all", label: "All cards · portfolio", cards },
      ...binders.map(binder => ({
        id: "binder:"+binder.id, label: "Binder · "+binder.name,
        cards: binder.kind === "manual"
          ? cards.filter(card => binder.cardIds.includes(card.id))
          : cards.filter(card => binder.rules.length && (
              // Smart binder scopes show currently matched holdings.
              binder.match === "all"
                ? binder.rules.every(rule => matchesRule(card,rule))
                : binder.rules.some(rule => matchesRule(card,rule))
            )),
      })),
      ...sets.map(set => ({
        id: "set:"+set.key, label: "Set · "+set.setName+" ("+set.language+")", cards:set.cards,
      })),
      ...cards.map(card => ({
        id: "card:"+card.id,
        label: "Card · "+card.name+" #"+card.localId+" ("+(card.language||"English")+")",
        cards:[card],
      })),
    ];
  }, [cards,binders]);
  const scope = options.find(option => option.id===scopeId) || options[0];
  const sourceReadings = useMemo(() =>
    historySource === "all" ? readings : readings.filter(item => !isHistoricalEstimate(item.source)),
    [readings, historySource]);
  const estimatedQuoteCount = readings.filter(item => isHistoricalEstimate(item.source)).length;
  const reportedQuoteCount = readings.length - estimatedQuoteCount;
  const history = useMemo(() => buildPortfolioHistory(
    scope.cards, sourceReadings, valueMode, historyBasis),
    [scope.cards, sourceReadings, valueMode, historyBasis]);
  const withinRange = rangeHistory(history, range);
  // An incomplete historical basket is not a meaningful total portfolio
  // valuation. Permit sparse data for the individual card scope only.
  const shown = scope.id.startsWith("card:")
    ? withinRange.filter(p => p.priced > 0)
    : withinRange.filter(p => p.copies > 0 && p.priced / p.copies >= 0.95);
  const incompleteDays = withinRange.length - shown.length;
  const currencies = availableHistoryCurrencies(shown);
  const currentUnit = currencies.includes(unit) ? unit : currencies[0] || "";
  const plot = shown.filter(p => currentUnit in p.amounts)
    .map(p => ({date:p.date,amount:p.amounts[currentUnit]}));
  const latest = shown.at(-1);
  const first = plot[0], last = plot.at(-1);
  const firstAcquisition = scope.cards.map(card => card.acquisition?.date || card.addedAt?.slice(0,10))
    .filter((v):v is string=>!!v).sort()[0];

  return (
    <section>
      <div className="panel-heading">
        <div><span className="eyebrow">CARDORY PORTFOLIO INTELLIGENCE</span>
          <h1>Portfolio history</h1>
          <p>Explore dated market quotes and clearly labeled historical estimates across cards, binders, and sets.</p>
        </div>
        <button type="button" className="ghost" onClick={()=>setRefresh(value=>value+1)}
          disabled={loading || !ownerId}>Refresh chart</button>
      </div>
      {!ownerId ? (
        <div className="panel history-empty">Sign in to load secure cloud price history. Your cards are still visible in My Cards.</div>
      ) : (
        <>
          <div className="panel history-controls">
            <label><span>View holdings</span>
              <select aria-label="History holdings" value={scope.id}
                onChange={event=>{
                  setScopeId(event.target.value);
                  setHistoryBasis(event.target.value.startsWith("card:") ? "market" : "owned");
                }}>
                {options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label><span>Quote currency</span>
              <select aria-label="Historical quote currency" value={currentUnit}
                onChange={event=>setUnit(event.target.value)} disabled={!currencies.length}>
                {currencies.map(value=><option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label><span>History basis</span>
              <select aria-label="Historical valuation basis" value={historyBasis}
                onChange={e=>setHistoryBasis(e.target.value as HistoryBasis)}>
                <option value="owned">Since purchase · actual holdings</option>
                <option value="market">Since release · selected cards (market-only)</option>
              </select>
            </label>
            <label><span>Historical price source</span>
              <select aria-label="Historical price source" value={historySource}
                onChange={event=>setHistorySource(event.target.value as "all" | "reported")}>
                <option value="all">All historical prices · including estimates</option>
                <option value="reported">Reported market quotes only</option>
              </select>
            </label>
            <ValueModeSwitch mode={valueMode} onChange={onValueModeChange} />
            <div className="history-ranges" role="group" aria-label="Historical date range">
              {(["1M","3M","1Y","ALL"] as const).map(value => (
                <button type="button" key={value} className={range===value?"active":""}
                  onClick={()=>setRange(value)} aria-pressed={range===value}>{value}</button>
              ))}
            </div>
          </div>
          {loading && <p className="history-notice" role="status">Loading your recorded market history…</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {!loading && !error && (
            <article className="panel history-plot-panel">
              <span className="eyebrow">{historyBasis === "market"
                ? "MARKET-ONLY · HYPOTHETICAL CURRENT BASKET" : "ACTUAL HOLDINGS · SINCE PURCHASE"}</span>
              <div className="history-headline">
                <strong>{latest && currentUnit in latest.amounts
                  ? money(latest.amounts[currentUnit],currentUnit) : "—"}</strong>
                {first && last && plot.length>1 &&
                  <span>Value change over shown period: {money(last.amount-first.amount,currentUnit)}
                    {" "}({first.amount > 0 ? ((last.amount-first.amount)/first.amount*100).toFixed(1)+"%" : "n/a"})
                  </span>}
              </div>
              <PriceHistoryChart values={plot} currency={currentUnit} />
              <p className="portfolio-footnote">
                {readings.length.toLocaleString()} dated records:
                {" "}{reportedQuoteCount.toLocaleString()} reported/recorded market quotes
                and {" "}{estimatedQuoteCount.toLocaleString()} indicative third-party estimates.
                {incompleteDays ? ` ${incompleteDays} dates excluded because fewer than 95% of selected positions had historical prices.` : ""}
                {latest ? ` Latest: ${dateLabel(latest.date)} · ${latest.priced} priced · ${latest.unpriced} unpriced positions.` : ""}
                {truncated ? " Older records exceed the current 50,000-row display limit." : ""}
              </p>
              <p className="portfolio-footnote">
                {firstAcquisition ? `Earliest purchase or addition in this view: ${dateLabel(firstAcquisition)}. ` : ""}
                Historical values begin only on dates with provider price evidence.
                Third-party historical estimates may include modeled or interpolated values,
                are not individual sales, and should not be treated as proven returns.
                {historyBasis === "market"
                  ? " This is a retrospective price check of today's selected cards, even before you bought them; it is NOT your past portfolio value or profit."
                  : " This follows currently held cards from their recorded purchase dates. Purchases and additions affect the total, so changes in value are NOT investment profit."}
                Dashed connectors indicate missing observation dates (not daily estimates).
                Unchanged solid sections carry forward the last known quote; pricing gaps are disclosed.
              </p>
            </article>
          )}
          <SetMarketBenchmarks cards={scope.cards} />
          <HistoryCoverageTable cards={cards} observations={readings}
            onSelect={(recordId) => {
              setScopeId("card:" + recordId);
              setHistoryBasis("market");
              setRange("ALL");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }} />
        </>
      )}
    </section>
  );
}

function matchesRule(card:OwnedCard,rule:Binder["rules"][number]) {
  let value:string|number|boolean="";
  if(rule.field==="tag")value=[...(card.tags||[]),...(card.smartTags||[])].join(" ");
  if(rule.field==="name")value=card.name;
  if(rule.field==="set")value=card.setName||"";
  if(rule.field==="rarity")value=card.rarity||"";
  if(rule.field==="condition")value=card.condition;
  if(rule.field==="favorite")value=card.favorite;
  if(rule.field==="marketPrice")value=card.marketPrice||0;
  if(rule.field==="favorite")return value===(rule.value==="true");
  if(rule.field==="marketPrice"){
    const a=Number(value),b=Number(rule.value);
    if(!Number.isFinite(b))return false;
    return rule.operator==="gt"?a>b:rule.operator==="gte"?a>=b:
      rule.operator==="lt"?a<b:rule.operator==="lte"?a<=b:a===b;
  }
  const a=String(value).toLowerCase(),b=rule.value.toLowerCase();
  return rule.operator==="contains"?a.includes(b):a===b;
}
