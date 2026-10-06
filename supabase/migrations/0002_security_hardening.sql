-- CARDORY Wave 3.1: security and tenant-integrity hardening
-- Keeps all private collection data owner-scoped and removes callable trigger helpers
-- from the exposed public schema.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Re-home auth bootstrap trigger into a non-exposed schema.
create or replace function private.handle_new_user()
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

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

drop function if exists public.handle_new_user();

-- Re-home timestamp helper too.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

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
      'create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()',
      table_name
    );
  end loop;
end $$;

drop function if exists public.set_updated_at();

-- Store collection-level cloud sync state.
alter table public.collections
  add column if not exists last_price_sync_at timestamptz;

-- Preserve legacy/local acquisition identifiers during first cloud migration.
alter table public.acquisition_batches
  add column if not exists client_key text;

create unique index if not exists acquisition_batches_client_key_unique
  on public.acquisition_batches (owner_id, collection_id, client_key)
  where client_key is not null;

-- Explicit Data API privileges. RLS remains the authorization boundary.
grant usage on schema public to anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;

grant select on public.collections to anon, authenticated;
grant insert, update, delete on public.collections to authenticated;

grant select, insert, update, delete on public.acquisition_batches to authenticated;
grant select, insert, update, delete on public.owned_cards to authenticated;
grant select, insert, update, delete on public.price_snapshots to authenticated;

grant select on public.binders to anon, authenticated;
grant insert, update, delete on public.binders to authenticated;

grant select, insert, update, delete on public.binder_items to authenticated;

grant select on public.public_card_entries to anon, authenticated;
grant insert, update, delete on public.public_card_entries to authenticated;

grant select on public.public_profiles to anon, authenticated;

-- Replace broad policies with tenant-integrity-aware policies.
drop policy if exists "profiles_select_owner_or_public" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_owner_or_public"
  on public.profiles for select
  to anon, authenticated
  using (
    id = (select auth.uid())
    or is_public = true
  );

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "collections_select_owner_or_public" on public.collections;
drop policy if exists "collections_insert_own" on public.collections;
drop policy if exists "collections_update_own" on public.collections;
drop policy if exists "collections_delete_own" on public.collections;

create policy "collections_select_owner_or_public"
  on public.collections for select
  to anon, authenticated
  using (
    owner_id = (select auth.uid())
    or (
      visibility = 'public'
      and exists (
        select 1
        from public.profiles p
        where p.id = collections.owner_id
          and p.is_public = true
      )
    )
  );

create policy "collections_insert_own"
  on public.collections for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy "collections_update_own"
  on public.collections for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "collections_delete_own"
  on public.collections for delete
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "acquisition_batches_owner_all" on public.acquisition_batches;
create policy "acquisition_batches_owner_all"
  on public.acquisition_batches for all
  to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.collections c
      where c.id = acquisition_batches.collection_id
        and c.owner_id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.collections c
      where c.id = acquisition_batches.collection_id
        and c.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owned_cards_owner_all" on public.owned_cards;
create policy "owned_cards_owner_all"
  on public.owned_cards for all
  to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.collections c
      where c.id = owned_cards.collection_id
        and c.owner_id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.collections c
      where c.id = owned_cards.collection_id
        and c.owner_id = (select auth.uid())
    )
    and (
      acquisition_batch_id is null
      or exists (
        select 1
        from public.acquisition_batches a
        where a.id = owned_cards.acquisition_batch_id
          and a.owner_id = (select auth.uid())
          and a.collection_id = owned_cards.collection_id
      )
    )
  );

drop policy if exists "price_snapshots_owner_all" on public.price_snapshots;
create policy "price_snapshots_owner_all"
  on public.price_snapshots for all
  to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.owned_cards oc
      where oc.id = price_snapshots.owned_card_id
        and oc.owner_id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.owned_cards oc
      where oc.id = price_snapshots.owned_card_id
        and oc.owner_id = (select auth.uid())
    )
  );

drop policy if exists "binders_select_owner_or_public" on public.binders;
drop policy if exists "binders_insert_own" on public.binders;
drop policy if exists "binders_update_own" on public.binders;
drop policy if exists "binders_delete_own" on public.binders;

create policy "binders_select_owner_or_public"
  on public.binders for select
  to anon, authenticated
  using (
    owner_id = (select auth.uid())
    or (
      visibility = 'public'
      and exists (
        select 1
        from public.profiles p
        where p.id = binders.owner_id
          and p.is_public = true
      )
    )
  );

create policy "binders_insert_own"
  on public.binders for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.collections c
      where c.id = binders.collection_id
        and c.owner_id = (select auth.uid())
    )
  );

create policy "binders_update_own"
  on public.binders for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.collections c
      where c.id = binders.collection_id
        and c.owner_id = (select auth.uid())
    )
  );

create policy "binders_delete_own"
  on public.binders for delete
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "binder_items_owner_all" on public.binder_items;
create policy "binder_items_owner_all"
  on public.binder_items for all
  to authenticated
  using (
    exists (
      select 1
      from public.binders b
      join public.owned_cards oc
        on oc.id = binder_items.owned_card_id
      where b.id = binder_items.binder_id
        and b.owner_id = (select auth.uid())
        and oc.owner_id = (select auth.uid())
        and oc.collection_id = b.collection_id
    )
  )
  with check (
    exists (
      select 1
      from public.binders b
      join public.owned_cards oc
        on oc.id = binder_items.owned_card_id
      where b.id = binder_items.binder_id
        and b.owner_id = (select auth.uid())
        and oc.owner_id = (select auth.uid())
        and oc.collection_id = b.collection_id
    )
  );

drop policy if exists "public_card_entries_select_discoverable" on public.public_card_entries;
drop policy if exists "public_card_entries_owner_insert" on public.public_card_entries;
drop policy if exists "public_card_entries_owner_update" on public.public_card_entries;
drop policy if exists "public_card_entries_owner_delete" on public.public_card_entries;

create policy "public_card_entries_select_discoverable"
  on public.public_card_entries for select
  to anon, authenticated
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
              and c.owner_id = public_card_entries.owner_id
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
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.collections c
      where c.id = public_card_entries.collection_id
        and c.owner_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.owned_cards oc
      where oc.id = public_card_entries.owned_card_id
        and oc.owner_id = (select auth.uid())
        and oc.collection_id = public_card_entries.collection_id
    )
  );

create policy "public_card_entries_owner_update"
  on public.public_card_entries for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.collections c
      where c.id = public_card_entries.collection_id
        and c.owner_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.owned_cards oc
      where oc.id = public_card_entries.owned_card_id
        and oc.owner_id = (select auth.uid())
        and oc.collection_id = public_card_entries.collection_id
    )
  );

create policy "public_card_entries_owner_delete"
  on public.public_card_entries for delete
  to authenticated
  using (owner_id = (select auth.uid()));
