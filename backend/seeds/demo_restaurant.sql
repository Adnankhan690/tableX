-- The public demo restaurant, for the "try it now" section of tabley.in.
--
-- A prospect trusts a menu they can open on their own phone far more than a screenshot, so this
-- creates a REAL restaurant with a real menu and real tables that strangers are invited to order
-- from. Everything about it is therefore chosen on the assumption that its URL will be posted in
-- public and poked at by people who are not customers.
--
-- WHY A SEPARATE RESTAURANT AND NOT A REAL ONE.
-- Pointing the landing page at a paying tenant walks strangers into that restaurant's live menu,
-- mints guest sessions on their tables, and puts test orders on the board their staff are working
-- from during service. The demo has to be its own tenant. That is also why tableX's multi-tenancy
-- (D3) is doing real work here rather than being an abstraction.
--
-- THE NAME IS OBVIOUSLY A DEMO, deliberately. "Spice Garden" would read as a real restaurant and
-- the ratings below would then be a claim about a real kitchen. "tableX Demo Kitchen" cannot be
-- mistaken for one, which is what makes seeded ratings honest here: they are sample data in a
-- sample restaurant, demonstrating a feature, not a review of anybody's food.
--
-- ORDERS PLACED HERE ARE REAL ROWS. Strangers will place them and nobody will cook them. That is
-- fine and expected -- it is the point -- but it means this restaurant's board fills with junk
-- over time. Clear it with the DELETE at the foot of this file whenever it gets noisy.
--
-- Safe to re-run: every insert is guarded. Re-running does NOT rotate the QR tokens, so a code
-- already printed or already on the landing page keeps working.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/seeds/demo_restaurant.sql
--   make seed SEED_FILE=backend/seeds/demo_restaurant.sql
--
-- Then set, in the diner app's environment:
--   NEXT_PUBLIC_DEMO_RESTAURANT_SLUG=demo
-- and redeploy. Until that is set the landing page omits the demo section entirely.

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- Restaurant
--
-- 5% GST and no service charge, so the cart breakdown shows a tax line without the demo implying
-- a service charge every restaurant does not levy. The UPI VPA is deliberately NOT a real one:
-- see the payment note below.
-- ---------------------------------------------------------------------------------------------
INSERT INTO restaurant (
    uid, name, slug, description, address, phone, currency, timezone,
    gst_number, tax_bps, service_charge_bps,
    upi_vpa, upi_payee_name, payment_provider, status
) VALUES (
    'rst_tableXdemo', 'tableX Demo Kitchen', 'demo',
    'A sample restaurant so you can try the ordering flow yourself. Orders here are not cooked.',
    'Sample menu · tableX', '+919999999999', 'INR', 'Asia/Kolkata',
    NULL, 500, 0,
    -- A VPA that cannot collect money. Pay-at-counter is the path a prospect should take, and a
    -- working VPA on a public demo is an invitation to send a stranger's money somewhere nobody
    -- is watching. The UPI screen still renders; the intent simply will not resolve to an account.
    'demo@tablexinvalid', 'tableX Demo Kitchen',
    'upi_static', 'active'
)
ON CONFLICT (uid) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- Tables
--
-- Tokens are RANDOM, generated here rather than hardcoded. local_seed.sql uses fixed tokens and
-- says loudly not to copy them into a deployed environment; this is a deployed environment.
--
-- gen_random_uuid() is pgcrypto/pg13+ builtin and gives 32 hex characters once the dashes are
-- stripped, which is the exact shape utils.GenerateQRToken() produces. ON CONFLICT DO NOTHING
-- means a second run keeps the tokens from the first, so a printed card is never invalidated by
-- re-running this file.
-- ---------------------------------------------------------------------------------------------
INSERT INTO restaurant_table (uid, restaurant_id, label, qr_token, seats, status)
SELECT v.uid, r.id, v.label, replace(gen_random_uuid()::text, '-', ''), v.seats, 'active'
FROM restaurant r
CROSS JOIN (VALUES
    ('tbl_demo_1', '1', 2),
    ('tbl_demo_2', '2', 4),
    ('tbl_demo_3', '3', 4),
    ('tbl_demo_4', '4', 6)
) AS v(uid, label, seats)
WHERE r.slug = 'demo'
ON CONFLICT (uid) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- Staff
--
-- An owner login exists because the restaurant needs one to be administrable, NOT because the
-- credentials go on the landing page. DO NOT PUBLISH THESE. admin.tabley.in is a real console
-- over real tenants, and a public login to any account on it is a public login to the console.
--
-- The password hash below is bcrypt cost 12 of a value that is not written down anywhere in this
-- repo. Reset it with the password-reset flow before first use, or replace this hash with your
-- own. It is deliberately NOT the "password123" that local_seed.sql uses.
-- ---------------------------------------------------------------------------------------------
INSERT INTO staff_user (uid, restaurant_id, email, password_hash, name, role, status)
SELECT 'stf_demoowner_pub', r.id, 'demo-owner@tabley.in',
       '$2a$12$HN06UaxL9rImoi8Vd4.BveoYpYT3Hp9Gx5Ox9aN36lBtA7lRP1O/q',
       'Demo Owner', 'owner', 'active'
