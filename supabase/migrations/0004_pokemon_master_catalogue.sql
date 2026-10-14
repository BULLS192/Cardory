-- Cardory Pokémon catalogue foundation (separate from private owned_cards).
-- Read-only public metadata; imports are performed only with a server-side
-- service role credential. Do not put a service role key in NEXT_PUBLIC_*.
-- Card artwork remains externally referenced; no image bytes are stored.

create table if not exists public.pokemon_catalog_sets (
  provider text not null default 'tcgdex' check (provider = 'tcgdex'),
  language text not null check (language in ('en','ja','zh-tw')),
  set_id text not null,
  name text not null,
  series_id text,
  series_name text,
  release_date text,
  card_count_total integer not null default 0 check (card_count_total >= 0),
  card_count_official integer not null default 0 check (card_count_official >= 0),
  logo_url text,
  symbol_url text,
  source_url text not null,
  indexed_at timestamptz not null default now(),
  primary key (provider, language, set_id),
  constraint pokemon_catalog_sets_identifier check (
    set_id ~ '^[A-Za-z0-9_-]{1,64}$'
  )
);

create table if not exists public.pokemon_catalog_cards (
  provider text not null default 'tcgdex' check (provider = 'tcgdex'),
  language text not null check (language in ('en','ja','zh-tw')),
  card_id text not null,
  set_id text not null,
  local_id text not null,
  name text not null,
  image_url text,
  rarity text,
  category text,
  illustrator text,
  hp integer,
  types text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  metadata_level text not null default 'brief'
    check (metadata_level in ('brief', 'full')),
  source_url text not null,
  indexed_at timestamptz not null default now(),
  primary key (provider, language, card_id),
  foreign key (provider, language, set_id)
    references public.pokemon_catalog_sets (provider, language, set_id)
    on delete cascade,
  constraint pokemon_catalog_cards_identifier check (
    card_id ~ '^[A-Za-z0-9_-]{1,128}$'
  )
);

create index if not exists pokemon_catalog_cards_by_set
  on public.pokemon_catalog_cards (provider, language, set_id, local_id);
create index if not exists pokemon_catalog_cards_name_lookup
  on public.pokemon_catalog_cards (language, lower(name));
create index if not exists pokemon_catalog_cards_metadata_gin
  on public.pokemon_catalog_cards using gin (metadata jsonb_path_ops);

-- Catalogue rows are not user-owned and intentionally readable,
-- but editing them must NOT be available to browser anon/authenticated.
alter table public.pokemon_catalog_sets enable row level security;
alter table public.pokemon_catalog_cards enable row level security;

drop policy if exists "pokemon_catalog_sets_read" on public.pokemon_catalog_sets;
create policy "pokemon_catalog_sets_read"
  on public.pokemon_catalog_sets for select
  to anon, authenticated
  using (true);

drop policy if exists "pokemon_catalog_cards_read" on public.pokemon_catalog_cards;
create policy "pokemon_catalog_cards_read"
  on public.pokemon_catalog_cards for select
  to anon, authenticated
  using (true);

revoke all on public.pokemon_catalog_sets from anon, authenticated;
revoke all on public.pokemon_catalog_cards from anon, authenticated;
grant select on public.pokemon_catalog_sets to anon, authenticated;
grant select on public.pokemon_catalog_cards to anon, authenticated;

comment on table public.pokemon_catalog_sets is
  'TCGdex expansion-set reference index, separate from user-owned inventory';
comment on table public.pokemon_catalog_cards is
  'External Pokémon card metadata; image_url references remain at source';
