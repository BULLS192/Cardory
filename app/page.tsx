"use client";

import {
  BookOpen,
  Check,
  ChevronRight,
  CircleDollarSign,
  Grid2X2,
  Heart,
  LayoutDashboard,
  List,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tags,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AcquisitionType,
  Binder,
  CardCondition,
  CardSearchResult,
  CardVariant,
  CollectionState,
  OwnedCard,
  SmartRule,
  SmartRuleField,
  SmartRuleOperator,
  TcgDexCard,
} from "@/lib/types";
import { availableVariants, cardImage, extractMarketPrice, isPriceStale } from "@/lib/tcgdex";

const STORAGE_KEY = "pokedex-vault-v1";

const emptyState: CollectionState = {
  cards: [],
  binders: [],
  lastGlobalPriceSync: null,
};

type Tab = "dashboard" | "cards" | "binders" | "add";

function id() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function money(value?: number | null) {
  return typeof value === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
    : "—";
}

function normalizeTag(tag: string) {
  return tag
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function allCardTags(card: Pick<OwnedCard, "tags" | "smartTags">) {
  return [...new Set([...(card.smartTags ?? []), ...(card.tags ?? [])])];
}

function buildSmartTags(input: {
  name?: string;
  setName?: string;
  rarity?: string | null;
  illustrator?: string | null;
  types?: string[];
  variant?: CardVariant;
  condition?: CardCondition;
  favorite?: boolean;
  marketPrice?: number | null;
  acquisitionType?: string;
  product?: string;
}) {
  const tags = new Set<string>();
  const add = (prefix: string, value?: string | null) => {
    if (!value) return;
    const normalized = normalizeTag(value);
    if (normalized) tags.add(prefix ? `${prefix}-${normalized}` : normalized);
  };

  add("", input.name);
  add("set", input.setName);
  add("rarity", input.rarity);
  add("artist", input.illustrator);
  input.types?.forEach((type) => add("type", type));
  if (input.variant) add("variant", labelVariant(input.variant));
  if (input.condition) add("condition", input.condition);
  if (input.favorite) tags.add("favorite");
  if (input.acquisitionType) add("source", input.acquisitionType);
  if (input.product) add("product", input.product);

  const value = input.marketPrice ?? 0;
  if (value >= 100) tags.add("value-100-plus");
  else if (value >= 50) tags.add("value-50-plus");
  else if (value >= 20) tags.add("value-20-plus");
  else if (value >= 5) tags.add("value-5-plus");

  return [...tags].sort();
}

function labelVariant(variant: CardVariant) {
  return variant
    .replace("reverse-holofoil", "Reverse Holo")
    .replace("1st-edition-holofoil", "1st Ed. Holo")
    .replace("1st-edition", "1st Edition")
    .replace("unlimited-holofoil", "Unlimited Holo")
    .replace("holofoil", "Holo")
    .replace("normal", "Normal")
    .replace("unlimited", "Unlimited");
}

function evaluateRule(card: OwnedCard, rule: SmartRule) {
  let candidate: string | number | boolean = "";
  if (rule.field === "tag") candidate = allCardTags(card).join(" ");
  if (rule.field === "name") candidate = card.name;
  if (rule.field === "set") candidate = card.setName ?? "";
  if (rule.field === "rarity") candidate = card.rarity ?? "";
  if (rule.field === "condition") candidate = card.condition;
  if (rule.field === "favorite") candidate = card.favorite;
  if (rule.field === "marketPrice") candidate = card.marketPrice ?? 0;

  const value = rule.value.trim();

  if (rule.field === "favorite") {
    return candidate === (value === "true");
  }

  if (rule.field === "marketPrice") {
    const a = Number(candidate);
    const b = Number(value);
    if (Number.isNaN(b)) return false;
    if (rule.operator === "gt") return a > b;
    if (rule.operator === "gte") return a >= b;
    if (rule.operator === "lt") return a < b;
    if (rule.operator === "lte") return a <= b;
    return a === b;
  }

  const a = String(candidate).toLowerCase();
  const b = value.toLowerCase();
  if (rule.operator === "contains") return a.includes(b);
  return a === b;
}

function binderCards(binder: Binder, cards: OwnedCard[]) {
  if (binder.kind === "manual") {
    const set = new Set(binder.cardIds);
    return cards.filter((card) => set.has(card.id));
  }
  if (!binder.rules.length) return [];
  return cards.filter((card) => {
    const matches = binder.rules.map((rule) => evaluateRule(card, rule));
    return binder.match === "all" ? matches.every(Boolean) : matches.some(Boolean);
  });
}

function CardArt({ card, compact = false }: { card: OwnedCard; compact?: boolean }) {
  const src = cardImage(card.image, compact ? "low" : "high");
  return src ? (
    <img src={src} alt={card.name} className="card-art" loading="lazy" />
  ) : (
    <div className="missing-art">No image</div>
  );
}

export default function Home() {
  const [state, setState] = useState<CollectionState>(emptyState);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [view, setView] = useState<"gallery" | "list">("gallery");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState<"added" | "name" | "value" | "set">("added");
  const [syncing, setSyncing] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setState(JSON.parse(saved));
    } catch {
      // A malformed local cache should never block the collection UI.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, ready]);

  useEffect(() => {
    if (!ready || !state.cards.length) return;
    const hasMissingPrices = state.cards.some((card) => card.marketPrice == null);
    if (!hasMissingPrices && !isPriceStale(state.lastGlobalPriceSync, 6)) return;
    void syncPrices(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const totalCards = state.cards.reduce((sum, card) => sum + card.quantity, 0);
  const collectionValue = state.cards.reduce(
    (sum, card) => sum + (card.marketPrice ?? 0) * card.quantity,
    0
  );

  const allTags = useMemo(
    () => [...new Set(state.cards.flatMap((card) => allCardTags(card)))].sort(),
    [state.cards]
  );

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    let cards = state.cards.filter((card) => {
      const haystack = [
        card.name,
        card.setName,
        card.localId,
        card.rarity,
        allCardTags(card).join(" "),
        card.acquisition?.batchName,
        card.acquisition?.product,
        card.acquisition?.location,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (!q || haystack.includes(q)) && (!tagFilter || allCardTags(card).includes(tagFilter));
    });

    cards = [...cards].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "value") return (b.marketPrice ?? 0) - (a.marketPrice ?? 0);
      if (sort === "set") return (a.setName ?? "").localeCompare(b.setName ?? "");
      return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
    });
    return cards;
  }, [state.cards, search, tagFilter, sort]);

  async function syncPrices(force = true) {
    if (!state.cards.length || syncing) return;
    const hasMissingPrices = state.cards.some((card) => card.marketPrice == null);
    if (!force && !hasMissingPrices && !isPriceStale(state.lastGlobalPriceSync, 6)) return;

    setSyncing(true);
    try {
      const ids = [...new Set(state.cards.map((card) => card.tcgdexId))];
      const details = new Map<string, TcgDexCard>();

      for (let i = 0; i < ids.length; i += 8) {
        const batch = ids.slice(i, i + 8);
        const responses = await Promise.all(
          batch.map(async (cardId) => {
            const response = await fetch(`/api/cards/${encodeURIComponent(cardId)}`);
            if (!response.ok) return null;
            return (await response.json()) as TcgDexCard;
          })
        );
        responses.filter(Boolean).forEach((detail) => {
          const card = detail as TcgDexCard;
          details.set(card.id, card);
        });
        if (i + 8 < ids.length) await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const syncedAt = new Date().toISOString();
      setState((current) => ({
        ...current,
        lastGlobalPriceSync: syncedAt,
        cards: current.cards.map((owned) => {
          const detail = details.get(owned.tcgdexId);
          if (!detail) return owned;
          const price = extractMarketPrice(detail, owned.variant);
          const marketPrice = price.price;
          return {
            ...owned,
            marketPrice,
            priceSource: price.source,
            priceUpdatedAt: price.updatedAt ?? syncedAt,
            smartTags: buildSmartTags({
              name: owned.name,
              setName: owned.setName,
              rarity: owned.rarity,
              illustrator: owned.illustrator,
              types: owned.types,
              variant: owned.variant,
              condition: owned.condition,
              favorite: owned.favorite,
              marketPrice,
              acquisitionType: owned.acquisition?.type,
              product: owned.acquisition?.product,
            }),
          };
        }),
      }));
    } finally {
      setSyncing(false);
    }
  }

  function toggleFavorite(cardId: string) {
    setState((current) => ({
      ...current,
      cards: current.cards.map((card) =>
        card.id === cardId
          ? {
              ...card,
              favorite: !card.favorite,
              smartTags: buildSmartTags({
                name: card.name,
                setName: card.setName,
                rarity: card.rarity,
                illustrator: card.illustrator,
                types: card.types,
                variant: card.variant,
                condition: card.condition,
                favorite: !card.favorite,
                marketPrice: card.marketPrice,
                acquisitionType: card.acquisition?.type,
                product: card.acquisition?.product,
              }),
            }
          : card
      ),
    }));
  }

  function removeCard(cardId: string) {
    setState((current) => ({
      ...current,
      cards: current.cards.filter((card) => card.id !== cardId),
      binders: current.binders.map((binder) => ({
        ...binder,
        cardIds: binder.cardIds.filter((id) => id !== cardId),
      })),
    }));
    setSelectedCardIds((current) => current.filter((id) => id !== cardId));
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={20} /></div>
          <div>
            <strong>Pokédex Vault</strong>
            <span>Digital Binder</span>
          </div>
        </div>

        <nav>
          <NavButton active={tab === "dashboard"} onClick={() => setTab("dashboard")} icon={<LayoutDashboard size={18} />} label="Dashboard" />
          <NavButton active={tab === "cards"} onClick={() => setTab("cards")} icon={<Grid2X2 size={18} />} label="My Cards" count={state.cards.length} />
          <NavButton active={tab === "binders"} onClick={() => setTab("binders")} icon={<BookOpen size={18} />} label="Binders" count={state.binders.length} />
          <NavButton active={tab === "add"} onClick={() => setTab("add")} icon={<Plus size={18} />} label="Add Card" emphasize />
        </nav>

        <div className="sidebar-footer">
          <div className="sync-status">
            <span className={isPriceStale(state.lastGlobalPriceSync, 6) ? "dot stale" : "dot"} />
            <div>
              <strong>Market data</strong>
              <span>
                {state.lastGlobalPriceSync
                  ? `Synced ${new Date(state.lastGlobalPriceSync).toLocaleString()}`
                  : "Not synced yet"}
              </span>
            </div>
          </div>
          <button className="ghost full" onClick={() => void syncPrices(true)} disabled={syncing || !state.cards.length}>
            <RefreshCw size={15} className={syncing ? "spin" : ""} />
            {syncing ? "Syncing prices…" : "Sync prices now"}
          </button>
        </div>
      </aside>

      <section className="content">
        {tab === "dashboard" && (
          <Dashboard
            cards={state.cards}
            binders={state.binders}
            totalCards={totalCards}
            collectionValue={collectionValue}
            onAdd={() => setTab("add")}
            onCards={() => setTab("cards")}
          />
        )}

        {tab === "cards" && (
          <section>
            <PageHeader
              eyebrow="Collection"
              title="My Cards"
              description="One master library. Organize it in as many different ways as you want."
              action={<button className="primary" onClick={() => setTab("add")}><Plus size={17} /> Add card</button>}
            />

            <div className="toolbar">
              <label className="searchbox">
                <Search size={17} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cards, sets, numbers or tags…" />
              </label>
              <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                <option value="">All tags</option>
                {allTags.map((tag) => <option value={tag} key={tag}>#{tag}</option>)}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="added">Recently added</option>
                <option value="name">Name A–Z</option>
                <option value="value">Market value</option>
                <option value="set">Set</option>
              </select>
              <div className="segmented">
                <button className={view === "gallery" ? "active" : ""} onClick={() => setView("gallery")}><Grid2X2 size={16} /></button>
                <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={16} /></button>
              </div>
            </div>

            {!!filteredCards.length && (
              <div className="selection-tools">
                <label>
                  <input
                    type="checkbox"
                    checked={filteredCards.length > 0 && filteredCards.every((card) => selectedCardIds.includes(card.id))}
                    onChange={(e) =>
                      setSelectedCardIds(
                        e.target.checked
                          ? [...new Set([...selectedCardIds, ...filteredCards.map((card) => card.id)])]
                          : selectedCardIds.filter((id) => !filteredCards.some((card) => card.id === id))
                      )
                    }
                  />
                  Select all shown
                </label>
                <span>{selectedCardIds.length} selected</span>
                {!!selectedCardIds.length && <button className="text-button" onClick={() => setSelectedCardIds([])}>Clear selection</button>}
              </div>
            )}

            {!!selectedCardIds.length && (
              <BulkEditPanel
                count={selectedCardIds.length}
                onApply={(update) => {
                  setState((current) => ({
                    ...current,
                    cards: current.cards.map((card) => selectedCardIds.includes(card.id) ? update(card) : card),
                  }));
                }}
              />
            )}

            {!filteredCards.length ? (
              <Empty title="No cards found" body={state.cards.length ? "Try changing your filters." : "Add your first card to start the vault."} action={() => setTab("add")} />
            ) : view === "gallery" ? (
              <div className="card-grid">
                {filteredCards.map((card) => (
                  <article className={`collection-card ${selectedCardIds.includes(card.id) ? "selected" : ""}`} key={card.id}>
                    <label className="select-card">
                      <input
                        type="checkbox"
                        checked={selectedCardIds.includes(card.id)}
                        onChange={(e) =>
                          setSelectedCardIds((current) =>
                            e.target.checked ? [...current, card.id] : current.filter((id) => id !== card.id)
                          )
                        }
                      />
                    </label>
                    <button className={"favorite " + (card.favorite ? "on" : "")} onClick={() => toggleFavorite(card.id)} aria-label="Toggle favorite">
                      <Heart size={17} fill={card.favorite ? "currentColor" : "none"} />
                    </button>
                    <CardArt card={card} />
                    <div className="collection-card-body">
                      <div className="card-title-row">
                        <div>
                          <strong>{card.name}</strong>
                          <span>{card.setName ?? "Unknown set"} · #{card.localId}</span>
                        </div>
                        <b>{money(card.marketPrice)}</b>
                      </div>
                      <div className="chips">
                        <span className="chip neutral">{labelVariant(card.variant)}</span>
                        <span className="chip neutral">{card.condition}</span>
                        {card.quantity > 1 && <span className="chip neutral">×{card.quantity}</span>}
                      </div>
                      {!!allCardTags(card).length && (
                        <div className="tags">{allCardTags(card).slice(0, 6).map((tag) => <span key={tag}>#{tag}</span>)}</div>
                      )}
                      {card.acquisition && (card.acquisition.product || card.acquisition.location || card.acquisition.date) && (
                        <div className="acquisition-line">
                          {[card.acquisition.product, card.acquisition.date, card.acquisition.location].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      <button className="danger-link" onClick={() => removeCard(card.id)}><Trash2 size={14} /> Remove</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Select</th><th>Card</th><th>Set</th><th>Variant</th><th>Tags</th><th>Qty</th><th>Market</th><th /></tr></thead>
                  <tbody>
                    {filteredCards.map((card) => (
                      <tr key={card.id} className={selectedCardIds.includes(card.id) ? "selected-row" : ""}>
                        <td><input type="checkbox" checked={selectedCardIds.includes(card.id)} onChange={(e) => setSelectedCardIds((current) => e.target.checked ? [...current, card.id] : current.filter((id) => id !== card.id))} /></td>
                        <td><div className="table-card"><CardArt card={card} compact /><div><strong>{card.name}</strong><span>#{card.localId} · {card.rarity ?? "—"}</span></div></div></td>
                        <td>{card.setName ?? "—"}</td>
                        <td>{labelVariant(card.variant)} · {card.condition}</td>
                        <td><div className="tags">{allCardTags(card).slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}</div></td>
                        <td>{card.quantity}</td>
                        <td><strong>{money(card.marketPrice)}</strong></td>
                        <td><button className="icon-button" onClick={() => toggleFavorite(card.id)}><Star size={16} fill={card.favorite ? "currentColor" : "none"} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "binders" && (
          <BindersView
            cards={state.cards}
            binders={state.binders}
            onChange={(binders) => setState((current) => ({ ...current, binders }))}
          />
        )}

        {tab === "add" && (
          <AddCard
            onAdd={(card) => {
              setState((current) => ({ ...current, cards: [card, ...current.cards] }));
              setTab("cards");
            }}
          />
        )}
      </section>
    </main>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
  count,
  emphasize,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  emphasize?: boolean;
}) {
  return (
    <button className={`nav-button ${active ? "active" : ""} ${emphasize ? "emphasize" : ""}`} onClick={onClick}>
      {icon}<span>{label}</span>{typeof count === "number" && <b>{count}</b>}
    </button>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

function Dashboard({
  cards,
  binders,
  totalCards,
  collectionValue,
  onAdd,
  onCards,
}: {
  cards: OwnedCard[];
  binders: Binder[];
  totalCards: number;
  collectionValue: number;
  onAdd: () => void;
  onCards: () => void;
}) {
  const favorites = cards.filter((card) => card.favorite).length;
  const recent = cards.slice(0, 5);

  return (
    <section>
      <PageHeader
        eyebrow="Wave 1"
        title="Your collection, your rules."
        description="Build one master card library, then create unlimited manual or dynamic views of it."
        action={<button className="primary" onClick={onAdd}><Plus size={17} /> Add a card</button>}
      />

      <div className="stat-grid">
        <Stat icon={<Grid2X2 size={18} />} label="Unique cards" value={cards.length.toLocaleString()} />
        <Stat icon={<Tags size={18} />} label="Physical cards" value={totalCards.toLocaleString()} />
        <Stat icon={<CircleDollarSign size={18} />} label="Market value" value={money(collectionValue)} />
        <Stat icon={<BookOpen size={18} />} label="Binders" value={binders.length.toLocaleString()} />
      </div>

      <div className="dashboard-grid">
        <article className="panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Recent additions</span><h2>Latest cards</h2></div>
            <button className="text-button" onClick={onCards}>View all <ChevronRight size={15} /></button>
          </div>
          {!recent.length ? (
            <div className="mini-empty">Your first cards will appear here.</div>
          ) : (
            <div className="recent-list">
              {recent.map((card) => (
                <div className="recent-row" key={card.id}>
                  <CardArt card={card} compact />
                  <div><strong>{card.name}</strong><span>{card.setName} · #{card.localId}</span></div>
                  <b>{money(card.marketPrice)}</b>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel dark-panel">
          <span className="eyebrow">Dynamic organization</span>
          <h2>One card. Many binders.</h2>
          <p>A card can appear in a set binder, a Pikachu binder, your favorites and a high-value view at the same time—without duplicating the underlying record.</p>
          <div className="feature-pills">
            <span><Check size={14} /> Smart rules</span>
            <span><Check size={14} /> Custom tags</span>
            <span><Check size={14} /> Live values</span>
            <span><Check size={14} /> Manual order-ready data model</span>
          </div>
          <div className="favorite-count"><Heart size={17} /> {favorites} favorite{favorites === 1 ? "" : "s"}</div>
        </article>
      </div>
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <article className="stat"><div className="stat-icon">{icon}</div><span>{label}</span><strong>{value}</strong></article>;
}

function Empty({ title, body, action }: { title: string; body: string; action: () => void }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Sparkles size={22} /></div>
      <h2>{title}</h2><p>{body}</p>
      <button className="primary" onClick={action}><Plus size={17} /> Add card</button>
    </div>
  );
}

function AddCard({ onAdd }: { onAdd: (card: OwnedCard) => void }) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [selected, setSelected] = useState<TcgDexCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [variant, setVariant] = useState<CardVariant>("normal");
  const [condition, setCondition] = useState<CardCondition>("NM");
  const [quantity, setQuantity] = useState(1);
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [acquisitionType, setAcquisitionType] = useState<AcquisitionType>("pack");
  const [batchName, setBatchName] = useState("");
  const [product, setProduct] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseLocation, setPurchaseLocation] = useState("");
  const [seller, setSeller] = useState("");

  const pricing = selected ? extractMarketPrice(selected, variant) : null;
  const autoTags = selected
    ? buildSmartTags({
        name: selected.name,
        setName: selected.set?.name,
        rarity: selected.rarity,
        illustrator: selected.illustrator,
        types: selected.types,
        variant,
        condition,
        favorite,
        marketPrice: pricing?.price,
        acquisitionType,
        product,
      })
    : [];

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() && !number.trim()) return;
    setLoading(true);
    setSelected(null);
    try {
      const params = new URLSearchParams();
      if (name.trim()) params.set("name", name.trim());
      if (number.trim()) params.set("number", number.trim());
      const response = await fetch(`/api/cards/search?${params.toString()}`);
      const data = await response.json();
      setResults(data.results ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function selectCard(result: CardSearchResult) {
    setLoading(true);
    try {
      const response = await fetch(`/api/cards/${encodeURIComponent(result.id)}`);
      const card = (await response.json()) as TcgDexCard;
      setSelected(card);
      const variants = availableVariants(card);
      setVariant(variants[0] ?? "normal");
    } finally {
      setLoading(false);
    }
  }

  function save() {
    if (!selected) return;
    const owned: OwnedCard = {
      id: id(),
      tcgdexId: selected.id,
      name: selected.name,
      localId: String(selected.localId),
      image: selected.image,
      setId: selected.set?.id,
      setName: selected.set?.name,
      rarity: selected.rarity,
      illustrator: selected.illustrator,
      types: selected.types,
      variant,
      condition,
      quantity: Math.max(1, quantity),
      tags: [...new Set(tags.split(/[,\s]+/).map(normalizeTag).filter(Boolean))],
      smartTags: autoTags,
      notes: notes.trim(),
      acquisition: {
        type: acquisitionType,
        batchId: batchName.trim() || product.trim() || purchaseDate || purchaseLocation
          ? id()
          : undefined,
        batchName: batchName.trim() || undefined,
        product: product.trim() || undefined,
        totalCost: totalCost.trim() ? Number(totalCost) : null,
        currency: "USD",
        date: purchaseDate || undefined,
        location: purchaseLocation.trim() || undefined,
        seller: seller.trim() || undefined,
      },
      favorite,
      marketPrice: pricing?.price ?? null,
      priceSource: pricing?.source ?? null,
      priceUpdatedAt: pricing?.updatedAt ?? new Date().toISOString(),
      addedAt: new Date().toISOString(),
    };
    onAdd(owned);
  }

  return (
    <section>
      <PageHeader
        eyebrow="Manual entry"
        title="Add a card"
        description="Type the card name and/or number. We fetch the artwork, set data, metadata and current market price for you."
      />

      <div className="add-layout">
        <div>
          <form className="panel search-panel" onSubmit={runSearch}>
            <div className="form-grid two">
              <label><span>Card name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pikachu" /></label>
              <label><span>Card number</span><input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 173" /></label>
            </div>
            <button className="primary" type="submit" disabled={loading}><Search size={17} /> {loading ? "Searching…" : "Find card"}</button>
          </form>

          {!!results.length && !selected && (
            <div className="search-results">
              {results.map((result) => (
                <button className="search-result" key={result.id} onClick={() => void selectCard(result)}>
                  {result.image ? <img src={cardImage(result.image, "low") ?? ""} alt="" /> : <div className="result-placeholder" />}
                  <div><strong>{result.name}</strong><span>#{result.localId} · {result.setName ?? result.id}</span></div>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {!selected ? (
            <article className="panel preview-placeholder">
              <Sparkles size={26} />
              <h2>Card preview</h2>
              <p>Choose a catalogue match and its full metadata will appear here.</p>
            </article>
          ) : (
            <article className="panel add-preview">
              <div className="preview-top">
                {selected.image ? <img src={cardImage(selected.image, "high") ?? ""} alt={selected.name} /> : null}
                <div>
                  <span className="eyebrow">{selected.set?.name}</span>
                  <h2>{selected.name}</h2>
                  <p>#{selected.localId} · {selected.rarity ?? "Unknown rarity"}</p>
                  <div className="metadata">
                    {selected.types?.map((type) => <span key={type}>{type}</span>)}
                    {selected.illustrator && <span>Art: {selected.illustrator}</span>}
                  </div>
                  <div className="price-card">
                    <span>Current market</span>
                    <strong>{money(pricing?.price)}</strong>
                    <small>{pricing?.source ?? "No TCGplayer price available for this variant"}</small>
                  </div>
                </div>
              </div>

              <div className="form-grid two">
                <label><span>Variant</span>
                  <select value={variant} onChange={(e) => setVariant(e.target.value as CardVariant)}>
                    {availableVariants(selected).map((v) => <option key={v} value={v}>{labelVariant(v)}</option>)}
                  </select>
                </label>
                <label><span>Condition</span>
                  <select value={condition} onChange={(e) => setCondition(e.target.value as CardCondition)}>
                    <option value="NM">Near Mint</option><option value="LP">Lightly Played</option><option value="MP">Moderately Played</option><option value="HP">Heavily Played</option><option value="DMG">Damaged</option>
                  </select>
                </label>
                <label><span>Quantity</span><input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label>
                <label><span>Custom tags (optional)</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#personal-favorite #trade" /></label>
              </div>

              <div className="smart-tag-preview">
                <div>
                  <strong>Smart tags</strong>
                  <span>Generated automatically from the card, set, rarity, type, variant, condition and value.</span>
                </div>
                <div className="tags">{autoTags.slice(0, 10).map((tag) => <span key={tag}>#{tag}</span>)}</div>
              </div>

              <div className="acquisition-box">
                <div className="section-title">
                  <strong>Acquisition / opening data</strong>
                  <span>Use the same batch details on every card pulled from the same product.</span>
                </div>
                <div className="form-grid two">
                  <label><span>How acquired</span>
                    <select value={acquisitionType} onChange={(e) => setAcquisitionType(e.target.value as AcquisitionType)}>
                      <option value="pack">Pulled from pack / box</option>
                      <option value="single">Bought as single</option>
                      <option value="sealed">Sealed product</option>
                      <option value="trade">Trade</option>
                      <option value="gift">Gift</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label><span>Batch / opening name</span><input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="30th Anniversary box #1" /></label>
                  <label><span>Product</span><input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Booster pack, ETB, booster box…" /></label>
                  <label><span>Total paid for product / batch (USD)</span><input type="number" min="0" step="0.01" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} placeholder="0.00" /></label>
                  <label><span>Date bought / opened</span><input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></label>
                  <label><span>Location bought</span><input value={purchaseLocation} onChange={(e) => setPurchaseLocation(e.target.value)} placeholder="Store, city, event, website…" /></label>
                  <label><span>Seller / store</span><input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="Optional" /></label>
                </div>
              </div>

              <label className="block-label"><span>Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything unique about this pull or copy…" /></label>
              <label className="check-label"><input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} /> Add to favorites</label>
              <div className="form-actions">
                <button className="ghost" onClick={() => setSelected(null)}>Back to results</button>
                <button className="primary" onClick={save}><Check size={17} /> Add to my cards</button>
              </div>
            </article>
          )}
        </div>
      </div>
    </section>
  );
}

function BulkEditPanel({
  count,
  onApply,
}: {
  count: number;
  onApply: (update: (card: OwnedCard) => OwnedCard) => void;
}) {
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [acquisitionType, setAcquisitionType] = useState<AcquisitionType>("pack");
  const [batchName, setBatchName] = useState("");
  const [product, setProduct] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseLocation, setPurchaseLocation] = useState("");
  const [seller, setSeller] = useState("");

  function apply() {
    const customTags = tags.split(/[,\s]+/).map(normalizeTag).filter(Boolean);
    const hasAcquisition =
      !!batchName.trim() ||
      !!product.trim() ||
      !!totalCost.trim() ||
      !!purchaseDate ||
      !!purchaseLocation.trim() ||
      !!seller.trim();

    const sharedBatchId = hasAcquisition ? id() : undefined;

    onApply((card) => {
      const acquisition = hasAcquisition
        ? {
            ...(card.acquisition ?? {}),
            type: acquisitionType,
            batchId: sharedBatchId,
            batchName: batchName.trim() || card.acquisition?.batchName,
            product: product.trim() || card.acquisition?.product,
            totalCost: totalCost.trim() ? Number(totalCost) : card.acquisition?.totalCost ?? null,
            currency: "USD",
            date: purchaseDate || card.acquisition?.date,
            location: purchaseLocation.trim() || card.acquisition?.location,
            seller: seller.trim() || card.acquisition?.seller,
          }
        : card.acquisition;

      const nextTags = [...new Set([...(card.tags ?? []), ...customTags])];
      const nextNotes = note.trim()
        ? [card.notes?.trim(), note.trim()].filter(Boolean).join("\n")
        : card.notes;

      return {
        ...card,
        tags: nextTags,
        notes: nextNotes,
        acquisition,
        smartTags: buildSmartTags({
          name: card.name,
          setName: card.setName,
          rarity: card.rarity,
          illustrator: card.illustrator,
          types: card.types,
          variant: card.variant,
          condition: card.condition,
          favorite: card.favorite,
          marketPrice: card.marketPrice,
          acquisitionType: acquisition?.type,
          product: acquisition?.product,
        }),
      };
    });

    setNote("");
    setTags("");
  }

  return (
    <article className="panel bulk-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Bulk edit</span>
          <h2>{count} card{count === 1 ? "" : "s"} selected</h2>
        </div>
      </div>

      <div className="form-grid two">
        <label><span>Add note to all selected</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pulled from the same booster opening…" /></label>
        <label><span>Add custom tags</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#opening-night #keep" /></label>
        <label><span>How acquired</span>
          <select value={acquisitionType} onChange={(e) => setAcquisitionType(e.target.value as AcquisitionType)}>
            <option value="pack">Pulled from pack / box</option>
            <option value="single">Bought as single</option>
            <option value="sealed">Sealed product</option>
            <option value="trade">Trade</option>
            <option value="gift">Gift</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label><span>Batch / opening name</span><input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="30th Anniversary box #1" /></label>
        <label><span>Product</span><input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Booster box / ETB / pack" /></label>
        <label><span>Total paid for this batch (USD)</span><input type="number" min="0" step="0.01" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} placeholder="0.00" /></label>
        <label><span>Date bought / opened</span><input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></label>
        <label><span>Location bought</span><input value={purchaseLocation} onChange={(e) => setPurchaseLocation(e.target.value)} placeholder="Store, city, event, website…" /></label>
        <label><span>Seller / store</span><input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="Optional" /></label>
      </div>

      <p className="bulk-help">
        Batch cost is stored as shared opening metadata, not as the purchase price of every individual card. That lets us calculate pack/box ROI correctly later.
      </p>

      <div className="form-actions">
        <button className="primary" onClick={apply}><Check size={17} /> Apply to selected</button>
      </div>
    </article>
  );
}

function BindersView({
  cards,
  binders,
  onChange,
}: {
  cards: OwnedCard[];
  binders: Binder[];
  onChange: (binders: Binder[]) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(binders[0]?.id ?? null);
  const active = binders.find((binder) => binder.id === activeId) ?? binders[0] ?? null;
  const visibleCards = active ? binderCards(active, cards) : [];

  return (
    <section>
      <PageHeader
        eyebrow="Flexible organization"
        title="Binders"
        description="Manual binders contain cards you choose. Smart binders rebuild themselves automatically from rules."
        action={<button className="primary" onClick={() => setShowCreate((v) => !v)}><Plus size={17} /> New binder</button>}
      />

      {showCreate && (
        <CreateBinder
          cards={cards}
          onCancel={() => setShowCreate(false)}
          onCreate={(binder) => {
            onChange([binder, ...binders]);
            setActiveId(binder.id);
            setShowCreate(false);
          }}
        />
      )}

      {!binders.length ? (
        <div className="empty binder-empty">
          <div className="empty-icon"><BookOpen size={22} /></div>
          <h2>No binders yet</h2>
          <p>Create a manual binder or a smart binder driven by a rule such as tag = pikachu or market value &gt; 50.</p>
          <button className="primary" onClick={() => setShowCreate(true)}><Plus size={17} /> Create binder</button>
        </div>
      ) : (
        <div className="binder-layout">
          <aside className="binder-list">
            {binders.map((binder) => {
              const count = binderCards(binder, cards).length;
              return (
                <button key={binder.id} className={active?.id === binder.id ? "active" : ""} onClick={() => setActiveId(binder.id)}>
                  <div className="binder-icon">{binder.kind === "smart" ? <Sparkles size={16} /> : <BookOpen size={16} />}</div>
                  <div><strong>{binder.name}</strong><span>{binder.kind === "smart" ? "Smart binder" : "Manual binder"} · {count} cards</span></div>
                  <ChevronRight size={16} />
                </button>
              );
            })}
          </aside>

          {active && (
            <article className="binder-view">
              <div className="binder-hero">
                <div>
                  <span className="eyebrow">{active.kind === "smart" ? "Smart binder" : "Manual binder"}</span>
                  <h2>{active.name}</h2>
                  <p>{active.description || (active.kind === "smart" ? "Updates automatically when cards match its rule." : "A hand-picked view of your master collection.")}</p>
                </div>
                <button className="danger-link" onClick={() => {
                  onChange(binders.filter((binder) => binder.id !== active.id));
                  setActiveId(null);
                }}><Trash2 size={15} /> Delete binder</button>
              </div>

              {active.kind === "smart" && (
                <div className="rules">
                  <SlidersHorizontal size={15} />
                  {active.rules.map((rule, index) => (
                    <span key={index}>{rule.field} {rule.operator} “{rule.value}”</span>
                  ))}
                </div>
              )}

              {!visibleCards.length ? (
                <div className="mini-empty">No cards currently match this binder.</div>
              ) : (
                <div className="binder-card-grid">
                  {visibleCards.map((card) => (
                    <div key={card.id} className="binder-card">
                      <CardArt card={card} compact />
                      <strong>{card.name}</strong>
                      <span>{card.setName} · #{card.localId}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          )}
        </div>
      )}
    </section>
  );
}

function CreateBinder({
  cards,
  onCreate,
  onCancel,
}: {
  cards: OwnedCard[];
  onCreate: (binder: Binder) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"manual" | "smart">("smart");
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [field, setField] = useState<SmartRuleField>("tag");
  const [operator, setOperator] = useState<SmartRuleOperator>("contains");
  const [value, setValue] = useState("");

  const numeric = field === "marketPrice";

  useEffect(() => {
    if (numeric && !["gt", "gte", "lt", "lte", "equals"].includes(operator)) setOperator("gte");
    if (!numeric && !["contains", "equals"].includes(operator)) setOperator("contains");
    if (field === "favorite") {
      setOperator("equals");
      if (!["true", "false"].includes(value)) setValue("true");
    }
  }, [field, numeric, operator, value]);

  function create() {
    if (!name.trim()) return;
    const rules: SmartRule[] =
      kind === "smart" ? [{ field, operator, value: field === "favorite" ? value || "true" : value.trim() }] : [];
    onCreate({
      id: id(),
      name: name.trim(),
      description: description.trim(),
      kind,
      cardIds: kind === "manual" ? selectedCards : [],
      rules,
      match: "all",
      createdAt: new Date().toISOString(),
    });
  }

  return (
    <article className="panel create-binder">
      <div className="panel-heading"><div><span className="eyebrow">New binder</span><h2>Choose how it behaves</h2></div></div>
      <div className="kind-switch">
        <button className={kind === "smart" ? "active" : ""} onClick={() => setKind("smart")}><Sparkles size={16} /><strong>Smart</strong><span>Rule-driven and automatic</span></button>
        <button className={kind === "manual" ? "active" : ""} onClick={() => setKind("manual")}><BookOpen size={16} /><strong>Manual</strong><span>You choose the cards</span></button>
      </div>
      <div className="form-grid two">
        <label><span>Binder name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pikachu Collection" /></label>
        <label><span>Description</span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" /></label>
      </div>

      {kind === "smart" ? (
        <div className="rule-builder">
          <label><span>Field</span>
            <select value={field} onChange={(e) => setField(e.target.value as SmartRuleField)}>
              <option value="tag">Tag</option><option value="name">Card name</option><option value="set">Set</option><option value="rarity">Rarity</option><option value="condition">Condition</option><option value="favorite">Favorite</option><option value="marketPrice">Market value</option>
            </select>
          </label>
          <label><span>Operator</span>
            <select value={operator} onChange={(e) => setOperator(e.target.value as SmartRuleOperator)}>
              {numeric ? <><option value="gte">≥</option><option value="gt">&gt;</option><option value="lte">≤</option><option value="lt">&lt;</option><option value="equals">=</option></> : <><option value="contains">contains</option><option value="equals">equals</option></>}
            </select>
          </label>
          <label><span>Value</span>
            {field === "favorite" ? (
              <select value={value || "true"} onChange={(e) => setValue(e.target.value)}><option value="true">Yes</option><option value="false">No</option></select>
            ) : (
              <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={numeric ? "50" : field === "tag" ? "pikachu" : "Value"} />
            )}
          </label>
        </div>
      ) : (
        <div className="manual-picker">
          {!cards.length ? <div className="mini-empty">Add cards to your collection first.</div> : cards.map((card) => (
            <label key={card.id}>
              <input type="checkbox" checked={selectedCards.includes(card.id)} onChange={(e) => setSelectedCards((current) => e.target.checked ? [...current, card.id] : current.filter((id) => id !== card.id))} />
              <CardArt card={card} compact />
              <span><strong>{card.name}</strong><small>{card.setName} · #{card.localId}</small></span>
            </label>
          ))}
        </div>
      )}

      <div className="form-actions"><button className="ghost" onClick={onCancel}>Cancel</button><button className="primary" onClick={create}><Check size={17} /> Create binder</button></div>
    </article>
  );
}