FROM restaurant r
WHERE r.slug = 'demo'
ON CONFLICT (uid) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- Menu
--
-- Small on purpose: twenty-one dishes across six categories. A prospect is evaluating the
-- EXPERIENCE, and a 142-row menu makes them scroll rather than understand. It is chosen to
-- exercise every feature the landing page claims -- veg, non-veg and egg marks, a bestseller, a
-- sold-out dish, prep times, spice levels, descriptions and half/full portions.
-- ---------------------------------------------------------------------------------------------
INSERT INTO menu_category (uid, restaurant_id, name, description, sort_order, status)
SELECT v.uid, r.id, v.name, v.description, v.sort_order, 'active'
FROM restaurant r
CROSS JOIN (VALUES
    ('cat_demo_starters', 'Starters',    'From the tandoor and the fryer', 10),
    ('cat_demo_mains',    'Main Course', 'Curries, dal and paneer',        20),
    ('cat_demo_biryani',  'Biryani',     'Slow-cooked, with raita',        30),
    ('cat_demo_breads',   'Breads',      NULL,                             40),
    ('cat_demo_drinks',   'Drinks',      NULL,                             50),
    ('cat_demo_desserts', 'Desserts',    NULL,                             60)
) AS v(uid, name, description, sort_order)
WHERE r.slug = 'demo'
ON CONFLICT (uid) DO NOTHING;

INSERT INTO menu_item (
    uid, restaurant_id, category_id, name, description, price_minor,
    food_type, spice_level, is_available, is_bestseller, prep_time_mins, sort_order, status
)
SELECT v.uid, r.id, c.id, v.name, v.description, v.price_minor,
       v.food_type, v.spice_level, v.is_available, v.is_bestseller,
       v.prep_time_mins, v.sort_order, 'active'
