# Wave 3 — Multi-user Cloud Collection

Wave 3 turns Pokédex Vault from a single-browser collection into a multi-user portal.

## Privacy defaults

- New profiles are **private**.
- New collections are **private**.
- Trade discovery is **off**.
- Purchase price, seller, acquisition location, private notes and opening history remain in owner-only tables.
- Publishing a collection never exposes those private acquisition fields.
- Public/trade pages read from `public_card_entries`, a deliberately limited snapshot table.

## Account model

Every Supabase Auth user receives:

1. a `profiles` row;
2. a private primary collection called **My Collection**.

A user can later choose a username and opt into a public profile.

## Visibility

Collections support:

- `private` — owner only
- `unlisted` — reserved for share-link behavior
- `public` — discoverable through a public profile

Binders have the same visibility model.

## Trade discovery

Cards can be published with:

- `not_for_trade`
- `open_to_trade`
- `for_trade`

A public trade card exposes only the safe snapshot fields selected by the user. It does **not** expose acquisition price, purchase location, seller or private notes.

## Future trade layer

The schema intentionally leaves messaging/offers for a later wave. Recommended follow-up tables:

- trade_wishlists
- trade_offers
- trade_offer_items
- trade_messages
- blocked_users
- reports

Those should be introduced only after public profiles and privacy controls have been tested.

## Migration

The browser-local collection should be imported after first sign-in:

1. create/find primary cloud collection;
2. de-duplicate acquisition batches;
3. upload owned cards;
4. upload binders and binder items;
5. create initial price snapshots;
6. verify counts/value;
7. only then mark the local copy as migrated.

Do not erase local storage automatically during the first migration.
