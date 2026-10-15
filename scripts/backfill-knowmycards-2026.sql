-- CARDORY historical price enrichment · executed 2026-10-15
--
-- Purpose: recover dated, exact-printing, NM USD market estimates for the
-- collector's 30th Celebration + Classic Collection + celebration MEE cards.
--
-- Source: https://knowmycards.com/cards/english/<TCGplayerID>/<canonical-slug>/
-- Upstream estimator: Pokémon Price Tracker, attributed on each card page.
-- Source page explicitly says historical values MAY BE SAMPLED/INTERPOLATED.
-- They must not be treated as literal marketplace transactions/verified sales.
--
-- March 2024 prices CANNOT apply to 30th Celebration printings first sold
-- in September 2026. Exclude all dates before 2026-09-16 (pre-release),
-- and preserve existing October 15 CARDORY quotes and September reported
-- source quotes. This is a manual, idempotent, controlled backfill.
--
-- Precondition: pg_net installed; private table
-- cardory_private.history_fetch_requests populated with exact TCGplayer
-- product URLs and net.http_get responses. No anonymous API access to the
-- private audit schema. Acknowledge downstream license and attribution.
--
-- Audit:
-- select j.provider_card_id, r.status_code,
--        length(r.content) bytes
-- from cardory_private.history_fetch_requests j
-- join net._http_response r on r.id=j.request_id;
--
-- Import only quote cells from the rendered "View historical prices"
-- market-estimate table. The exact pattern is the date and USD amount.
WITH parsed AS (
 SELECT j.provider_card_id, j.source_url,
  to_date(m[1], 'Mon DD, YYYY') AS price_day,
  m[2]::numeric(12,2) AS unit_price
 FROM cardory_private.history_fetch_requests j
 JOIN net._http_response r ON r.id=j.request_id
  AND r.status_code=200
  AND position('Ungraded · Holofoil · Near Mint · USD' IN r.content)>0
  AND position('Market estimates from Pokémon Price Tracker' IN r.content)>0
 CROSS JOIN LATERAL regexp_matches(r.content,
  '<tr><td>([A-Z][a-z]{2} [0-9]{1,2}, 2026)</td><td>[$]([0-9]+[.][0-9]{2})</td></tr>', 'g') m
), verified_match AS (
 SELECT p.*, oc.id owned_card_id, oc.owner_id
 FROM parsed p JOIN public.owned_cards oc ON oc.provider_card_id=p.provider_card_id
   AND oc.game='pokemon' AND oc.language='English'
   AND oc.variant='holofoil' AND oc.condition='NM'
 WHERE p.price_day>='2026-09-16'::date
   AND p.price_day<'2026-10-15'::date
   AND p.unit_price>0 AND p.unit_price<100000
)
INSERT INTO public.price_snapshots
 (owner_id,owned_card_id,market_price,currency,source,observed_at)
SELECT owner_id,owned_card_id,unit_price,'USD',
 'historical:ESTIMATE:KnowMyCards:PokemonPriceTracker:'||source_url,
 (price_day::timestamp AT TIME ZONE 'UTC') + INTERVAL '12 hours'
FROM verified_match
ON CONFLICT (owned_card_id,snapshot_day) DO NOTHING;
-- Never overwrite TCGplayer source quotes / original October 15 baseline.
