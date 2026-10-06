import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AcquisitionRecord,
  Binder,
  CardCondition,
  CardGame,
  CardLanguage,
  CardVariant,
  CollectionState,
  OwnedCard,
  SmartRule,
} from "@/lib/types";

type CollectionRow = {
  id: string;
  last_price_sync_at: string | null;
};

type BatchRow = {
  id: string;
  client_key: string | null;
  acquisition_type: AcquisitionRecord["type"] | null;
  batch_name: string | null;
  product: string | null;
  total_cost: number | string | null;
  currency: string | null;
  purchase_date: string | null;
  purchase_location: string | null;
  seller: string | null;
};

type CardRow = {
  id: string;
  acquisition_batch_id: string | null;
  provider_card_id: string;
  game: CardGame;
  language: CardLanguage;
  name: string;
  local_id: string;
  image_url: string | null;
  set_id: string | null;
  set_name: string | null;
  rarity: string | null;
  illustrator: string | null;
  types: string[] | null;
  variant: CardVariant;
  condition: CardCondition;
  quantity: number;
  custom_tags: string[] | null;
  smart_tags: string[] | null;
  notes: string | null;
  favorite: boolean;
  market_price: number | string | null;
  market_currency: string | null;
  price_source: string | null;
  price_updated_at: string | null;
  created_at: string;
};

type BinderRow = {
  id: string;
  name: string;
  description: string | null;
  kind: Binder["kind"];
  rules: SmartRule[] | null;
  rule_match: Binder["match"];
  created_at: string;
};

type BinderItemRow = {
  binder_id: string;
  owned_card_id: string;
  position: number;
};

