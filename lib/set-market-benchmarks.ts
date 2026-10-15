/** Market-wide set indexes, NOT the user's personal portfolio valuation.
 * Numbers transcribed from the public, CC BY 4.0 research series below.
 * An index of 1,000 represents the release-day price basket, NOT USD.
 * Historical coverage ends on 2026-10-14; never extrapolate beyond it. */
export type SetMarketBenchmark = {
  setId: string;
  title: string;
  releaseDate: string;
  lastVerified: string;
  sourceName: string;
  sourceUrl: string;
  license: string;
  points: { date: string; level: number }[];
};
const SOURCE = "Double Holo Research";
const LEVELS_24722: Record<string, number> = {
  "2026-09-16": 1000.00, "2026-09-17": 1031.41,
  "2026-09-18": 969.47,  "2026-09-19": 927.36,
  "2026-09-20": 891.02,  "2026-09-21": 835.30,
  "2026-09-22": 815.49,  "2026-09-23": 809.11,
  "2026-09-24": 815.60,  "2026-09-25": 797.13,
  "2026-09-26": 662.53,  "2026-09-27": 751.39,
  "2026-09-28": 754.97,  "2026-09-29": 753.29,
  "2026-09-30": 748.35,  "2026-10-01": 745.63,
  "2026-10-02": 740.50,  "2026-10-03": 730.59,
  "2026-10-04": 726.79,  "2026-10-05": 726.87,
  "2026-10-06": 726.04,  "2026-10-07": 725.76,
  "2026-10-08": 842.98,  "2026-10-09": 843.16,
  "2026-10-10": 843.64,  "2026-10-11": 984.03,
  "2026-10-12": 982.27,  "2026-10-13": 981.32,
  "2026-10-14": 981.02,
};
const LEVELS_24837: Record<string, number> = {
  "2026-09-16": 1000.00, "2026-09-17": 819.57,
  "2026-09-18": 863.81,  "2026-09-19": 880.42,
  "2026-09-20": 937.19,  "2026-09-21": 917.23,
  "2026-09-22": 922.54,  "2026-09-23": 913.70,
  "2026-09-24": 930.47,  "2026-09-25": 949.28,
  "2026-09-26": 990.30,  "2026-09-27": 1005.42,
  "2026-09-28": 1022.22, "2026-09-29": 940.59,
  "2026-09-30": 905.31,  "2026-10-01": 861.99,
  "2026-10-02": 798.99,  "2026-10-03": 735.18,
  "2026-10-04": 698.06,  "2026-10-05": 676.83,
  "2026-10-06": 656.88,  "2026-10-07": 683.01,
  "2026-10-08": 645.52,  "2026-10-10": 655.21,
  "2026-10-11": 650.72,  "2026-10-12": 647.83,
  "2026-10-13": 639.88,  "2026-10-14": 634.63,
};
function makeBenchmark(setId: string, title: string, slug: string,
  levels: Record<string, number>): SetMarketBenchmark {
  return {
    setId, title, releaseDate: "2026-09-16", lastVerified: "2026-10-14",
    sourceName: SOURCE,
    sourceUrl: "https://doubleholo.com/pokemon-market/sets/" + slug,
    license: "CC BY 4.0",
    points: Object.entries(levels).sort(([a],[b]) => a.localeCompare(b))
      .map(([date, level]) => ({ date, level })),
  };
}
export const HISTORICAL_SET_BENCHMARKS: SetMarketBenchmark[] = [
  makeBenchmark("tcgplayer-24722", "30th Celebration", "30th-celebration", LEVELS_24722),
  makeBenchmark("tcgplayer-24837", "30th Celebration Classic Collection",
    "30th-celebration-classic-collection", LEVELS_24837),
];
export function lookupSetBenchmark(setId?: string | null) {
  return HISTORICAL_SET_BENCHMARKS.find(item => item.setId === setId) ?? null;
}