FROM restaurant r
CROSS JOIN (VALUES
    -- Starters
    ('itm_demo_paneertikka',  'cat_demo_starters', 'Paneer Tikka',        'Cottage cheese marinated in yoghurt and spices, char-grilled', 28000, 'veg',     'medium', TRUE,  TRUE,  18, 10),
    ('itm_demo_vegpakora',    'cat_demo_starters', 'Mixed Veg Pakora',    'Onion, potato and spinach fritters with mint chutney',        16000, 'veg',     'mild',   TRUE,  FALSE, 12, 20),
    ('itm_demo_chickentikka', 'cat_demo_starters', 'Chicken Tikka',       'Boneless thigh, overnight marinade, from the tandoor',        34000, 'non_veg', 'medium', TRUE,  TRUE,  22, 30),
    ('itm_demo_eggchilli',    'cat_demo_starters', 'Egg Chilli',          'Tossed with capsicum and onion, Indo-Chinese style',          19000, 'egg',     'hot',    TRUE,  FALSE, 15, 40),
    -- A dish that is sold out, so the "greyed and labelled, still on the page" behaviour the
    -- landing page describes is visible to anyone who opens the demo.
    ('itm_demo_fishfry',      'cat_demo_starters', 'Amritsari Fish',      'Gram-flour battered, ajwain and lemon',                       42000, 'non_veg', 'medium', FALSE, FALSE, 20, 50),

    -- Main Course
    ('itm_demo_dalmakhani',   'cat_demo_mains', 'Dal Makhani',        'Black lentils, slow-cooked overnight with butter and cream', 26000, 'veg',     'mild',   TRUE, TRUE,  15, 10),
    ('itm_demo_paneerbm',     'cat_demo_mains', 'Paneer Butter Masala','Tomato and cashew gravy, mildly sweet',                      30000, 'veg',     'mild',   TRUE, TRUE,  18, 20),
    ('itm_demo_kadaipaneer',  'cat_demo_mains', 'Kadai Paneer',       'Bell peppers, onion and freshly ground kadai masala',         30000, 'veg',     'medium', TRUE, FALSE, 18, 30),
    ('itm_demo_butterchicken','cat_demo_mains', 'Butter Chicken',     'Tomato, butter and kasuri methi. The classic.',               38000, 'non_veg', 'mild',   TRUE, TRUE,  22, 40),
    ('itm_demo_roganjosh',    'cat_demo_mains', 'Mutton Rogan Josh',  'Kashmiri chillies, slow-braised shoulder',                    48000, 'non_veg', 'hot',    TRUE, FALSE, 30, 50),
    ('itm_demo_eggcurry',     'cat_demo_mains', 'Egg Curry',          'Boiled eggs in an onion-tomato masala',                       22000, 'egg',     'medium', TRUE, FALSE, 15, 60),

    -- Biryani, with half and full portions so the portion pattern is visible
    ('itm_demo_vegbiryani_h', 'cat_demo_biryani', 'Vegetable Biryani (Half)',   'Dum-cooked, saffron and fried onion',        18000, 'veg',     'medium', TRUE, FALSE, 25, 10),
    ('itm_demo_vegbiryani_f', 'cat_demo_biryani', 'Vegetable Biryani (Full)',   'Dum-cooked, saffron and fried onion',        29000, 'veg',     'medium', TRUE, FALSE, 25, 11),
    ('itm_demo_chkbiryani_h', 'cat_demo_biryani', 'Chicken Biryani (Half)',     'Kacchi dum, served with mirchi ka salan',    22000, 'non_veg', 'hot',    TRUE, FALSE, 30, 20),
    ('itm_demo_chkbiryani_f', 'cat_demo_biryani', 'Chicken Biryani (Full)',     'Kacchi dum, served with mirchi ka salan',    37000, 'non_veg', 'hot',    TRUE, TRUE,  30, 21),

    -- Breads
    ('itm_demo_tandooriroti', 'cat_demo_breads', 'Tandoori Roti', 'Whole wheat, from the tandoor', 3500, 'veg', NULL, TRUE, FALSE,  8, 10),
    ('itm_demo_butternaan',   'cat_demo_breads', 'Butter Naan',   'Brushed with butter',           5500, 'veg', NULL, TRUE, TRUE,   8, 20),
    ('itm_demo_garlicnaan',   'cat_demo_breads', 'Garlic Naan',   'Fresh garlic and coriander',    6500, 'veg', NULL, TRUE, FALSE,  8, 30),

    -- Drinks
    ('itm_demo_masalachai',   'cat_demo_drinks', 'Masala Chai',  'Cardamom, ginger and clove', 6000, 'veg', NULL, TRUE, FALSE, 6, 10),
    ('itm_demo_sweetlassi',   'cat_demo_drinks', 'Sweet Lassi',  'Thick, churned yoghurt',     9000, 'veg', NULL, TRUE, TRUE,  5, 20),

    -- Dessert
    ('itm_demo_gulabjamun',   'cat_demo_desserts', 'Gulab Jamun', 'Two pieces, warm sugar syrup', 12000, 'veg', NULL, TRUE, FALSE, 5, 10)
) AS v(uid, category_uid, name, description, price_minor, food_type, spice_level,
       is_available, is_bestseller, prep_time_mins, sort_order)
