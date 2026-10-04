# Pokédex Vault

A flexible digital Pokémon card binder built around one principle:

> **One card record, many views.**

Instead of forcing cards into static collections, Pokédex Vault keeps one master library and lets the same card appear across unlimited manual and dynamic binders.

## Wave 1

Implemented:

- Manual card lookup by name / card number
- Automatic card artwork retrieval
- Automatic metadata retrieval
- Custom tags / hashtags
- Master collection
- Manual binders
- Smart binders driven by rules
- Smart search and filtering
- TCGplayer market value via TCGdex
- Automatic 6-hour price refresh
- Manual **Sync prices now**
- Gallery view
- List view
- Quantity
- Condition
- Variant / finish
- Notes
- Favorites
- Responsive mobile layout
- Browser-local persistence

## Data source

The catalogue, artwork and market metadata are fetched from [TCGdex](https://tcgdex.dev/).

Pricing currently prefers the matching TCGplayer variant's market price. If no market price exists, the adapter falls back to median/low price where available.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy

The project is designed for Vercel and does not require environment variables for Wave 1.

## Persistence

Wave 1 stores your personal collection in browser local storage. This gets the binder model working without requiring an account or database. A later cloud-sync wave can move the same domain model to Supabase without changing how binders work.

## Next candidates

- Multiple smart rules per binder with AND/OR builder UI
- Drag-and-drop manual binder order
- Physical 9-pocket / 12-pocket pages
- Supabase login and multi-device sync
- Price history snapshots and charts
- Currency conversion
- Grading / trade / wishlist workflows