function numeric(value: number | string | null | undefined) {
  if (value == null) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function hasAcquisition(record?: AcquisitionRecord) {
  if (!record) return false;
  return Boolean(
    record.batchId ||
      record.batchName ||
      record.product ||
      record.totalCost != null ||
      record.currency ||
      record.date ||
      record.location ||
      record.seller ||
      record.type
  );
}

function batchKey(card: OwnedCard) {
  if (!hasAcquisition(card.acquisition)) return null;
  return card.acquisition?.batchId || `card-${card.id}`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function hasCollectionData(state: CollectionState) {
  return state.cards.length > 0 || state.binders.length > 0;
}

export function prepareStateForCloud(state: CollectionState): CollectionState {
  const cardIdMap = new Map<string, string>();
  const cards = state.cards.map((card) => {
    const nextId = isUuid(card.id) ? card.id : crypto.randomUUID();
    cardIdMap.set(card.id, nextId);
    return { ...card, id: nextId };
  });

  const binders = state.binders.map((binder) => ({
    ...binder,
    id: isUuid(binder.id) ? binder.id : crypto.randomUUID(),
    cardIds: binder.cardIds
      .map((cardId) => cardIdMap.get(cardId) ?? cardId)
      .filter((cardId) => cards.some((card) => card.id === cardId)),
  }));

  return { ...state, cards, binders };
}

async function ensurePrimaryCollection(client: SupabaseClient, userId: string) {
  const { data: existing, error: selectError } = await client
    .from("collections")
    .select("id,last_price_sync_at")
    .eq("owner_id", userId)
    .eq("is_primary", true)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing as CollectionRow;

  const { data: created, error: insertError } = await client
    .from("collections")
    .insert({
      owner_id: userId,
      name: "My Collection",
      slug: "main",
      is_primary: true,
      visibility: "private",
    })
    .select("id,last_price_sync_at")
    .single();

  if (insertError) throw insertError;
  return created as CollectionRow;
}

export async function loadCloudState(
  client: SupabaseClient,
  userId: string
): Promise<{ state: CollectionState; collectionId: string }> {
  const collection = await ensurePrimaryCollection(client, userId);

  const [batchResult, cardResult, binderResult] = await Promise.all([
    client
      .from("acquisition_batches")
      .select("id,client_key,acquisition_type,batch_name,product,total_cost,currency,purchase_date,purchase_location,seller")
      .eq("owner_id", userId)
      .eq("collection_id", collection.id),
    client
      .from("owned_cards")
      .select("id,acquisition_batch_id,provider_card_id,game,language,name,local_id,image_url,set_id,set_name,rarity,illustrator,types,variant,condition,quantity,custom_tags,smart_tags,notes,favorite,market_price,market_currency,price_source,price_updated_at,created_at")
      .eq("owner_id", userId)
      .eq("collection_id", collection.id)
      .order("created_at", { ascending: false }),
    client
      .from("binders")
      .select("id,name,description,kind,rules,rule_match,created_at")
      .eq("owner_id", userId)
      .eq("collection_id", collection.id)
      .order("created_at", { ascending: true }),
  ]);

  if (batchResult.error) throw batchResult.error;
  if (cardResult.error) throw cardResult.error;
  if (binderResult.error) throw binderResult.error;

  const batches = (batchResult.data ?? []) as BatchRow[];
  const cards = (cardResult.data ?? []) as CardRow[];
  const binders = (binderResult.data ?? []) as BinderRow[];
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));

  let binderItems: BinderItemRow[] = [];
  if (binders.length) {
    const { data, error } = await client
      .from("binder_items")
      .select("binder_id,owned_card_id,position")
      .in("binder_id", binders.map((binder) => binder.id))
      .order("position", { ascending: true });
    if (error) throw error;
    binderItems = (data ?? []) as BinderItemRow[];
  }

  const state: CollectionState = {
    lastGlobalPriceSync: collection.last_price_sync_at,
    cards: cards.map((card) => {
      const batch = card.acquisition_batch_id ? batchById.get(card.acquisition_batch_id) : undefined;
      return {
        id: card.id,
        tcgdexId: card.provider_card_id,
        game: card.game,
        language: card.language,
        name: card.name,
        localId: card.local_id,
        image: card.image_url,
        setId: card.set_id ?? undefined,
        setName: card.set_name ?? undefined,
        rarity: card.rarity,
        illustrator: card.illustrator ?? undefined,
        types: card.types ?? [],
        variant: card.variant,
        condition: card.condition,
        quantity: card.quantity,
        tags: card.custom_tags ?? [],
        smartTags: card.smart_tags ?? [],
        notes: card.notes ?? "",
        acquisition: batch
          ? {
              type: batch.acquisition_type ?? undefined,
              batchId: batch.client_key ?? undefined,
              batchName: batch.batch_name ?? undefined,
              product: batch.product ?? undefined,
              totalCost: numeric(batch.total_cost),
              currency: batch.currency ?? undefined,
              date: batch.purchase_date ?? undefined,
              location: batch.purchase_location ?? undefined,
              seller: batch.seller ?? undefined,
            }
          : undefined,
        favorite: card.favorite,
        marketPrice: numeric(card.market_price),
        marketCurrency: card.market_currency,
        priceSource: card.price_source,
        priceUpdatedAt: card.price_updated_at,
        addedAt: card.created_at,
      } satisfies OwnedCard;
    }),
    binders: binders.map((binder) => ({
      id: binder.id,
      name: binder.name,
      description: binder.description ?? undefined,
      kind: binder.kind,
      cardIds:
        binder.kind === "manual"
          ? binderItems
              .filter((item) => item.binder_id === binder.id)
              .sort((a, b) => a.position - b.position)
              .map((item) => item.owned_card_id)
          : [],
      rules: Array.isArray(binder.rules) ? binder.rules : [],
      match: binder.rule_match,
      createdAt: binder.created_at,
    })),
  };

  return { state, collectionId: collection.id };
}