JOIN menu_category c ON c.restaurant_id = r.id AND c.uid = v.category_uid
WHERE r.slug = 'demo'
ON CONFLICT (uid) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- Sample ratings.
--
-- SEEDED RATINGS ARE HONEST HERE AND DISHONEST ON A REAL RESTAURANT, and the difference is worth
-- stating because it is the whole reason this file exists separately. On a paying tenant's menu a
-- seeded "4.8" is a claim about a kitchen that real diners are choosing food from, and the first
-- genuine review lands on top of invented votes it can never recover from. Here the restaurant is
-- called "tableX Demo Kitchen", it cooks nothing, and the ratings exist to demonstrate that the
-- rating feature works at all. Nobody is misled about anybody's food.
--
-- Counters are set directly rather than through review rows: the aggregate is what the menu reads
-- (migration 016), and manufacturing orders and guest sessions to back it would put junk on the
-- demo board for no visible gain. The consequence is that the admin reviews feed will show these
-- dishes with a score and no underlying reviews, which is correct -- they have none.
--
-- Five dishes clear the Most Loved floor (>= 3 ratings and an average >= 4.0 -- MinRatingsToPublish
-- and MOST_LOVED_MIN_AVERAGE) and the rail picks its top three from them, so the ordering is doing
-- visible work rather than just listing whatever qualified. One dish sits below the floor on
-- purpose, to prove the floor exists.
-- ---------------------------------------------------------------------------------------------
UPDATE menu_item m
SET rating_count = v.c, rating_sum = v.s
FROM (VALUES
    ('itm_demo_butterchicken', 14, 67),  -- 4.8
    ('itm_demo_paneertikka',   11, 52),  -- 4.7
    ('itm_demo_chkbiryani_f',   9, 41),  -- 4.6
    ('itm_demo_dalmakhani',     7, 30),  -- 4.3
    ('itm_demo_butternaan',     6, 25),  -- 4.2
    ('itm_demo_vegpakora',      4, 14)   -- 3.5, below the Most Loved floor on purpose
) AS v(uid, c, s)
WHERE m.uid = v.uid
  AND m.restaurant_id = (SELECT id FROM restaurant WHERE slug = 'demo');

DO $verify$
DECLARE
    rid    INT := (SELECT id FROM restaurant WHERE slug = 'demo');
    items  INT;
    tables INT;
    loved  INT;
    tok    TEXT;
BEGIN
    IF rid IS NULL THEN
        RAISE EXCEPTION 'the demo restaurant was not created';
    END IF;

    SELECT count(*) INTO items  FROM menu_item        WHERE restaurant_id = rid AND status = 'active';
    SELECT count(*) INTO tables FROM restaurant_table WHERE restaurant_id = rid AND status = 'active';
    SELECT count(*) INTO loved  FROM menu_item
     WHERE restaurant_id = rid AND rating_count >= 3 AND rating_sum::NUMERIC / rating_count >= 4;
    SELECT qr_token INTO tok FROM restaurant_table WHERE restaurant_id = rid ORDER BY id LIMIT 1;

    IF items <> 21 THEN
        RAISE EXCEPTION 'expected 21 dishes, found % -- rolled back', items;
    END IF;

    RAISE NOTICE 'Demo restaurant ready: % dishes, % tables, % most-loved.', items, tables, loved;
    RAISE NOTICE 'Menu:  https://tabley.in/r/demo';
    RAISE NOTICE 'Table: https://tabley.in/t/%', tok;
    RAISE NOTICE 'Now set NEXT_PUBLIC_DEMO_RESTAURANT_SLUG=demo and redeploy the diner app.';
END
$verify$;

COMMIT;

-- ---------------------------------------------------------------------------------------------
-- HOUSEKEEPING -- run this on its own whenever the demo board fills with strangers' test orders.
-- It clears the traffic and leaves the restaurant, menu and QR tokens untouched.
--
--   BEGIN;
--   DELETE FROM order_item_review WHERE restaurant_id = (SELECT id FROM restaurant WHERE slug='demo');
--   DELETE FROM service_review    WHERE restaurant_id = (SELECT id FROM restaurant WHERE slug='demo');
--   DELETE FROM order_status_event WHERE order_id IN (SELECT id FROM orders WHERE restaurant_id = (SELECT id FROM restaurant WHERE slug='demo'));
--   DELETE FROM order_item        WHERE order_id  IN (SELECT id FROM orders WHERE restaurant_id = (SELECT id FROM restaurant WHERE slug='demo'));
--   DELETE FROM payment           WHERE order_id  IN (SELECT id FROM orders WHERE restaurant_id = (SELECT id FROM restaurant WHERE slug='demo'));
--   DELETE FROM orders            WHERE restaurant_id = (SELECT id FROM restaurant WHERE slug='demo');
--   DELETE FROM guest_session     WHERE restaurant_id = (SELECT id FROM restaurant WHERE slug='demo');
--   COMMIT;
-- ---------------------------------------------------------------------------------------------
