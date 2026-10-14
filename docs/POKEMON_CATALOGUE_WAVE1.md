# Pokémon catalogue — Wave 1

## What this change delivers

- `/catalog`: searchable TCGdex expansion index for English, Japanese and Traditional Chinese.
- Select a set to browse its cards and image *references*, with high-resolution card details opened through Cardory's existing `/api/cards/[id]` integration.
- Export a selected set and its card briefs to a local JSON file. Image bytes are **not** exported.
- `/api/catalog/sets?language=en`: validated read-only set index.
- `/api/catalog/sets/{id}?language=en`: validated read-only set details.
- `npm run catalogue:import`: optional complete provider catalogue metadata snapshot for `en`, `ja`, and `zh-tw`, saved under gitignored `data/pokemon/`.

## How to review

1. On a branch deployment (or locally with `npm install && npm run dev`), visit `/catalog`.
2. Confirm the expansion count and initial set list load in English.
3. Search for `Base Set`, select it, see cards, open a card to view detailed metadata.
4. Export its JSON; verify that the output contains only metadata and image URLs.
5. Switch to Japanese and Traditional Chinese and check that source data changes.
6. Try invalid API inputs: `/api/catalog/sets?language=foo` and `/api/catalog/sets/../?language=en`. Bad language and set IDs should not be fetched from arbitrary domains.
7. Run `npm run catalogue:import` to create an optional full index snapshot. Review `data/pokemon/summary.json` for count and missing-image data.

## Limitations and next wave

- Cardory already had single-card lookups before Wave 1. This wave adds **set browsing and data export**, not a new collection database.
- Provider card-count totals are not proof of worldwide completeness. Special promos, market-specific printings, Chinese Simplified, and missing card images still need source-by-source reconciliation.
- The snapshot currently stores **card briefs** and source artwork references, not full details for every card; those are retrieved on demand through the existing card endpoint.
- No Supabase migration, authentication changes, recurring jobs, bulk image download, automatic pricing sync or production deployment has been made.
- Next: add versioned, source-provenanced normalized Supabase catalogue tables; an idempotent import with rate limits and validation; and measured international coverage reporting. Keep physical variants separate from card identities.
- Pokémon and related artwork remain intellectual property of their respective owners; review usage rights before any public image mirroring or monetization.

Data provider: [TCGdex](https://tcgdex.dev/). This is not affiliated with or endorsed by The Pokémon Company.
