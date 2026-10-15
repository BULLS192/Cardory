"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogLanguage, CatalogSet, CatalogSetDetail } from "@/lib/catalogue";
import type { OwnedCard } from "@/lib/types";
import { cardImage } from "@/lib/tcgdex";
import { calculateSetCompletion, csvForMissingCards } from "@/lib/set-completion";
import { mergeSetsWithOwned } from "@/lib/owned-set-fallbacks";
import styles from "./SetCompletion.module.css";

type Filter = "all" | "missing" | "owned" | "duplicates";

const LANGUAGES: { code: CatalogLanguage; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ja", label: "Japanese" },
  { code: "zh-tw", label: "Traditional Chinese" },
  { code: "zh-cn", label: "Simplified Chinese" },
];

function getLanguageLabel(language: CatalogLanguage) {
  return language === "ja" ? "Japanese"
    : language === "zh-tw" ? "Chinese" : language === "zh-cn" ? "Chinese Simplified" : "English";
}

function safeDownload(content: string, filename: string) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function SetCompletionView({
  ownedCards,
  onScan,
}: {
  ownedCards: OwnedCard[];
  onScan: () => void;
}) {
  const [language, setLanguage] = useState<CatalogLanguage>("en");
  const [sets, setSets] = useState<CatalogSet[]>([]);
  const [setQuery, setSetQuery] = useState("");
  const [setFilter, setSetFilter] = useState<"mine" | "all">("mine");
  const [loadingSets, setLoadingSets] = useState(true);
  const [setError, setSetError] = useState("");
  const [selectedSet, setSelectedSet] = useState<CatalogSetDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingSet, setLoadingSet] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [ownedOnlySet, setOwnedOnlySet] = useState<CatalogSet | null>(null);
  const [cardFilter, setCardFilter] = useState<Filter>("all");
  const [cardQuery, setCardQuery] = useState("");
  const currentRequest = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    currentRequest.current += 1;
    setSets([]);
    setSelectedSet(null);
    setOwnedOnlySet(null);
    setSelectedId(null);
    setLoadingSet(false);
    setLoadingSets(true);
    setSetError("");
    setDetailError("");
    setCardQuery("");
    setCardFilter("all");
    async function loadSets() {
      try {
        const response = await fetch("/api/catalog/sets?language=" + language, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not retrieve sets.");
        if (!controller.signal.aborted) setSets(data.sets || []);
      } catch (error) {
        if (!controller.signal.aborted) {
          setSetError(error instanceof Error ? error.message : "Could not retrieve sets.");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingSets(false);
      }
    }
    void loadSets();
    return () => controller.abort();
  }, [language]);

  const ownedSetCounts = useMemo(() => {
    const map = new Map<string, { ids: Set<string>; copies: number }>();
    const languageName = getLanguageLabel(language);
    for (const card of ownedCards) {
      if ((card.game ?? "pokemon") !== "pokemon" ||
          (card.language ?? "English") !== languageName || !card.setId) continue;
      const entry = map.get(card.setId) ?? { ids: new Set<string>(), copies: 0 };
      entry.ids.add(card.tcgdexId);
      entry.copies += Math.max(0, Math.trunc(Number(card.quantity) || 0));
      map.set(card.setId, entry);
    }
    return map;
  }, [language, ownedCards]);

  const { sets: recognizedSets, missingChecklists } = useMemo(
    () => mergeSetsWithOwned(sets, ownedCards, language),
    [sets, ownedCards, language]
  );

  const visibleSets = useMemo(() => {
    const q = setQuery.trim().toLocaleLowerCase();
    return recognizedSets.filter((set) => (!q || (set.name + " " + set.id).toLocaleLowerCase().includes(q)) &&
      (setFilter === "all" || ownedSetCounts.has(set.id)))
      .sort((a, b) => {
        const aOwn = ownedSetCounts.get(a.id)?.copies ?? 0;
        const bOwn = ownedSetCounts.get(b.id)?.copies ?? 0;
        return bOwn - aOwn || a.name.localeCompare(b.name);
      });
  }, [setQuery, setFilter, recognizedSets, ownedSetCounts]);

  const completion = useMemo(() =>
    selectedSet ? calculateSetCompletion(selectedSet, language, ownedCards) : null,
    [selectedSet, language, ownedCards]
  );

  const displayed = useMemo(() => {
    if (!completion) return [];
    const q = cardQuery.trim().toLocaleLowerCase();
    return completion.entries.filter((entry) => {
      const matches = !q ||
        (entry.card.name + " " + entry.card.localId).toLocaleLowerCase().includes(q);
      if (!matches) return false;
      if (cardFilter === "missing") return entry.quantity === 0;
      if (cardFilter === "owned") return entry.quantity > 0;
      if (cardFilter === "duplicates") return entry.quantity > 1;
      return true;
    });
  }, [completion, cardFilter, cardQuery]);

  async function loadSet(set: CatalogSet) {
    const request = ++currentRequest.current;
    setSelectedId(set.id);
    setSelectedSet(null);
    setOwnedOnlySet(null);
    setLoadingSet(true);
    setDetailError("");
    setCardQuery("");
    setCardFilter("all");
    try {
      const response = await fetch(
        "/api/catalog/sets/" + encodeURIComponent(set.id) + "?language=" + language
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load set checklist.");
      if (request === currentRequest.current) {
        if (!data.set?.cards?.length) throw new Error("Source checklist is empty.");
        setSelectedSet(data.set);
      }
    } catch (error) {
      if (request === currentRequest.current) {
        // Never claim 100% completion from a collector's own cards alone.
        setOwnedOnlySet(set);
        setDetailError(error instanceof Error ? error.message : "Could not load set.");
      }
    } finally {
      if (request === currentRequest.current) setLoadingSet(false);
    }
  }

  const ownedSetTotal = recognizedSets.filter((set) => ownedSetCounts.has(set.id)).length;
  const unindexedSetIds = missingChecklists;
  const ownedOnlyCards = ownedOnlySet
    ? ownedCards.filter((card) => (card.game ?? "pokemon") === "pokemon" &&
      (card.language ?? "English") === getLanguageLabel(language) &&
      card.setId === ownedOnlySet.id)
    : [];

  return (
    <section className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>YOUR COLLECTION · SET TRACKER</span>
          <h1>Set completion</h1>
          <p>Track your scans against Pokémon expansion checklists. Each card ID is
            counted once for set completion; extra physical copies count as duplicates.</p>
        </div>
        <button type="button" className={styles.scan} onClick={onScan}>
          Scan / Add a card
        </button>
      </div>

      <div className={styles.topControls}>
        <label htmlFor="completion-language">Language
          <select id="completion-language" value={language}
            onChange={(event) => setLanguage(event.target.value as CatalogLanguage)}>
            {LANGUAGES.map((item) =>
              <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </label>
        <div className={styles.summary}>
          <div><strong>{ownedSetTotal}</strong><span>Recognized sets with your cards</span></div>
          <div><strong>{ownedSetCounts.size}</strong><span>Your recorded set IDs</span></div>
          <div><strong>{ownedCards.filter((card) =>
            (card.game ?? "pokemon") === "pokemon" &&
            (card.language ?? "English") === getLanguageLabel(language)
          ).reduce((sum, card) => sum + Math.max(0, card.quantity), 0)}</strong>
            <span>Physical card copies in this language</span></div>
        </div>
      </div>

      {unindexedSetIds.length > 0 && !loadingSets && (
        <p className={styles.notice}>
          {unindexedSetIds.length} set{unindexedSetIds.length === 1 ? "" : "s"} in
          your collection still need a source checklist. Your cards remain recognized and
          searchable by set, but completion percentages require a complete provider list.
        </p>
      )}

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <h2>Choose an expansion</h2>
          <div className={styles.switches}>
            <button type="button" className={setFilter === "mine" ? styles.active : ""}
              onClick={() => setSetFilter("mine")}>My sets</button>
            <button type="button" className={setFilter === "all" ? styles.active : ""}
              onClick={() => setSetFilter("all")}>All sets</button>
          </div>
          <input className={styles.search} aria-label="Find expansion" value={setQuery}
            onChange={(event) => setSetQuery(event.target.value)}
            placeholder="Find a set…" />
          {loadingSets && <p className={styles.muted} role="status">Loading catalogue…</p>}
          {setError && <p className={styles.error} role="alert">{setError}</p>}
          {!loadingSets && !visibleSets.length && (
            <p className={styles.muted}>{setFilter === "mine"
              ? "No matched sets yet. Scan a Pokémon card, or choose All sets to explore."
              : "No expansions match your search."}</p>
          )}
          <div className={styles.sets}>
            {visibleSets.map((set) => {
              const owned = ownedSetCounts.get(set.id);
              return (
                <button type="button" key={set.id}
                  className={selectedId === set.id ? styles.selectedSet : styles.set}
                  onClick={() => void loadSet(set)}>
                  <strong>{set.name}</strong>
                  <small>{set.id} · {unindexedSetIds.includes(set.id)
                    ? "Collection recognized · source checklist pending"
                    : set.cardCount.total + " indexed cards"}</small>
                  {owned && <span>{owned.ids.size} recorded identities · {owned.copies} copies</span>}
                </button>
              );
            })}
          </div>
        </aside>

        <div className={styles.content}>
          {loadingSet && <p className={styles.muted} role="status">Comparing your cards with this set…</p>}
          {detailError && <p className={styles.notice} role="status">
            Source checklist unavailable: {detailError} Your owned records are shown below,
            but no completion percentage is calculated without an authoritative checklist.
          </p>}
          {ownedOnlySet && (
            <div className={styles.selectedHeader}>
              <div><span className={styles.eyebrow}>YOUR CARDS · CHECKLIST PENDING</span>
                <h2>{ownedOnlySet.name}</h2>
                <p className={styles.muted}>{ownedOnlyCards.length} recorded card entries.
                  Your 30th Celebration cards remain identified by their original set IDs.</p>
              </div>
              <button type="button" className={styles.download}
                onClick={() => void loadSet(ownedOnlySet)}>Retry checklist</button>
              <div className={styles.cards}>
                {ownedOnlyCards.map((card) => (
                  <article key={card.id} className={styles.ownedCard}>
                    {card.image ? <img loading="lazy" alt={card.name}
                      src={cardImage(card.image, "low") || undefined} /> : null}
                    <strong>{card.name}</strong>
                    <small>#{card.localId} · {card.quantity} owned</small>
                  </article>
                ))}
              </div>
            </div>
          )}
          {!selectedSet && !ownedOnlySet && !loadingSet && !detailError && (
            <div className={styles.empty}>
              <h2>See exactly what you own and what you need</h2>
              <p>Choose a set to get an automatically calculated checklist,
                quantity counts and missing-card list.</p>
            </div>
          )}
          {selectedSet && completion && (
            <>
              <div className={styles.selectedHeader}>
                <div><span className={styles.eyebrow}>POKÉMON TCG · {getLanguageLabel(language)}</span>
                  <h2>{selectedSet.name}</h2>
                  <p className={styles.muted}>{selectedSet.cards.length} source card entries.
                    Variant/finish master-set completion is not yet tracked.</p>
                </div>
                <button type="button" className={styles.download} disabled={!completion.missing}
                  onClick={() => safeDownload(csvForMissingCards(completion, selectedSet.name),
                    "cardory-missing-" + language + "-" + selectedSet.id + ".csv")}>
                  Download missing cards CSV
                </button>
              </div>
              <div className={styles.metrics}>
                <div><strong>{completion.uniqueOwned}/{completion.total}</strong><span>Different cards owned</span></div>
                <div><strong>{completion.missing}</strong><span>Still missing</span></div>
                <div><strong>{completion.duplicates}</strong><span>Extra copies</span></div>
                <div><strong>{completion.percent}%</strong><span>Indexed set completion</span></div>
              </div>
              <div className={styles.progress} role="progressbar"
                aria-label="Set completion" aria-valuenow={completion.percent}
                aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: completion.percent + "%" }} />
              </div>
              {completion.unmatchedOwnedRecords > 0 && (
                <p className={styles.notice}>{completion.unmatchedOwnedRecords} of your
                  inventory records reference this set but do not match a catalogue card ID.
                  They remain in My Cards and are excluded from the checklist.</p>
              )}
              <div className={styles.cardControls}>
                <div className={styles.switches} aria-label="Filter owned and missing cards">
                  {(["all", "missing", "owned", "duplicates"] as const).map((value) => (
                    <button type="button" key={value}
                      className={cardFilter === value ? styles.active : ""}
                      onClick={() => setCardFilter(value)}>
                      {value === "all" ? "All" : value === "owned" ? "Owned" :
                        value === "missing" ? "Missing" : "Duplicates"}
                    </button>
                  ))}
                </div>
                <input className={styles.search} value={cardQuery}
                  aria-label="Search cards in selected set"
                  onChange={(event) => setCardQuery(event.target.value)}
                  placeholder="Search name or number" />
              </div>
              <p className={styles.muted}>{displayed.length} cards shown</p>
              <div className={styles.cards}>
                {displayed.map((entry) => (
                  <article key={entry.card.id}
                    className={entry.quantity ? styles.ownedCard : styles.missingCard}>
                    {entry.card.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img loading="lazy" alt={entry.card.name}
                        src={cardImage(entry.card.image, "low") || undefined} />
                    ) : <div className={styles.noImage}>Image unavailable</div>}
                    <strong>{entry.card.name}</strong>
                    <small>#{entry.card.localId}</small>
                    <span className={entry.quantity ? styles.have : styles.need}>
                      {entry.quantity ? "Owned · " + entry.quantity : "Missing"}
                    </span>
                    {entry.duplicateCopies > 0 &&
                      <span className={styles.extra}>+{entry.duplicateCopies} extra</span>}
                  </article>
                ))}
              </div>
              {displayed.length === 0 && <p className={styles.muted}>No cards match this filter.</p>}
            </>
          )}
        </div>
      </div>
      <p className={styles.footnote}>Checklist sources: TCGdex and selected TCGplayer sets via TCGCSV. Cards are matched by
        exact provider ID and language, not by name. Your owned-card records are
        read directly from Cardory&apos;s existing collection state. Artwork is
        referenced from the provider, not downloaded into Cardory.</p>
    </section>
  );
}
