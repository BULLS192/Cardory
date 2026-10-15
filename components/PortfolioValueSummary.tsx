"use client";

import type { OwnedCard } from "@/lib/types";
import {
  calculatePortfolioValue, formatPortfolioAmounts,
  type ValueMode,
} from "@/lib/portfolio";

export function ValueModeSwitch({
  mode, onChange,
}: { mode: ValueMode; onChange: (value: ValueMode) => void }) {
  return (
    <div className="portfolio-mode" role="group" aria-label="Market valuation basis">
      <button type="button" className={mode === "copies" ? "active" : ""}
        aria-pressed={mode === "copies"} onClick={() => onChange("copies")}>
        Include duplicates
      </button>
      <button type="button" className={mode === "unique" ? "active" : ""}
        aria-pressed={mode === "unique"} onClick={() => onChange("unique")}>
        One per card
      </button>
    </div>
  );
}

export default function PortfolioValueSummary({
  cards, mode, onChange, label = "Collection market value",
}: {
  cards: OwnedCard[];
  mode: ValueMode;
  onChange: (value: ValueMode) => void;
  label?: string;
}) {
  const report = calculatePortfolioValue(cards, mode);
  return (
    <section className="portfolio-summary" aria-label={label}>
      <div className="portfolio-summary-top">
        <div>
          <span className="eyebrow">{label}</span>
          <strong className="portfolio-total">
            {formatPortfolioAmounts(report.amounts)}
          </strong>
        </div>
        <ValueModeSwitch mode={mode} onChange={onChange} />
      </div>
      <p className="portfolio-meta">
        {report.counted.toLocaleString()} {mode === "copies" ? "physical copies" : "distinct printings"}
        {" · "}{report.unique.toLocaleString()} unique printings
        {" · "}{report.duplicates.toLocaleString()} extra copies
        {report.unpriced > 0 && <>{" · "}<strong>{report.unpriced.toLocaleString()} without market price</strong></>}
      </p>
      <p className="portfolio-footnote">
        Values are recorded market-price estimates, not sale proceeds. Currencies stay separate (no unverified FX conversion).
        A card may appear in multiple binders, but is counted only once in the overall collection.
      </p>
    </section>
  );
}
