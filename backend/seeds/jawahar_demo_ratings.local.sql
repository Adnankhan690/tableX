-- ==============================================================================================
--  !!  LOCAL AND STAGING ONLY.  DO NOT RUN THIS AGAINST PRODUCTION.  !!
-- ==============================================================================================
--
-- This file invents 88 dish ratings, 6 sittings and 6 paid orders that never happened, so the
-- menu card, the Most Loved rail and the admin reviews feed can be seen working before a real
-- diner has left anything.
--
-- It is a UI fixture. On a live restaurant the same rows are a lie told to paying customers:
-- the menu would show "4.8 (5)" for dishes nobody has rated, which is the one number on that
-- card a diner cannot check for themselves. It also poisons the real aggregate -- rating_sum is
-- maintained by delta inside the review transaction (migration 016), so the first genuine
-- 3-star lands on top of five invented 5s and the dish never recovers its true average.
--
-- Two things keep it away from production, neither of them sufficient on its own:
--   * the .local.sql suffix, matching local_seed.sql's convention
--   * the guard below, which aborts if this restaurant has ever taken a real order
--
-- The honest ways to fill those cards are in the menu seed's notes: let the review flow do it
-- (D16/D17 -- one tap, no form, so it fills within a service or two), or set is_bestseller,
-- which is the restaurant's own claim rather than an invented diner's.
--
-- Requires backend/seeds/jawahar_menu.sql to have been loaded first.
--
-- Usage:
--   make seed SEED_FILE=backend/seeds/jawahar_demo_ratings.local.sql
--
-- To undo (this file's rows are all uid-prefixed, so the cleanup is exact):
--   DELETE FROM order_item_review WHERE uid LIKE 'rev_jwd%';
--   DELETE FROM service_review    WHERE uid LIKE 'svc_jwd%';
--   DELETE FROM order_item        WHERE uid LIKE 'oit_jwd%';
--   DELETE FROM orders            WHERE uid LIKE 'ord_jwdemo%';
--   DELETE FROM guest_session     WHERE uid LIKE 'gst_jwdemo%';
--   UPDATE menu_item SET rating_count = 0, rating_sum = 0
--    WHERE restaurant_id = (SELECT id FROM restaurant WHERE slug = 'jawahar');

BEGIN;

CREATE TEMP TABLE jw_target (slug TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO jw_target (slug) VALUES ('jawahar');

DO $guard$
DECLARE
    target TEXT := (SELECT slug FROM jw_target);
    rid    INT  := (SELECT id FROM restaurant WHERE slug = target);
    real_orders INT;
BEGIN
    IF rid IS NULL THEN
        RAISE EXCEPTION 'no restaurant with slug %. Load jawahar_menu.sql first.', target;
    END IF;

    /*
        THE PRODUCTION GUARD.

        A restaurant that has taken even one order of its own is a restaurant with real diners,
        and invented ratings must not be mixed into its history. This is a blunt test and it is
        meant to be: it costs a developer nothing on a fresh local database, and it is the one
        thing standing between this file and a live menu if it is ever run by mistake.
    */
    SELECT count(*) INTO real_orders
    FROM orders WHERE restaurant_id = rid AND uid NOT LIKE 'ord_jwdemo%';

    IF real_orders > 0 THEN
        RAISE EXCEPTION
            'refusing: % has % real order(s). This file invents ratings and must never run '
            'against a restaurant with live diners.', target, real_orders;
    END IF;
END
$guard$;

-- ----------------------------------------------------------------------------------------------
-- Tables.
--
-- !! LOCAL ONLY !! These qr_tokens are fixed and therefore guessable. A predictable token lets a
-- stranger order onto someone else's table (D4). Real tables come from utils.GenerateQRToken()
-- via the admin app -- which is exactly why jawahar_menu.sql creates none.
-- ----------------------------------------------------------------------------------------------
INSERT INTO restaurant_table (uid, restaurant_id, label, qr_token, seats, status)
SELECT v.uid, r.id, v.label, v.qr_token, v.seats, 'active'
FROM restaurant r
JOIN jw_target t ON t.slug = r.slug
CROSS JOIN (VALUES
    ('tbl_jwdemo1', '1', 'jawaharlocaltablequrtoken00000001', 4),
    ('tbl_jwdemo2', '2', 'jawaharlocaltablequrtoken00000002', 4),
    ('tbl_jwdemo3', '3', 'jawaharlocaltablequrtoken00000003', 6),
    ('tbl_jwdemo4', '4', 'jawaharlocaltablequrtoken00000004', 2)
) AS v(uid, label, qr_token, seats)
ON CONFLICT (uid) DO NOTHING;

-- ----------------------------------------------------------------------------------------------
-- Six sittings, one per backdated day.
--
-- BACKDATED, and that is not cosmetic. orders.order_number is unique per
-- (restaurant_id, business_date), and the admin dashboard's figures are scoped to today --
-- seeding today's orders would ship a restaurant that had already served six covers this
-- morning. The sessions are expired: they are the anonymous identity the ratings were left
-- under, not a way in.
-- ----------------------------------------------------------------------------------------------
INSERT INTO guest_session (uid, restaurant_id, table_id, token, user_agent, expires_at, created_at)
SELECT v.uid, r.id, tb.id, v.token, 'seed',
       NOW() - (v.days || ' days')::INTERVAL + INTERVAL '4 hours',
       NOW() - (v.days || ' days')::INTERVAL
FROM restaurant r
JOIN jw_target t ON t.slug = r.slug
CROSS JOIN (VALUES
    ('gst_jwdemo1', 'tbl_jwdemo1', 'jawaharseedexpiredsession000000000000001', 1),
    ('gst_jwdemo2', 'tbl_jwdemo2', 'jawaharseedexpiredsession000000000000002', 2),
    ('gst_jwdemo3', 'tbl_jwdemo3', 'jawaharseedexpiredsession000000000000003', 3),
    ('gst_jwdemo4', 'tbl_jwdemo1', 'jawaharseedexpiredsession000000000000004', 4),
    ('gst_jwdemo5', 'tbl_jwdemo3', 'jawaharseedexpiredsession000000000000005', 5),
    ('gst_jwdemo6', 'tbl_jwdemo4', 'jawaharseedexpiredsession000000000000006', 6)
) AS v(uid, table_uid, token, days)
JOIN restaurant_table tb ON tb.restaurant_id = r.id AND tb.uid = v.table_uid
ON CONFLICT (uid) DO NOTHING;

INSERT INTO orders (
    uid, restaurant_id, table_id, guest_session_id, order_number, business_date, status,
    subtotal_minor, tax_minor, service_charge_minor, discount_minor, total_minor, currency,
    payment_method, payment_status, placed_at, accepted_at, preparing_at, ready_at, served_at,
    completed_at, created_at, updated_at
)
SELECT v.uid, r.id, g.table_id, g.id, v.order_number,
       (CURRENT_DATE - v.days), 'completed',
       -- Placeholders. Recomputed from the lines at the foot of this file, because a seeded
       -- bill whose subtotal does not equal its own items looks broken the moment anyone adds
       -- them up.
       0, 0, 0, 0, 0, 'INR',
       'counter', 'paid',
       NOW() - (v.days || ' days')::INTERVAL,
       NOW() - (v.days || ' days')::INTERVAL + INTERVAL '2 min',
       NOW() - (v.days || ' days')::INTERVAL + INTERVAL '6 min',
       NOW() - (v.days || ' days')::INTERVAL + INTERVAL '24 min',
       NOW() - (v.days || ' days')::INTERVAL + INTERVAL '28 min',
       NOW() - (v.days || ' days')::INTERVAL + INTERVAL '75 min',
       NOW() - (v.days || ' days')::INTERVAL,
       NOW() - (v.days || ' days')::INTERVAL
FROM restaurant r
JOIN jw_target t ON t.slug = r.slug
CROSS JOIN (VALUES
    ('ord_jwdemo1', 'gst_jwdemo1', 'B-101', 1),
    ('ord_jwdemo2', 'gst_jwdemo2', 'B-102', 2),
    ('ord_jwdemo3', 'gst_jwdemo3', 'B-103', 3),
    ('ord_jwdemo4', 'gst_jwdemo4', 'B-104', 4),
    ('ord_jwdemo5', 'gst_jwdemo5', 'B-105', 5),
    ('ord_jwdemo6', 'gst_jwdemo6', 'B-106', 6)
) AS v(uid, session_uid, order_number, days)
JOIN guest_session g ON g.uid = v.session_uid
ON CONFLICT (uid) DO NOTHING;

-- ----------------------------------------------------------------------------------------------
-- The lines. Name, price and food type are snapshotted exactly as a real order would copy them
-- (D8), so the admin feed shows each dish as the diner saw it.
--
-- The VALUES list leads the FROM clause: Postgres resolves FROM items left to right, so a JOIN
-- whose ON clause names `v` before `v` exists is a missing-FROM-clause error.
-- ----------------------------------------------------------------------------------------------
INSERT INTO order_item (
    uid, order_id, menu_item_id, name_snapshot, unit_price_minor, food_type,
    quantity, total_minor, status, created_at, updated_at
)
SELECT v.uid, o.id, m.id, m.name, m.price_minor, m.food_type,
       1, m.price_minor, 'active', o.created_at, o.created_at
FROM (VALUES
    ('oit_jwd001'    , 'ord_jwdemo1'   , 'itm_jw_39_butter_chicken_f'),
    ('oit_jwd002'    , 'ord_jwdemo2'   , 'itm_jw_39_butter_chicken_f'),
    ('oit_jwd003'    , 'ord_jwdemo3'   , 'itm_jw_39_butter_chicken_f'),
    ('oit_jwd004'    , 'ord_jwdemo4'   , 'itm_jw_39_butter_chicken_f'),
    ('oit_jwd005'    , 'ord_jwdemo5'   , 'itm_jw_39_butter_chicken_f'),
    ('oit_jwd006'    , 'ord_jwdemo1'   , 'itm_jw_49_chicken_biryani_f'),
    ('oit_jwd007'    , 'ord_jwdemo2'   , 'itm_jw_49_chicken_biryani_f'),
    ('oit_jwd008'    , 'ord_jwdemo3'   , 'itm_jw_49_chicken_biryani_f'),
    ('oit_jwd009'    , 'ord_jwdemo4'   , 'itm_jw_49_chicken_biryani_f'),
    ('oit_jwd010'    , 'ord_jwdemo1'   , 'itm_jw_48_mutton_biryani_f'),
    ('oit_jwd011'    , 'ord_jwdemo2'   , 'itm_jw_48_mutton_biryani_f'),
    ('oit_jwd012'    , 'ord_jwdemo3'   , 'itm_jw_48_mutton_biryani_f'),
    ('oit_jwd013'    , 'ord_jwdemo1'   , 'itm_jw_11_chicken_tikka_f'),
    ('oit_jwd014'    , 'ord_jwdemo2'   , 'itm_jw_11_chicken_tikka_f'),
    ('oit_jwd015'    , 'ord_jwdemo3'   , 'itm_jw_11_chicken_tikka_f'),
    ('oit_jwd016'    , 'ord_jwdemo4'   , 'itm_jw_11_chicken_tikka_f'),
    ('oit_jwd017'    , 'ord_jwdemo1'   , 'itm_jw_10_tandoori_chicken_f'),
    ('oit_jwd018'    , 'ord_jwdemo2'   , 'itm_jw_10_tandoori_chicken_f'),
    ('oit_jwd019'    , 'ord_jwdemo3'   , 'itm_jw_10_tandoori_chicken_f'),
    ('oit_jwd020'    , 'ord_jwdemo1'   , 'itm_jw_64_paneer_tikka_f'),
    ('oit_jwd021'    , 'ord_jwdemo2'   , 'itm_jw_64_paneer_tikka_f'),
    ('oit_jwd022'    , 'ord_jwdemo3'   , 'itm_jw_64_paneer_tikka_f'),
    ('oit_jwd023'    , 'ord_jwdemo4'   , 'itm_jw_64_paneer_tikka_f'),
    ('oit_jwd024'    , 'ord_jwdemo1'   , 'itm_jw_62_daal_makhani'),
    ('oit_jwd025'    , 'ord_jwdemo2'   , 'itm_jw_62_daal_makhani'),
    ('oit_jwd026'    , 'ord_jwdemo3'   , 'itm_jw_62_daal_makhani'),
    ('oit_jwd027'    , 'ord_jwdemo4'   , 'itm_jw_62_daal_makhani'),
    ('oit_jwd028'    , 'ord_jwdemo1'   , 'itm_jw_79_butter_naan'),
    ('oit_jwd029'    , 'ord_jwdemo2'   , 'itm_jw_79_butter_naan'),
    ('oit_jwd030'    , 'ord_jwdemo3'   , 'itm_jw_79_butter_naan'),
    ('oit_jwd031'    , 'ord_jwdemo4'   , 'itm_jw_79_butter_naan'),
    ('oit_jwd032'    , 'ord_jwdemo5'   , 'itm_jw_79_butter_naan'),
    ('oit_jwd033'    , 'ord_jwdemo1'   , 'itm_jw_82_garlic_naan'),
    ('oit_jwd034'    , 'ord_jwdemo2'   , 'itm_jw_82_garlic_naan'),
    ('oit_jwd035'    , 'ord_jwdemo3'   , 'itm_jw_82_garlic_naan'),
    ('oit_jwd036'    , 'ord_jwdemo1'   , 'itm_jw_71_tandoori_roti'),
    ('oit_jwd037'    , 'ord_jwdemo2'   , 'itm_jw_71_tandoori_roti'),
    ('oit_jwd038'    , 'ord_jwdemo3'   , 'itm_jw_71_tandoori_roti'),
    ('oit_jwd039'    , 'ord_jwdemo1'   , 'itm_jw_44_chicken_jawahar_special_f'),
    ('oit_jwd040'    , 'ord_jwdemo2'   , 'itm_jw_44_chicken_jawahar_special_f'),
    ('oit_jwd041'    , 'ord_jwdemo3'   , 'itm_jw_44_chicken_jawahar_special_f'),
    ('oit_jwd042'    , 'ord_jwdemo4'   , 'itm_jw_44_chicken_jawahar_special_f'),
    ('oit_jwd043'    , 'ord_jwdemo1'   , 'itm_jw_28_chicken_jahangiri_f'),
    ('oit_jwd044'    , 'ord_jwdemo2'   , 'itm_jw_28_chicken_jahangiri_f'),
    ('oit_jwd045'    , 'ord_jwdemo3'   , 'itm_jw_28_chicken_jahangiri_f'),
    ('oit_jwd046'    , 'ord_jwdemo1'   , 'itm_jw_20_mutton_qorma_f'),
    ('oit_jwd047'    , 'ord_jwdemo2'   , 'itm_jw_20_mutton_qorma_f'),
    ('oit_jwd048'    , 'ord_jwdemo3'   , 'itm_jw_20_mutton_qorma_f'),
    ('oit_jwd049'    , 'ord_jwdemo1'   , 'itm_jw_24_nahari_f'),
    ('oit_jwd050'    , 'ord_jwdemo2'   , 'itm_jw_24_nahari_f'),
    ('oit_jwd051'    , 'ord_jwdemo3'   , 'itm_jw_24_nahari_f'),
    ('oit_jwd052'    , 'ord_jwdemo1'   , 'itm_jw_53_mutton_seekh_kabab_1_pc'),
    ('oit_jwd053'    , 'ord_jwdemo2'   , 'itm_jw_53_mutton_seekh_kabab_1_pc'),
    ('oit_jwd054'    , 'ord_jwdemo3'   , 'itm_jw_53_mutton_seekh_kabab_1_pc'),
    ('oit_jwd055'    , 'ord_jwdemo4'   , 'itm_jw_53_mutton_seekh_kabab_1_pc'),
    ('oit_jwd056'    , 'ord_jwdemo1'   , 'itm_jw_57_shami_kabab_1_pc'),
    ('oit_jwd057'    , 'ord_jwdemo2'   , 'itm_jw_57_shami_kabab_1_pc'),
    ('oit_jwd058'    , 'ord_jwdemo3'   , 'itm_jw_57_shami_kabab_1_pc'),
    ('oit_jwd059'    , 'ord_jwdemo1'   , 'itm_jw_12_chicken_malai_tikka_f'),
    ('oit_jwd060'    , 'ord_jwdemo2'   , 'itm_jw_12_chicken_malai_tikka_f'),
    ('oit_jwd061'    , 'ord_jwdemo3'   , 'itm_jw_12_chicken_malai_tikka_f'),
    ('oit_jwd062'    , 'ord_jwdemo1'   , 'itm_jw_45_chicken_lababdar_boneless_f'),
    ('oit_jwd063'    , 'ord_jwdemo2'   , 'itm_jw_45_chicken_lababdar_boneless_f'),
    ('oit_jwd064'    , 'ord_jwdemo3'   , 'itm_jw_45_chicken_lababdar_boneless_f'),
    ('oit_jwd065'    , 'ord_jwdemo1'   , 'itm_jw_68_paneer_lababdar'),
    ('oit_jwd066'    , 'ord_jwdemo2'   , 'itm_jw_68_paneer_lababdar'),
    ('oit_jwd067'    , 'ord_jwdemo3'   , 'itm_jw_68_paneer_lababdar'),
    ('oit_jwd068'    , 'ord_jwdemo1'   , 'itm_jw_14_mutton_burra_f'),
    ('oit_jwd069'    , 'ord_jwdemo2'   , 'itm_jw_14_mutton_burra_f'),
    ('oit_jwd070'    , 'ord_jwdemo3'   , 'itm_jw_14_mutton_burra_f'),
    ('oit_jwd071'    , 'ord_jwdemo1'   , 'itm_jw_78_qeema_naan'),
    ('oit_jwd072'    , 'ord_jwdemo2'   , 'itm_jw_78_qeema_naan'),
    ('oit_jwd073'    , 'ord_jwdemo3'   , 'itm_jw_78_qeema_naan'),
    ('oit_jwd074'    , 'ord_jwdemo1'   , 'itm_jw_85_gulab_jamun'),
    ('oit_jwd075'    , 'ord_jwdemo2'   , 'itm_jw_85_gulab_jamun'),
    ('oit_jwd076'    , 'ord_jwdemo3'   , 'itm_jw_85_gulab_jamun'),
    ('oit_jwd077'    , 'ord_jwdemo1'   , 'itm_jw_84_kheer'),
    ('oit_jwd078'    , 'ord_jwdemo2'   , 'itm_jw_84_kheer'),
    ('oit_jwd079'    , 'ord_jwdemo3'   , 'itm_jw_84_kheer'),
    ('oit_jwd080'    , 'ord_jwdemo1'   , 'itm_jw_36_chicken_angara_f'),
    ('oit_jwd081'    , 'ord_jwdemo2'   , 'itm_jw_36_chicken_angara_f'),
    ('oit_jwd082'    , 'ord_jwdemo3'   , 'itm_jw_36_chicken_angara_f'),
    ('oit_jwd083'    , 'ord_jwdemo1'   , 'itm_jw_66_kadhai_paneer'),
    ('oit_jwd084'    , 'ord_jwdemo2'   , 'itm_jw_66_kadhai_paneer'),
    ('oit_jwd085'    , 'ord_jwdemo3'   , 'itm_jw_66_kadhai_paneer'),
    ('oit_jwd086'    , 'ord_jwdemo1'   , 'itm_jw_52_zeera_rice_f'),
    ('oit_jwd087'    , 'ord_jwdemo2'   , 'itm_jw_52_zeera_rice_f'),
    ('oit_jwd088'    , 'ord_jwdemo3'   , 'itm_jw_52_zeera_rice_f')
) AS v(uid, order_uid, item_uid)
JOIN orders o ON o.uid = v.order_uid
JOIN menu_item m ON m.uid = v.item_uid
ON CONFLICT (uid) DO NOTHING;

-- ----------------------------------------------------------------------------------------------
-- The ratings.
--
-- Tag and comment are carried on the first rating of each dish only. Every review having prose
-- attached is the tell that a feed is generated -- in real data most diners tap a star and stop,
-- which is the whole design of the one-tap flow (D16).
-- ----------------------------------------------------------------------------------------------
INSERT INTO order_item_review (
    uid, restaurant_id, order_id, order_item_id, menu_item_id, guest_session_id,
    rating, tags, comment, created_at, updated_at
)
SELECT v.uid, o.restaurant_id, o.id, oi.id, oi.menu_item_id, o.guest_session_id,
       v.rating, v.tags, v.comment,
       o.created_at + INTERVAL '80 min', o.created_at + INTERVAL '80 min'
FROM (VALUES
    ('rev_jwd001'    , 'oit_jwd001'    , 5, 'tasty'           , 'Properly buttery, not sweet.'),
    ('rev_jwd002'    , 'oit_jwd002'    , 5, ''                , ''),
    ('rev_jwd003'    , 'oit_jwd003'    , 4, ''                , ''),
    ('rev_jwd004'    , 'oit_jwd004'    , 5, ''                , ''),
    ('rev_jwd005'    , 'oit_jwd005'    , 5, ''                , ''),
    ('rev_jwd006'    , 'oit_jwd006'    , 5, 'good_portion'    , 'Enough for two.'),
    ('rev_jwd007'    , 'oit_jwd007'    , 4, ''                , ''),
    ('rev_jwd008'    , 'oit_jwd008'    , 5, ''                , ''),
    ('rev_jwd009'    , 'oit_jwd009'    , 5, ''                , ''),
    ('rev_jwd010'    , 'oit_jwd010'    , 5, 'tasty'           , ''),
    ('rev_jwd011'    , 'oit_jwd011'    , 5, ''                , ''),
    ('rev_jwd012'    , 'oit_jwd012'    , 4, ''                , ''),
    ('rev_jwd013'    , 'oit_jwd013'    , 5, 'well_presented'  , 'Good char on it.'),
    ('rev_jwd014'    , 'oit_jwd014'    , 4, ''                , ''),
    ('rev_jwd015'    , 'oit_jwd015'    , 5, ''                , ''),
    ('rev_jwd016'    , 'oit_jwd016'    , 4, ''                , ''),
    ('rev_jwd017'    , 'oit_jwd017'    , 4, 'tasty'           , ''),
    ('rev_jwd018'    , 'oit_jwd018'    , 5, ''                , ''),
    ('rev_jwd019'    , 'oit_jwd019'    , 4, ''                , ''),
    ('rev_jwd020'    , 'oit_jwd020'    , 5, 'fresh'           , ''),
    ('rev_jwd021'    , 'oit_jwd021'    , 5, ''                , ''),
    ('rev_jwd022'    , 'oit_jwd022'    , 4, ''                , ''),
    ('rev_jwd023'    , 'oit_jwd023'    , 5, ''                , ''),
    ('rev_jwd024'    , 'oit_jwd024'    , 5, 'tasty'           , 'Tastes slow-cooked.'),
    ('rev_jwd025'    , 'oit_jwd025'    , 4, ''                , ''),
    ('rev_jwd026'    , 'oit_jwd026'    , 4, ''                , ''),
    ('rev_jwd027'    , 'oit_jwd027'    , 5, ''                , ''),
    ('rev_jwd028'    , 'oit_jwd028'    , 5, ''                , ''),
    ('rev_jwd029'    , 'oit_jwd029'    , 4, ''                , ''),
    ('rev_jwd030'    , 'oit_jwd030'    , 5, ''                , ''),
    ('rev_jwd031'    , 'oit_jwd031'    , 4, ''                , ''),
    ('rev_jwd032'    , 'oit_jwd032'    , 5, ''                , ''),
    ('rev_jwd033'    , 'oit_jwd033'    , 5, 'fresh'           , ''),
    ('rev_jwd034'    , 'oit_jwd034'    , 5, ''                , ''),
    ('rev_jwd035'    , 'oit_jwd035'    , 4, ''                , ''),
    ('rev_jwd036'    , 'oit_jwd036'    , 4, ''                , ''),
    ('rev_jwd037'    , 'oit_jwd037'    , 4, ''                , ''),
    ('rev_jwd038'    , 'oit_jwd038'    , 5, ''                , ''),
    ('rev_jwd039'    , 'oit_jwd039'    , 5, 'tasty'           , 'Worth ordering once.'),
    ('rev_jwd040'    , 'oit_jwd040'    , 5, ''                , ''),
    ('rev_jwd041'    , 'oit_jwd041'    , 5, ''                , ''),
    ('rev_jwd042'    , 'oit_jwd042'    , 4, ''                , ''),
    ('rev_jwd043'    , 'oit_jwd043'    , 5, 'well_presented'  , ''),
    ('rev_jwd044'    , 'oit_jwd044'    , 4, ''                , ''),
    ('rev_jwd045'    , 'oit_jwd045'    , 5, ''                , ''),
    ('rev_jwd046'    , 'oit_jwd046'    , 4, 'tasty'           , ''),
    ('rev_jwd047'    , 'oit_jwd047'    , 5, ''                , ''),
    ('rev_jwd048'    , 'oit_jwd048'    , 4, ''                , ''),
    ('rev_jwd049'    , 'oit_jwd049'    , 5, 'worth_the_wait'  , 'Go early, it runs out.'),
    ('rev_jwd050'    , 'oit_jwd050'    , 4, ''                , ''),
    ('rev_jwd051'    , 'oit_jwd051'    , 5, ''                , ''),
    ('rev_jwd052'    , 'oit_jwd052'    , 5, 'tasty'           , ''),
    ('rev_jwd053'    , 'oit_jwd053'    , 5, ''                , ''),
    ('rev_jwd054'    , 'oit_jwd054'    , 4, ''                , ''),
    ('rev_jwd055'    , 'oit_jwd055'    , 4, ''                , ''),
    ('rev_jwd056'    , 'oit_jwd056'    , 4, ''                , ''),
    ('rev_jwd057'    , 'oit_jwd057'    , 4, ''                , ''),
    ('rev_jwd058'    , 'oit_jwd058'    , 5, ''                , ''),
    ('rev_jwd059'    , 'oit_jwd059'    , 5, 'tasty'           , ''),
    ('rev_jwd060'    , 'oit_jwd060'    , 4, ''                , ''),
    ('rev_jwd061'    , 'oit_jwd061'    , 4, ''                , ''),
    ('rev_jwd062'    , 'oit_jwd062'    , 4, 'good_portion'    , ''),
    ('rev_jwd063'    , 'oit_jwd063'    , 5, ''                , ''),
    ('rev_jwd064'    , 'oit_jwd064'    , 4, ''                , ''),
    ('rev_jwd065'    , 'oit_jwd065'    , 4, 'tasty'           , ''),
    ('rev_jwd066'    , 'oit_jwd066'    , 4, ''                , ''),
    ('rev_jwd067'    , 'oit_jwd067'    , 5, ''                , ''),
    ('rev_jwd068'    , 'oit_jwd068'    , 5, 'worth_the_wait'  , ''),
    ('rev_jwd069'    , 'oit_jwd069'    , 4, ''                , ''),
    ('rev_jwd070'    , 'oit_jwd070'    , 5, ''                , ''),
    ('rev_jwd071'    , 'oit_jwd071'    , 5, 'tasty'           , ''),
    ('rev_jwd072'    , 'oit_jwd072'    , 5, ''                , ''),
    ('rev_jwd073'    , 'oit_jwd073'    , 4, ''                , ''),
    ('rev_jwd074'    , 'oit_jwd074'    , 5, ''                , ''),
    ('rev_jwd075'    , 'oit_jwd075'    , 4, ''                , ''),
    ('rev_jwd076'    , 'oit_jwd076'    , 5, ''                , ''),
    ('rev_jwd077'    , 'oit_jwd077'    , 4, ''                , ''),
    ('rev_jwd078'    , 'oit_jwd078'    , 4, ''                , ''),
    ('rev_jwd079'    , 'oit_jwd079'    , 4, ''                , ''),
    ('rev_jwd080'    , 'oit_jwd080'    , 3, 'too_spicy'       , 'Hotter than we expected.'),
    ('rev_jwd081'    , 'oit_jwd081'    , 4, ''                , ''),
    ('rev_jwd082'    , 'oit_jwd082'    , 3, ''                , ''),
    ('rev_jwd083'    , 'oit_jwd083'    , 3, 'bland'           , ''),
    ('rev_jwd084'    , 'oit_jwd084'    , 3, ''                , ''),
    ('rev_jwd085'    , 'oit_jwd085'    , 4, ''                , ''),
    ('rev_jwd086'    , 'oit_jwd086'    , 3, 'served_cold'     , 'Arrived lukewarm.'),
    ('rev_jwd087'    , 'oit_jwd087'    , 2, ''                , ''),
    ('rev_jwd088'    , 'oit_jwd088'    , 4, ''                , '')
) AS v(uid, item_uid, rating, tags, comment)
JOIN order_item oi ON oi.uid = v.item_uid
JOIN orders o ON o.id = oi.order_id
ON CONFLICT (uid) DO NOTHING;

-- One service rating per sitting (D17). UNIQUE on guest_session_id, so exactly one row however
-- many orders the session placed -- which is the point of that key.
INSERT INTO service_review (
    uid, restaurant_id, guest_session_id, order_id, rating, tags, comment, created_at, updated_at
)
SELECT v.uid, o.restaurant_id, o.guest_session_id, o.id, v.rating, v.tags, v.comment,
       o.created_at + INTERVAL '82 min', o.created_at + INTERVAL '82 min'
FROM (VALUES
    ('svc_jwd1', 'ord_jwdemo1', 5, 'friendly_staff',   ''),
    ('svc_jwd2', 'ord_jwdemo2', 4, 'quick_service',    ''),
    ('svc_jwd3', 'ord_jwdemo3', 5, 'attentive',        'Looked after us well.'),
    ('svc_jwd4', 'ord_jwdemo4', 4, 'clean_table',      ''),
    ('svc_jwd5', 'ord_jwdemo5', 3, 'slow_service',     'Long wait between courses.'),
    ('svc_jwd6', 'ord_jwdemo6', 4, 'friendly_staff',   '')
) AS v(uid, order_uid, rating, tags, comment)
JOIN orders o ON o.uid = v.order_uid
ON CONFLICT (uid) DO NOTHING;

-- Bills recomputed FROM the lines rather than left as the zeros above. 5% GST; adjust if this
-- restaurant's tax_bps differs.
UPDATE orders o
SET subtotal_minor = t.sum,
    tax_minor      = ROUND(t.sum * (r.tax_bps / 10000.0)),
    total_minor    = t.sum + ROUND(t.sum * (r.tax_bps / 10000.0))
FROM (SELECT order_id, SUM(total_minor) AS sum FROM order_item GROUP BY order_id) t,
     restaurant r
WHERE o.id = t.order_id AND o.restaurant_id = r.id AND o.uid LIKE 'ord_jwdemo%';

-- Rebuild the denormalised aggregate FROM the rows just inserted, rather than hand-writing the
-- totals. This is migration 016's documented reconstruction query, so the counters cannot ship
-- disagreeing with the reviews they claim to summarise -- which scripts/concurrency.sh section D
-- asserts can never happen.
UPDATE menu_item m
SET rating_count = a.c, rating_sum = a.s
FROM (
    SELECT menu_item_id, COUNT(*) AS c, SUM(rating) AS s
    FROM order_item_review
    GROUP BY menu_item_id
) a
-- Scoped to this restaurant. The reconstruction is correct for any tenant, but a fixture has
-- no business writing rows that belong to someone else's restaurant on a shared database.
WHERE m.id = a.menu_item_id
  AND m.restaurant_id = (SELECT r.id FROM restaurant r JOIN jw_target t ON t.slug = r.slug);

DO $verify$
DECLARE
    rid INT := (SELECT r.id FROM restaurant r JOIN jw_target t ON t.slug = r.slug);
    revs INT; rated INT; loved INT;
BEGIN
    SELECT count(*) INTO revs  FROM order_item_review WHERE restaurant_id = rid;
    SELECT count(*) INTO rated FROM menu_item WHERE restaurant_id = rid AND rating_count > 0;
    -- Mirrors the diner rail: >= MinRatingsToPublish (3) and an average >= 4.
    SELECT count(*) INTO loved FROM menu_item
     WHERE restaurant_id = rid AND rating_count >= 3
       AND rating_sum::NUMERIC / rating_count >= 4;

    IF revs <> 88 THEN
        RAISE EXCEPTION 'expected 88 reviews, found % -- rolled back', revs;
    END IF;
    RAISE NOTICE 'Jawahar DEMO ratings: % reviews over % dishes, % qualify as Most Loved.',
        revs, rated, loved;
END
$verify$;

COMMIT;
