# CARDORY

**Every card has a story.**

CARDORY is a multi-TCG collector OS for scanning, cataloging, valuing, organizing, sharing and eventually trading collectible cards.

The product is built around one principle:

> **One owned card record, many views.**

Instead of forcing cards into static collections, CARDORY keeps one master library. The same owned card can appear across manual binders, smart binders, opening sessions, public collections and future trade views without duplicating the underlying record.

## Current capabilities

- Pokémon and Riftbound catalogue support
- English, Japanese and Traditional Chinese Pokémon lookup
- Manual search by card name / collector number
- Camera-assisted collector-number scanning with on-device OCR
- Opening sessions with shared acquisition metadata
- Set-aware scan ranking and Quick Scan
- Automatic card artwork where provider/licensing permits
- Structured card metadata
- Custom tags and automatic smart tags
- Master collection
- Manual binders
- Smart binders driven by rules
- Search and filtering
- Live market values with source/currency attribution
- Automatic price refresh and manual **Sync prices now**
- Gallery and list views
- Quantity, condition, variant/finish, notes and favorites
- Responsive mobile layout
- Browser-local persistence with legacy Pokédex Vault migration

## Data sources

CARDORY currently uses multiple providers:

- [TCGdex](https://tcgdex.dev/) for Pokémon catalogue metadata, localized card data and artwork.
- [TCGCSV](https://tcgcsv.com/) / TCGplayer catalogue and pricing data for selected Pokémon fallbacks and Riftbound.
- Cardmarket pricing may be used as a EUR fallback where exposed through TCGdex.

Riftbound artwork is intentionally not scraped from third-party storefronts; the app currently waits for an approved Riot asset/API path.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deployment

Production is deployed on Vercel. The canonical project domain is intended to be:

**https://cardory.omnidite.com**

## Persistence

CARDORY currently stores the personal collection in browser storage. Existing `pokedex-vault-v1` data is read automatically and migrated forward to the `cardory-v1` storage key without deleting the legacy copy.

The planned cloud architecture uses Supabase Auth + Postgres with Row Level Security, normalized acquisition batches, public/private collections and sanitized trade-discovery snapshots.

## Next candidates

- IndexedDB + portable backup while Supabase is deferred
- Supabase login and multi-device sync
- Multiple smart rules per binder with AND/OR builder UI
- Drag-and-drop manual binder order
- Physical 9-pocket / 12-pocket pages
- Price history snapshots and charts
- Currency conversion
- Artwork-assisted scan matching
- Grading, wishlist and trade workflows
