-- CARDORY Wave 3.2: cloud sync indexes
-- Support deterministic upserts from browser-local acquisition batches and
-- cover foreign-key access paths flagged by the Supabase performance advisor.

drop index if exists public.acquisition_batches_client_key_unique;

create unique index if not exists acquisition_batches_client_key_unique
  on public.acquisition_batches (owner_id, collection_id, client_key);

create index if not exists acquisition_batches_collection_idx
  on public.acquisition_batches (collection_id);

create index if not exists binder_items_owned_card_idx
  on public.binder_items (owned_card_id);

create index if not exists binders_collection_idx
  on public.binders (collection_id);

create index if not exists binders_owner_idx
  on public.binders (owner_id);

create index if not exists owned_cards_acquisition_batch_idx
  on public.owned_cards (acquisition_batch_id);

create index if not exists owned_cards_collection_idx
  on public.owned_cards (collection_id);

create index if not exists price_snapshots_owner_idx
  on public.price_snapshots (owner_id);

create index if not exists public_card_entries_collection_idx
  on public.public_card_entries (collection_id);
