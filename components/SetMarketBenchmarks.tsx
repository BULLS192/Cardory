"use client";

import { useState } from "react";
import type { OwnedCard } from "@/lib/types";
import { HISTORICAL_SET_BENCHMARKS, type SetMarketBenchmark } from "@/lib/set-market-benchmarks";

function BenchmarkChart({ benchmark }: {benchmark: SetMarketBenchmark}) {
  const W=700,H=220,L=57,R=16,T=16,B=36;
  const points=benchmark.points;
  if (!points.length) return null;
  const start=Date.parse(points[0].date+"T00:00:00Z");
  const end=Date.parse(points[points.length-1].date+"T00:00:00Z");
  const levels=points.map(p=>p.level);
  const lo=Math.floor((Math.min(...levels)-45)/50)*50;
  const hi=Math.ceil((Math.max(...levels)+45)/50)*50;
  const x=(date:string)=>L+(Date.parse(date+"T00:00:00Z")-start)/(end-start||1)*(W-L-R);
  const y=(level:number)=>T+(hi-level)/(hi-lo||1)*(H-T-B);
  const line=points.map((point,index)=>(index===0?"M":"L")+x(point.date).toFixed(1)+" "+y(point.level).toFixed(1)).join(" ");
  const last=points[points.length-1].level;
  return (
    <>
      <svg className="history-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`${benchmark.title} historical set market index from ${points[0].date} to ${points[points.length-1].date}. Last level ${last.toFixed(2)}. Base 1000.`}>
        {[0,1,2,3,4].map(i=>{
          const value=lo+(hi-lo)*i/4;
          return <g key={i}>
            <line x1={L} y1={y(value)} x2={W-R} y2={y(value)} stroke="currentColor" strokeOpacity=".1"/>
            <text x={L-9} y={y(value)+4} textAnchor="end" fill="currentColor" fontSize="11">
              {value.toFixed(0)}
            </text>
          </g>;
        })}
        <line x1={L} x2={W-R} y1={y(1000)} y2={y(1000)}
          stroke="currentColor" strokeDasharray="4 4" strokeOpacity=".45"/>
        <path d={line} fill="none" stroke="#3678b7" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"/>
        {points.map(p=><circle key={p.date} cx={x(p.date)} cy={y(p.level)}
          r="3" fill="#3678b7"><title>{p.date}: {p.level.toFixed(2)} index points</title></circle>)}
        <text x={L} y={H-9} fill="currentColor" fontSize="11">16 Sep 2026</text>
        <text x={W-R} y={H-9} textAnchor="end" fill="currentColor" fontSize="11">14 Oct 2026</text>
      </svg>
      <p className="portfolio-footnote">
        {points.length} published observations · Release-day index = 1,000 points.
        Last level: <strong>{last.toFixed(2)}</strong>{" "}
        ({((last/1000-1)*100).toFixed(2)}% since release).
      </p>
    </>
  );
}

/** Public licensed benchmarks, clearly separate from a user's personal prices. */
export default function SetMarketBenchmarks({ cards }: { cards: OwnedCard[] }) {
  const available=HISTORICAL_SET_BENCHMARKS.filter(item =>
    cards.some(card=>card.game==="pokemon" && card.language==="English" &&
      card.setId===item.setId));
  const [expanded,setExpanded]=useState(true);
  if(!available.length) return null;
  return (
    <section className="panel history-benchmark-panel" aria-label="Historical set market benchmarks">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SINCE RELEASE · MARKET BENCHMARKS</span>
          <h2>How your sets have performed since launch</h2>
          <p>Full-set market indexes, independent of which cards you own.</p>
        </div>
        <button type="button" className="ghost" aria-expanded={expanded}
          onClick={()=>setExpanded(value=>!value)}>{expanded?"Hide charts":"Show charts"}</button>
      </div>
      {expanded && available.map(benchmark => (
        <article className="history-benchmark" key={benchmark.setId}>
          <h3>{benchmark.title}</h3>
          <BenchmarkChart benchmark={benchmark}/>
          <p className="portfolio-footnote">
            Historical index from <a href={benchmark.sourceUrl} target="_blank"
              rel="noopener noreferrer">{benchmark.sourceName}</a> · {benchmark.license}.
            Data verified through {benchmark.lastVerified}.
            <strong> Index points are not dollars or the value of your personal portfolio.</strong>
          </p>
        </article>
      ))}
      <p className="portfolio-footnote">
        The public TCGCSV daily-archive download was withdrawn in September 2026.
        CARDORY never substitutes a set-level index for your card-specific acquisition
        values. Card-level history is plotted separately when a dated, matched price exists.
      </p>
    </section>
  );
}
