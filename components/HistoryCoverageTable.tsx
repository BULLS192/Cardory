"use client";

import { useMemo, useState } from "react";
import type { OwnedCard } from "@/lib/types";
import type { PriceObservation } from "@/lib/portfolio-history";
import { buildCardHistoryCoverage, summarizeHistoryCoverage } from "@/lib/history-coverage";
import { formatPortfolioAmounts } from "@/lib/portfolio";

type CoverageFilter = "all" | "older" | "missing" | "unpriced";
function dateLabel(date: string | null) {
  if (!date) return "No recorded price";
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-SG", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
}
function money(price: number | null, currency: string | null) {
  if (price == null || !currency) return "—";
  return formatPortfolioAmounts({ [currency]: price });
}

/** Report every exact card printing. A blank historic quote is *missing
 * evidence*, not a zero valuation or a synthetic historical price. */
export default function HistoryCoverageTable({
  cards, observations, onSelect,
}: {
  cards: OwnedCard[];
  observations: PriceObservation[];
  onSelect: (cardId: string) => void;
}) {
  const baseline = "2026-10-15";
  const rows = useMemo(() => buildCardHistoryCoverage(cards, observations), [cards, observations]);
  const summary = summarizeHistoryCoverage(rows, baseline);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CoverageFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const matching = rows.filter(row => {
    if (filter === "older" && (!row.firstDate || row.firstDate >= baseline)) return false;
    if (filter === "missing" && row.firstDate && row.firstDate < baseline) return false;
    if (filter === "unpriced" && row.observedDays) return false;
    const text = [row.name,row.localId,row.setName,row.variant,row.language].join(" ").toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });
  const visible = expanded || query || filter !== "all" ? matching : matching.slice(0, 14);
  return (
    <section className="panel history-coverage" aria-label="History coverage for all owned cards">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">FULL COLLECTION · DATA COVERAGE</span>
          <h2>History for every card</h2>
          <p>Every distinct printing is included, even when older market prices have not been found.</p>
        </div>
      </div>
      <div className="history-coverage-stats">
        <div><strong>{summary.printings}</strong><span>Distinct printings</span></div>
        <div><strong>{summary.withOlderHistory}</strong><span>Earlier price evidence</span></div>
        <div><strong>{summary.withoutOlderHistory}</strong><span>Need older source</span></div>
        <div><strong>{summary.withAnyHistory}</strong><span>With any recorded price</span></div>
      </div>
      <div className="history-coverage-tools">
        <label>
          <span>Find a card</span>
          <input value={query} onChange={e=>setQuery(e.target.value)}
            placeholder="Name, card number, set or language…" aria-label="Find a card in history coverage"/>
        </label>
        <label>
          <span>Coverage</span>
          <select value={filter} onChange={e=>setFilter(e.target.value as CoverageFilter)}
            aria-label="Filter historical price coverage">
            <option value="all">All cards</option>
            <option value="older">Older history found</option>
            <option value="missing">Missing older history</option>
            <option value="unpriced">No recorded price at all</option>
          </select>
        </label>
      </div>
      <div className="history-coverage-scroll">
        <table>
          <thead><tr>
            <th>Owned card</th>
            <th>First recorded</th>
            <th>Last recorded</th>
            <th>Days</th>
            <th>Older history</th>
          </tr></thead>
          <tbody>
            {visible.map(row => (
              <tr key={row.identity}>
                <td>
                  <button type="button" className="history-card-link"
                    onClick={()=>onSelect(row.recordId)}
                    title="View this card's price history">
                    {row.name}
                  </button>
                  <small>{row.setName} · #{row.localId} · {row.variant}
                    {" · "}{row.language}{row.quantity > 1 ? " · " + row.quantity + " copies" : ""}</small>
                </td>
                <td>{dateLabel(row.firstDate)}
                  {row.firstDate && row.firstPrice != null &&
                    <small>{money(row.firstPrice, row.firstCurrency)}</small>}
                </td>
                <td>{dateLabel(row.lastDate)}
                  {row.lastDate && <small>{money(row.lastPrice,row.lastCurrency)}</small>}
                </td>
                <td>{row.observedDays || "—"}</td>
                <td>{row.firstDate && row.firstDate < baseline
                  ? <strong className="history-sourced">{row.source?.includes("USER_CSV_UNVERIFIED") ? "Imported (unverified)" : "Documented"}</strong>
                  : <span className="history-not-yet">Needs source</span>}
                  {row.source?.includes("BillsArchive") &&
                    <small><a href="https://billsarchive.com/articles/30th-celebration-prices-release-to-now.html"
                      target="_blank" rel="noopener noreferrer">Release-day evidence</a></small>}
                </td>
              </tr>
            ))}
            {!visible.length &&
              <tr><td colSpan={5}>No cards match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
      {matching.length > 14 && !query && filter === "all" &&
        <button type="button" className="ghost history-see-all"
          onClick={()=>setExpanded(value=>!value)}>
          {expanded ? "Show fewer" : "Show all " + matching.length + " printings"}
        </button>}
      <p className="portfolio-footnote">
        Baseline began October 15, 2026. Older history counts only actual dated
        card-specific observations. A set index is not a substitute for an exact
        card-and-printing market quote. Source coverage differs by game, language,
        condition, and release date.
      </p>
    </section>
  );
}
