-- CARDORY Wave 3: multi-user cloud foundation
-- Default posture: private. Public discovery is explicit opt-in.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  country_code text,
  region text,
  is_public boolean not null default false,
  is_trade_discoverable boolean not null default false,
  trade_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null or username ~ '^[A-Za-z0-9_]{3,30}$'
  )
);

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username))
  where username is not null;

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'My Collection',
  slug text,
  description text,
  visibility text not null default 'private'
    check (visibility in ('private', 'unlisted', 'public')),
  is_primary boolean not null default false,
  allow_trade_discovery boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists collections_owner_slug_unique
  on public.collections (owner_id, lower(slug))
  where slug is not null;

create unique index if not exists collections_one_primary_per_owner
  on public.collections (owner_id)
  where is_primary = true;

create table if not exists public.acquisition_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  acquisition_type text not null default 'pack'
    check (acquisition_type in ('pack', 'single', 'sealed', 'trade', 'gift', 'other')),
  batch_name text,
  product text,
  total_cost numeric(14,2),
  currency text,
  purchase_date date,
  purchase_location text,
  seller text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.owned_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  acquisition_batch_id uuid references public.acquisition_batches(id) on delete set null,

  provider text not null,
  provider_card_id text not null,
  game text not null check (game in ('pokemon', 'riftbound')),
  language text not null,
  name text not null,
  local_id text not null,
  image_url text,
  set_id text,
  set_name text,
  rarity text,
  illustrator text,
  types text[] not null default '{}',

  variant text not null default 'normal',
  condition text not null default 'NM'
    check (condition in ('NM', 'LP', 'MP', 'HP', 'DMG')),
  quantity integer not null default 1 check (quantity > 0),

  custom_tags text[] not null default '{}',
  smart_tags text[] not null default '{}',
  notes text,
  favorite boolean not null default false,

  market_price numeric(14,4),
  market_currency text,
  price_source text,
  price_updated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owned_cards_owner_collection_idx
  on public.owned_cards (owner_id, collection_id);
create index if not exists owned_cards_provider_card_idx
  on public.owned_cards (provider, provider_card_id);
create index if not exists owned_cards_set_idx
  on public.owned_cards (set_id);
create index if not exists owned_cards_tags_gin_idx
  on public.owned_cards using gin (smart_tags);

create table if not exists public.price_snapshots (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  owned_card_id uuid not null references public.owned_cards(id) on delete cascade,
  market_price numeric(14,4) not null,
  currency text not null,
  source text,
  observed_at timestamptz not null default now()
);

create index if not exists price_snapshots_card_time_idx
  on public.price_snapshots (owned_card_id, observed_at desc);

create table if not exists public.binders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  name text not null,
  description text,
  kind text not null check (kind in ('manual', 'smart')),
  visibility text not null default 'private'
    check (visibility in ('private', 'unlisted', 'public')),
  rules jsonb not null default '[]'::jsonb,
  rule_match text not null default 'all' check (rule_match in ('all', 'any')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.binder_items (
  binder_id uuid not null references public.binders(id) on delete cascade,
  owned_card_id uuid not null references public.owned_cards(id) on delete cascade,
  position integer not null default 0,
  page_number integer,
  pocket_number integer,
  primary key (binder_id, owned_card_id)
);

-- Public-facing card snapshots contain only fields intentionally safe to expose.
-- Sensitive ownership/acquisition fields remain exclusively in owned_cards/acquisition_batches.
create table if not exists public.public_card_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  owned_card_id uuid not null references public.owned_cards(id) on delete cascade,

  card_key text not null,
  game text not null,
  language text not null,
  name text not null,
  local_id text not null,
  image_url text,
  set_name text,
  rarity text,
  variant text,

  show_condition boolean not null default true,
  condition text,
  show_quantity boolean not null default false,
  quantity integer,
  show_market_value boolean not null default false,
  market_price numeric(14,4),
  market_currency text,

  trade_status text not null default 'not_for_trade'
    check (trade_status in ('not_for_trade', 'open_to_trade', 'for_trade')),
  public_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (owned_card_id)
);

create index if not exists public_card_entries_owner_idx
  on public.public_card_entries (owner_id);
create index if not exists public_card_entries_trade_idx
  on public.public_card_entries (trade_status)
  where trade_status <> 'not_for_trade';

-- Create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;

  insert into public.collections (owner_id, name, slug, is_primary)
  values (new.id, 'My Collection', 'main', true)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Timestamp maintenance.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'collections',
    'acquisition_batches',
    'owned_cards',
    'binders',
    'public_card_entries'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name
    );
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.collections enable row level security;
alter table public.acquisition_batches enable row level security;
alter table public.owned_cards enable row level security;
alter table public.price_snapshots enable row level security;
alter table public.binders enable row level security;
alter table public.binder_items enable row level security;
alter table public.public_card_entries enable row level security;

-- Profiles: owners always see their own profile. Other users/anonymous visitors
-- only see profiles explicitly made public.
create policy "profiles_select_owner_or_public"
  on public.profiles for select
  using (id = auth.uid() or is_public = true);

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Collection metadata is safe to expose only when the owner explicitly publishes it.
create policy "collections_select_owner_or_public"
  on public.collections for select
  using (owner_id = auth.uid() or visibility = 'public');

create policy "collections_insert_own"
  on public.collections for insert
  with check (owner_id = auth.uid());

create policy "collections_update_own"
  on public.collections for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "collections_delete_own"
  on public.collections for delete
  using (owner_id = auth.uid());

-- Private collection data: owner only.
create policy "acquisition_batches_owner_all"
  on public.acquisition_batches for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owned_cards_owner_all"
  on public.owned_cards for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "price_snapshots_owner_all"
  on public.price_snapshots for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "binders_select_owner_or_public"
  on public.binders for select
  using (owner_id = auth.uid() or visibility = 'public');

create policy "binders_insert_own"
  on public.binders for insert
  with check (owner_id = auth.uid());

create policy "binders_update_own"
  on public.binders for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "binders_delete_own"
  on public.binders for delete
  using (owner_id = auth.uid());

create policy "binder_items_owner_all"
  on public.binder_items for all
  using (
    exists (
      select 1 from public.binders b
      where b.id = binder_items.binder_id and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.binders b
      where b.id = binder_items.binder_id and b.owner_id = auth.uid()
    )
  );

-- Public snapshots are readable only when the profile is public and either
-- the collection is public OR the user explicitly marks the card tradeable.
create policy "public_card_entries_select_discoverable"
  on public.public_card_entries for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = public_card_entries.owner_id
        and p.is_public = true
        and (
          exists (
            select 1
            from public.collections c
            where c.id = public_card_entries.collection_id
              and c.visibility = 'public'
          )
          or (
            p.is_trade_discoverable = true
            and public_card_entries.trade_status <> 'not_for_trade'
          )
        )
    )
  );

create policy "public_card_entries_owner_insert"
  on public.public_card_entries for insert
  with check (owner_id = auth.uid());

create policy "public_card_entries_owner_update"
  on public.public_card_entries for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "public_card_entries_owner_delete"
  on public.public_card_entries for delete
  using (owner_id = auth.uid());

-- Helpful public directory view. No email or private auth fields are exposed.
create or replace view public.public_profiles
with (security_invoker = true)
as
select
  id,
  username,
  display_name,
  avatar_url,
  bio,
  country_code,
  region,
  is_trade_discoverable,
  trade_notes,
  created_at
from public.profiles
where is_public = true;
