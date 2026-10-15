"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cardImage } from "@/lib/tcgdex";
import type {
  CatalogCard,
  CatalogLanguage,
  CatalogSet,
  CatalogSetDetail,
} from "@/lib/catalogue";
import styles from "./catalogue.module.css";

type CardDetails = {
  id: string;
  name: string;
  localId: string;
  image?: string | null;
  rarity?: string | null;
  category?: string | null;
  illustrator?: string | null;
  hp?: number | null;
  types?: string[];
  stage?: string | null;
  description?: string | null;
  attacks?: Array<{ name: string; damage?: string | number; effect?: string; cost?: string[] }>;
  abilities?: Array<{ name: string; effect?: string; type?: string }>;
  weaknesses?: Array<{ type: string; value?: string }>;
  set?: { name: string };
};

const languages: Array<{ code: CatalogLanguage; label: string; api: string }> = [
  { code: "en", label: "English", api: "English" },
  { code: "ja", label: "Japanese / 日本語", api: "Japanese" },
  { code: "zh-tw", label: "Traditional Chinese / 繁體中文", api: "Chinese" },
];

function countCards(sets: CatalogSet[]): number {
  return sets.reduce((sum, set) => sum + set.cardCount.total, 0);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-SG").format(value);
}

function downloadJson(set: CatalogSetDetail, language: CatalogLanguage) {
  // Metadata and image source URLs only: never embed or mirror card art.
  const data = {
    provider: set.id.startsWith("tcgplayer-") ? "TCGCSV" : "TCGdex",
    upstream: set.id.startsWith("tcgplayer-")\n      ? "https://tcgcsv.com/tcgplayer/3/" + set.id.slice("tcgplayer-".length) + "/products"\n      : "https://api.tcgdex.net/v2/" + language + "/sets/" + set.id,
    language,
    exportedAt: new Date().toISOString(),
    set,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "cardory-" + language + "-" + set.id + ".json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function CatalogueExplorer() {
  const [language, setLanguage] = useState<CatalogLanguage>("en");
  const [query, setQuery] = useState("");
  const [cardQuery, setCardQuery] = useState("");
  const [sets, setSets] = useState<CatalogSet[]>([]);
  const [loadingSets, setLoadingSets] = useState(true);
  const [setError, setSetError] = useState("");
  const [activeSet, setActiveSet] = useState<CatalogSetDetail | null>(null);
  const [loadingCards, setLoadingCards] = useState(false);
  const [cardsError, setCardsError] = useState("");
  const [activeCard, setActiveCard] = useState<CardDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailError, setDetailError] = useState("");
  const setRequest = useRef(0);
  const detailRequest = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setRequest.current += 1;
    detailRequest.current += 1;
    setSets([]);
    setActiveSet(null);
    setActiveCard(null);
    setCardQuery("");
    setSetError("");
    setCardsError("");
    setDetailError("");
    setLoadingSets(true);
    setLoadingCards(false);
    setLoadingDetails(false);

    async function fetchSets() {
      try {
        const response = await fetch("/api/catalog/sets?language=" + language, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load sets.");
        if (!controller.signal.aborted) setSets(data.sets || []);
      } catch (error) {
        if (!controller.signal.aborted) {
          setSetError(error instanceof Error ? error.message : "Could not load sets.");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingSets(false);
      }
    }
    void fetchSets();
    return () => controller.abort();
  }, [language]);

  const filteredSets = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return search
      ? sets.filter((set) =>
          (set.name + " " + set.id).toLocaleLowerCase().includes(search)
        )
      : sets;
  }, [sets, query]);

  const filteredCards = useMemo(() => {
    const search = cardQuery.trim().toLocaleLowerCase();
    if (!activeSet) return [];
    return search
      ? activeSet.cards.filter((card) =>
          (card.name + " " + card.localId).toLocaleLowerCase().includes(search)
        )
      : activeSet.cards;
  }, [activeSet, cardQuery]);

  async function openSet(set: CatalogSet) {
    const currentRequest = ++setRequest.current;
    detailRequest.current += 1;
    setActiveSet(null);
    setActiveCard(null);
    setCardQuery("");
    setCardsError("");
    setDetailError("");
    setLoadingCards(true);
    setLoadingDetails(false);
    try {
      const response = await fetch(
        "/api/catalog/sets/" + encodeURIComponent(set.id) + "?language=" + language
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load this set.");
      if (currentRequest === setRequest.current) setActiveSet(data.set);
    } catch (error) {
      if (currentRequest === setRequest.current) {
        setCardsError(error instanceof Error ? error.message : "Could not load this set.");
      }
    } finally {
      if (currentRequest === setRequest.current) setLoadingCards(false);
    }
  }

  async function openCard(card: CatalogCard) {
    const currentRequest = ++detailRequest.current;
    setActiveCard(null);
    setDetailError("");
    setLoadingDetails(true);
    try {
      const apiLanguage = languages.find((item) => item.code === language)?.api || "English";
      const response = await fetch(
        "/api/cards/" + encodeURIComponent(card.id) +
        "?language=" + encodeURIComponent(apiLanguage)
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load card details.");
      if (currentRequest === detailRequest.current) setActiveCard(data as CardDetails);
    } catch (error) {
      if (currentRequest === detailRequest.current) {
        setDetailError(error instanceof Error ? error.message : "Could not load card details.");
      }
    } finally {
      if (currentRequest === detailRequest.current) setLoadingDetails(false);
    }
  }

  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <header className={styles.heading}>
          <div>
            <a className={styles.back} href="/">← Back to Cardory</a>
            <p className={styles.eyebrow}>CARDORY · POKÉMON TCG</p>
            <h1>Card Catalogue Explorer</h1>
            <p className={styles.subheading}>
              Browse published expansion sets and card artwork by language.
              Sources: TCGdex and supplementary TCGplayer metadata via TCGCSV. Artwork stays with the original provider.
            </p>
          </div>
          <div className={styles.controls}>
            <label htmlFor="catalogue-language">Catalogue language</label>
            <select
              id="catalogue-language"
              value={language}
              onChange={(event) => setLanguage(event.target.value as CatalogLanguage)}
            >
              {languages.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </div>
        </header>

        <section className={styles.stats} aria-label="Available catalogue coverage">
          <div><strong>{loadingSets ? "…" : formatCount(sets.length)}</strong><span>Sets in this language</span></div>
          <div><strong>{loadingSets ? "…" : formatCount(countCards(sets))}</strong><span>Set card entries (not unique worldwide)</span></div>
          <div><strong>{activeSet ? formatCount(activeSet.cards.length) : "—"}</strong><span>Cards in selected set</span></div>
        </section>

        <div className={styles.workspace}>
          <aside className={styles.sidebar} aria-label="Expansion sets">
            <div className={styles.sidebarHeading}>
              <h2>Expansion sets</h2>
              <span>{formatCount(filteredSets.length)}</span>
            </div>
            <input
              aria-label="Search expansion sets"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by set name or ID"
              className={styles.search}
            />
            {loadingSets && <p className={styles.muted} role="status">Loading expansion sets…</p>}
            {setError && <p className={styles.error} role="alert">{setError}</p>}
            {!loadingSets && !setError && filteredSets.length === 0 &&
              <p className={styles.muted}>No matching sets.</p>}
            <div className={styles.setList}>
              {filteredSets.map((set) => (
                <button
                  type="button"
                  key={set.id}
                  className={activeSet?.id === set.id ? styles.setActive : styles.setButton}
                  onClick={() => void openSet(set)}
                >
                  <span className={styles.setName}>{set.name}</span>
                  <span className={styles.setMeta}>{set.id} · {formatCount(set.cardCount.total)} cards</span>
                </button>
              ))}
            </div>
          </aside>

          <section className={styles.gallery} aria-label="Cards in selected expansion">
            {!activeSet && !loadingCards && !cardsError && (
              <div className={styles.empty}>
                <span className={styles.emptyIcon} aria-hidden="true">◈</span>
                <h2>Select an expansion set</h2>
                <p>Choose any set on the left to load its complete card index.</p>
              </div>
            )}
            {loadingCards && <p className={styles.muted} role="status">Loading cards and artwork references…</p>}
            {cardsError && <p className={styles.error} role="alert">{cardsError}</p>}
            {activeSet && (
              <>
                <div className={styles.galleryHeading}>
                  <div>
                    <p className={styles.eyebrow}>{activeSet.serie?.name || "Pokémon TCG"}</p>
                    <h2>{activeSet.name}</h2>
                    <p className={styles.muted}>
                      {formatCount(activeSet.cards.length)} indexed cards
                      {activeSet.releaseDate ? " · Released " + activeSet.releaseDate : ""}
                    </p>
                  </div>
                  <button className={styles.export} type="button"
                    onClick={() => downloadJson(activeSet, language)}>
                    Export set JSON ↓
                  </button>
                </div>
                <input
                  aria-label="Filter cards in selected set"
                  value={cardQuery}
                  onChange={(event) => setCardQuery(event.target.value)}
                  placeholder="Filter this set by card name or collector number"
                  className={styles.search}
                />
                <p className={styles.results}>{formatCount(filteredCards.length)} cards shown</p>
                <div className={styles.cards}>
                  {filteredCards.map((card) => (
                    <button key={card.id} type="button"
                      className={styles.cardButton}
                      onClick={() => void openCard(card)}
                      title={"View " + card.name + " details"}
                    >
                      {card.image ? (
                        // TCGdex provides external image URLs; use low quality for gallery loading.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cardImage(card.image, "low") || undefined}
                          alt={card.name + " card artwork"} loading="lazy" />
                      ) : <div className={styles.missingImage}>Image unavailable</div>}
                      <span className={styles.cardName}>{card.name}</span>
                      <span className={styles.cardNumber}>#{card.localId}</span>
                    </button>
                  ))}
                </div>
                {filteredCards.length === 0 && (
                  <p className={styles.muted}>No cards match this filter.</p>
                )}
              </>
            )}
          </section>
        </div>

        {(loadingDetails || activeCard || detailError) && (
          <div className={styles.overlay} role="presentation"
            onMouseDown={(event) => { if (event.target === event.currentTarget) {
              detailRequest.current += 1; setActiveCard(null); setLoadingDetails(false); setDetailError("");
            } }}>
            <section className={styles.details} role="dialog" aria-modal="true"
              aria-label={activeCard?.name || "Card details"}>
              <div className={styles.detailTop}>
                <h2>Card details</h2>
                <button type="button" onClick={() => {
                  detailRequest.current += 1; setActiveCard(null); setLoadingDetails(false); setDetailError("");
                }} aria-label="Close card details">✕</button>
              </div>
              {loadingDetails && <p className={styles.muted} role="status">Loading card details…</p>}
              {detailError && <p className={styles.error} role="alert">{detailError}</p>}
              {activeCard && (
                <div className={styles.detailContent}>
                  {activeCard.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className={styles.largeCard}
                      src={cardImage(activeCard.image, "high") || undefined}
                      alt={activeCard.name + " card"} />
                  ) : <div className={styles.missingImage}>Artwork not available</div>}
                  <div>
                    <h3>{activeCard.name}</h3>
                    <p className={styles.muted}>#{activeCard.localId} · {activeCard.set?.name || activeSet?.name}</p>
                    <dl className={styles.facts}>
                      <dt>Rarity</dt><dd>{activeCard.rarity || "Not documented"}</dd>
                      <dt>Category</dt><dd>{activeCard.category || "Not documented"}</dd>
                      <dt>HP</dt><dd>{activeCard.hp ?? "—"}</dd>
                      <dt>Type</dt><dd>{activeCard.types?.join(", ") || "—"}</dd>
                      <dt>Stage</dt><dd>{activeCard.stage || "—"}</dd>
                      <dt>Illustrator</dt><dd>{activeCard.illustrator || "Not documented"}</dd>
                    </dl>
                    {activeCard.abilities?.map((ability, index) => (
                      <div className={styles.move} key={index}>
                        <strong>Ability · {ability.name}</strong><p>{ability.effect}</p>
                      </div>
                    ))}
                    {activeCard.attacks?.map((attack, index) => (
                      <div className={styles.move} key={index}>
                        <strong>{attack.name} {attack.damage ?? ""}</strong>
                        <p>{attack.cost?.join(" · ")}</p><p>{attack.effect}</p>
                      </div>
                    ))}
                    {activeCard.description && <p className={styles.muted}>{activeCard.description}</p>}
                    <p className={styles.attribution}>Metadata and artwork reference provided by the respective card provider.</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        <footer className={styles.footer}>
          Cardory catalogue exploration · Data source:{" "}
          <a href="https://tcgdex.dev/" target="_blank" rel="noreferrer">TCGdex</a>.
          Set counts reflect the selected provider-language dataset, not complete worldwide coverage.
          Exported JSON contains image links rather than copyrighted image files.
        </footer>
      </div>
    </main>
  );
}
