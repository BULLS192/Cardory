-- Source: Bill's Archive, "30th Celebration Prices: Release Day to Now", updated 2026-10-13.
-- https://billsarchive.com/articles/30th-celebration-prices-release-to-now.html
-- Primary data described as TCGplayer USD market prices for EN near-mint BASE printings
-- 2026-09-16 at 18:23 UTC and 2026-10-13. NOT preorder or special pattern variants.
-- Idempotent import restricted to exact printed set/number/language/variant.
-- Missing collector numbers remain missing. Never project index movement as card prices.
WITH verified(collector_number,release_price,oct13_price) AS (
  VALUES
    ('014',1.07,0.16),
    ('016',1.34,0.18),
    ('019',1.18,0.18),
    ('023',2.88,0.77),
    ('024',1.90,0.65),
    ('025',2.20,0.56),
    ('026',4.01,0.70),
    ('027',4.14,1.03),
    ('028',3.96,0.80),
    ('029',3.01,0.59),
    ('030',1.47,0.57),
    ('031',2.92,0.73),
    ('032',2.30,0.94),
    ('033',1.65,0.61),
    ('034',4.38,1.00),
    ('035',3.11,0.71),
    ('036',3.27,1.01),
    ('037',2.79,0.61),
    ('038',2.23,0.68),
    ('039',2.44,0.69),
    ('040',4.08,2.45),
    ('041',3.07,0.70),
    ('042',3.88,0.70),
    ('043',4.17,0.86),
    ('044',2.38,0.74),
    ('045',2.02,0.64),
    ('046',2.97,0.59),
    ('047',2.51,0.78),
    ('048',2.54,0.72),
    ('049',1.30,0.63),
    ('050',1.56,0.74),
    ('051',3.42,0.58),
    ('052',3.22,0.65),
    ('060',1.30,0.20),
    ('065',2.63,0.43),
    ('069',1.46,0.23),
    ('095',1.28,0.17),
    ('115',1.87,0.26),
    ('119',2.10,0.31),
    ('121',2.56,0.26),
    ('129',5.95,1.58),
    ('134',4.53,2.26),
    ('136',8.74,2.56),
    ('137',4.40,1.84),
    ('138',3.73,1.41),
    ('140',5.26,1.42),
    ('142',6.08,1.34),
    ('143',3.83,1.38),
    ('148',63.20,20.28),
    ('149',159.59,47.24),
    ('150',155.83,57.84),
    ('151',114.65,49.05),
    ('152',194.29,86.97),
    ('153',123.12,42.22),
    ('154',145.45,75.20),
    ('155',76.95,42.92),
    ('157',134.55,43.05),
    ('158',248.04,56.10)
), matched AS (
  SELECT oc.id AS owned_card_id,oc.owner_id,
    v.release_price,v.oct13_price
  FROM public.owned_cards oc JOIN verified v
   ON lpad(split_part(oc.local_id,'/',1),3,'0')=v.collector_number
  WHERE oc.set_id='tcgplayer-24722' AND oc.game='pokemon'
    AND oc.language='English' AND oc.variant='holofoil'
), dated_quotes AS (
  SELECT m.owned_card_id,m.owner_id,v.date_at,v.price
  FROM matched m
  CROSS JOIN LATERAL (VALUES
    ('2026-09-16T18:23:00Z'::timestamptz,m.release_price),
    ('2026-10-13T12:00:00Z'::timestamptz,m.oct13_price)
  ) AS v(date_at,price)
)
INSERT INTO public.price_snapshots
  (owner_id,owned_card_id,market_price,currency,source,observed_at)
SELECT d.owner_id,d.owned_card_id,d.price,'USD',
 'historical:TCGplayer-via-BillsArchive:https://billsarchive.com/articles/30th-celebration-prices-release-to-now.html',
 d.date_at
FROM dated_quotes d
ON CONFLICT (owned_card_id,snapshot_day) DO NOTHING;