export async function saveCloudState(
  client: SupabaseClient,
  userId: string,
  collectionId: string,
  state: CollectionState
) {
  const acquisitionByKey = new Map<string, {
    owner_id: string;
    collection_id: string;
    client_key: string;
    acquisition_type: string;
    batch_name: string | null;
    product: string | null;
    total_cost: number | null;
    currency: string | null;
    purchase_date: string | null;
    purchase_location: string | null;
    seller: string | null;
  }>();

  state.cards.forEach((card) => {
    const key = batchKey(card);
    if (!key || acquisitionByKey.has(key)) return;
    const record = card.acquisition;
    acquisitionByKey.set(key, {
      owner_id: userId,
      collection_id: collectionId,
      client_key: key,
      acquisition_type: record?.type ?? "other",
      batch_name: record?.batchName ?? null,
      product: record?.product ?? null,
      total_cost: record?.totalCost ?? null,
      currency: record?.currency ?? null,
      purchase_date: record?.date ?? null,
      purchase_location: record?.location ?? null,
      seller: record?.seller ?? null,
    });
  });

  const batchIdByKey = new Map<string, string>();
  if (acquisitionByKey.size) {
    const { data, error } = await client
      .from("acquisition_batches")
      .upsert([...acquisitionByKey.values()], {
        onConflict: "owner_id,collection_id,client_key",
      })
      .select("id,client_key");
    if (error) throw error;
    (data ?? []).forEach((batch) => {
      if (batch.client_key) batchIdByKey.set(batch.client_key, batch.id);
    });
  }

  if (state.cards.length) {
    const { error } = await client.from("owned_cards").upsert(
      state.cards.map((card) => {
        const key = batchKey(card);
        return {
          id: card.id,
          owner_id: userId,
          collection_id: collectionId,
          acquisition_batch_id: key ? batchIdByKey.get(key) ?? null : null,
          provider: "cardory-catalog",
          provider_card_id: card.tcgdexId,
          game: card.game ?? "pokemon",
          language: card.language ?? "English",
          name: card.name,
          local_id: card.localId,
          image_url: card.image ?? null,
          set_id: card.setId ?? null,
          set_name: card.setName ?? null,
          rarity: card.rarity ?? null,
          illustrator: card.illustrator ?? null,
          types: card.types ?? [],
          variant: card.variant,
          condition: card.condition,
          quantity: Math.max(1, card.quantity),
          custom_tags: card.tags ?? [],
          smart_tags: card.smartTags ?? [],
          notes: card.notes || null,
          favorite: card.favorite,
          market_price: card.marketPrice ?? null,
          market_currency: card.marketCurrency ?? null,
          price_source: card.priceSource ?? null,
          price_updated_at: card.priceUpdatedAt ?? null,
          created_at: card.addedAt,
        };
      })
    );
    if (error) throw error;
  }

  const { data: remoteCards, error: remoteCardsError } = await client
    .from("owned_cards")
    .select("id")
    .eq("owner_id", userId)
    .eq("collection_id", collectionId);
  if (remoteCardsError) throw remoteCardsError;

  const localCardIds = new Set(state.cards.map((card) => card.id));
  const staleCardIds = (remoteCards ?? [])
    .map((card) => card.id as string)
    .filter((cardId) => !localCardIds.has(cardId));
  if (staleCardIds.length) {
    const { error } = await client.from("owned_cards").delete().in("id", staleCardIds);
    if (error) throw error;
  }

  if (state.binders.length) {
    const { error } = await client.from("binders").upsert(
      state.binders.map((binder) => ({
        id: binder.id,
        owner_id: userId,
        collection_id: collectionId,
        name: binder.name,
        description: binder.description ?? null,
        kind: binder.kind,
        visibility: "private",
        rules: binder.rules ?? [],
        rule_match: binder.match,
        created_at: binder.createdAt,
      }))
    );
    if (error) throw error;
  }

  const { data: remoteBinders, error: remoteBindersError } = await client
    .from("binders")
    .select("id")
    .eq("owner_id", userId)
    .eq("collection_id", collectionId);
  if (remoteBindersError) throw remoteBindersError;

  const localBinderIds = new Set(state.binders.map((binder) => binder.id));
  const staleBinderIds = (remoteBinders ?? [])
    .map((binder) => binder.id as string)
    .filter((binderId) => !localBinderIds.has(binderId));
  if (staleBinderIds.length) {
    const { error } = await client.from("binders").delete().in("id", staleBinderIds);
    if (error) throw error;
  }

  const activeBinderIds = state.binders.map((binder) => binder.id);
  if (activeBinderIds.length) {
    const { error } = await client.from("binder_items").delete().in("binder_id", activeBinderIds);
    if (error) throw error;
  }

  const manualItems = state.binders.flatMap((binder) =>
    binder.kind === "manual"
      ? binder.cardIds.map((cardId, position) => ({
          binder_id: binder.id,
          owned_card_id: cardId,
          position,
        }))
      : []
  );
  if (manualItems.length) {
    const { error } = await client.from("binder_items").insert(manualItems);
    if (error) throw error;
  }

  const activeBatchKeys = new Set(acquisitionByKey.keys());
  const { data: remoteBatches, error: remoteBatchesError } = await client
    .from("acquisition_batches")
    .select("id,client_key")
    .eq("owner_id", userId)
    .eq("collection_id", collectionId);
  if (remoteBatchesError) throw remoteBatchesError;

  const staleBatchIds = (remoteBatches ?? [])
    .filter((batch) => batch.client_key && !activeBatchKeys.has(batch.client_key as string))
    .map((batch) => batch.id as string);
  if (staleBatchIds.length) {
    const { error } = await client.from("acquisition_batches").delete().in("id", staleBatchIds);
    if (error) throw error;
  }

  const { error: collectionError } = await client
    .from("collections")
    .update({ last_price_sync_at: state.lastGlobalPriceSync ?? null })
    .eq("id", collectionId)
    .eq("owner_id", userId);
  if (collectionError) throw collectionError;
}
