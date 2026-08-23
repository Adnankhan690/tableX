-- tableX local demo data.
--
-- One restaurant, a realistic North Indian menu, eight tables with QR tokens, and three
-- staff logins. Idempotent: every insert is guarded, so `make seed` can be run repeatedly
-- without duplicating rows or failing on a unique constraint.
--
-- The QR tokens here are FIXED so that a developer's scan URL survives a reseed and can be
-- bookmarked. That is safe for local data and would be a serious mistake in any deployed
-- environment, where tokens must be random -- see the warning below.
--
-- Staff logins (all three): password123
--   owner@spicegarden.test    owner
--   manager@spicegarden.test  manager
--   staff@spicegarden.test    staff

BEGIN;

-- ---------------------------------------------------------------------------
-- Restaurant
-- ---------------------------------------------------------------------------
INSERT INTO restaurant (
    uid, name, slug, description, address, phone, currency, timezone,
    gst_number, tax_bps, service_charge_bps,
    upi_vpa, upi_payee_name, payment_provider, status
) VALUES (
    'rst_demospicegarden', 'Spice Garden', 'spice-garden',
    'North Indian and Mughlai, since 1998.',
    '12 MG Road, Bengaluru 560001', '+919876543210', 'INR', 'Asia/Kolkata',
    '29ABCDE1234F1Z5',
    -- 5% GST, no service charge -- the common configuration for a mid-size dine-in place.
    500, 0,
    'spicegarden@okhdfcbank', 'Spice Garden',
    'upi_static', 'active'
)
ON CONFLICT (uid) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Staff logins
--
-- bcrypt cost 12, matching config.Defaults().Auth.BcryptCost so the application verifies
-- these without a rehash. The hash below was generated and round-trip verified against
-- "password123".
-- ---------------------------------------------------------------------------
INSERT INTO staff_user (uid, restaurant_id, email, password_hash, name, role, status)
SELECT v.uid, r.id, v.email,
       '$2a$12$HN06UaxL9rImoi8Vd4.BveoYpYT3Hp9Gx5Ox9aN36lBtA7lRP1O/q',
       v.name, v.role, 'active'
FROM restaurant r
CROSS JOIN (VALUES
    ('stf_demoowner',   'owner@spicegarden.test',   'Rajesh Kumar',  'owner'),
    ('stf_demomanager', 'manager@spicegarden.test', 'Priya Sharma',  'manager'),
    ('stf_demostaff',   'staff@spicegarden.test',   'Arun Nair',     'staff')
) AS v(uid, email, name, role)
WHERE r.slug = 'spice-garden'
ON CONFLICT (uid) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tables
--
-- !! LOCAL ONLY !!
-- These qr_token values are fixed and therefore guessable. In any deployed environment
-- tokens MUST come from utils.GenerateQRToken() -- a predictable token lets a stranger
-- order onto someone else's table and leaks the floor size (docs/DECISIONS.md D4).
-- Never copy this block into a staging or production seed.
-- ---------------------------------------------------------------------------
INSERT INTO restaurant_table (uid, restaurant_id, label, qr_token, seats, status)
SELECT v.uid, r.id, v.label, v.qr_token, v.seats, 'active'
FROM restaurant r
CROSS JOIN (VALUES
    ('tbl_demo01', '1',  'demolocaltablequrtoken0000000001', 2),
    ('tbl_demo02', '2',  'demolocaltablequrtoken0000000002', 2),
    ('tbl_demo03', '3',  'demolocaltablequrtoken0000000003', 4),
    ('tbl_demo04', '4',  'demolocaltablequrtoken0000000004', 4),
    ('tbl_demo05', '5',  'demolocaltablequrtoken0000000005', 4),
    ('tbl_demo06', '6',  'demolocaltablequrtoken0000000006', 6),
    ('tbl_demo07', '7',  'demolocaltablequrtoken0000000007', 6),
    ('tbl_demo08', 'Patio 1', 'demolocaltablequrtoken0000000008', 8)
) AS v(uid, label, qr_token, seats)
WHERE r.slug = 'spice-garden'
ON CONFLICT (uid) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Menu categories
--
-- sort_order follows kitchen convention, which is neither alphabetical nor insertion order.
-- ---------------------------------------------------------------------------
INSERT INTO menu_category (uid, restaurant_id, name, description, sort_order, status)
SELECT v.uid, r.id, v.name, v.description, v.sort_order, 'active'
FROM restaurant r
CROSS JOIN (VALUES
    ('cat_demostarters',  'Starters',    'Tandoori and fried',            10),
    ('cat_demomains',     'Main Course', 'Curries, dal and sabzi',        20),
    ('cat_demobiryani',   'Biryani',     'Slow-cooked, served with raita', 30),
    ('cat_demobreads',    'Breads',      'From the tandoor',              40),
    ('cat_demorice',      'Rice',        NULL,                            50),
    ('cat_demobeverages', 'Beverages',   NULL,                            60),
    ('cat_demodesserts',  'Desserts',    NULL,                            70)
) AS v(uid, name, description, sort_order)
WHERE r.slug = 'spice-garden'
ON CONFLICT (uid) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Menu items
--
-- Prices are integer paise (docs/DECISIONS.md D7): 24900 is Rs 249.00.
-- Every item carries a food_type, because an unlabelled dish is unorderable for a large
-- share of diners in this market (PRD 6.2).
-- ---------------------------------------------------------------------------
INSERT INTO menu_item (
    uid, restaurant_id, category_id, name, description,
    price_minor, food_type, spice_level, is_available, is_bestseller,
    prep_time_mins, sort_order, status
)
SELECT v.uid, r.id, c.id, v.name, v.description,
       v.price_minor, v.food_type, v.spice_level, v.is_available, v.is_bestseller,
       v.prep_time_mins, v.sort_order, 'active'
FROM restaurant r
JOIN menu_category c ON c.restaurant_id = r.id AND c.uid = ANY (ARRAY[
    'cat_demostarters','cat_demomains','cat_demobiryani','cat_demobreads',
    'cat_demorice','cat_demobeverages','cat_demodesserts'])
CROSS JOIN (VALUES
    -- Starters
    ('itm_demopaneertikka','cat_demostarters','Paneer Tikka','Cottage cheese marinated in yoghurt and spices, char-grilled',      28000,'veg',    'medium',TRUE, TRUE, 18,10),
    ('itm_demovegpakora',  'cat_demostarters','Mixed Veg Pakora','Onion, potato and spinach fritters with mint chutney',          16000,'veg',    'mild',  TRUE, FALSE,12,20),
    ('itm_demochickentikka','cat_demostarters','Chicken Tikka','Boneless thigh, overnight marinade, tandoor',                     34000,'non_veg','medium',TRUE, TRUE, 22,30),
    ('itm_demofishamritsari','cat_demostarters','Amritsari Fish','Gram-flour battered, ajwain and lemon',                          42000,'non_veg','medium',TRUE, FALSE,20,40),
    ('itm_demoeggchilli',  'cat_demostarters','Egg Chilli','Indo-Chinese, tossed with capsicum and onion',                        19000,'egg',    'hot',   TRUE, FALSE,15,50),

    -- Main Course
    ('itm_demodalmakhani', 'cat_demomains','Dal Makhani','Black lentils, slow-cooked overnight with butter and cream',            26000,'veg',    'mild',  TRUE, TRUE, 15,10),
    ('itm_demopaneerbm',   'cat_demomains','Paneer Butter Masala','Tomato and cashew gravy, mildly sweet',                        30000,'veg',    'mild',  TRUE, TRUE, 18,20),
    ('itm_demopalakpaneer','cat_demomains','Palak Paneer','Spinach, garlic and cottage cheese',                                   28000,'veg',    'mild',  TRUE, FALSE,18,30),
    ('itm_demobutterchicken','cat_demomains','Butter Chicken','The classic -- tomato, butter, kasuri methi',                       38000,'non_veg','mild',  TRUE, TRUE, 22,40),
    ('itm_demoroganjosh',  'cat_demomains','Mutton Rogan Josh','Kashmiri chillies, slow-braised shoulder',                        48000,'non_veg','hot',   TRUE, FALSE,30,50),
    ('itm_demokadaipaneer','cat_demomains','Kadai Paneer','Bell peppers, onion, freshly ground kadai masala',                     30000,'veg',    'medium',FALSE,FALSE,18,60),
    ('itm_demoeggcurry',   'cat_demomains','Egg Curry','Boiled eggs in onion-tomato masala',                                      22000,'egg',    'medium',TRUE, FALSE,15,70),

    -- Biryani
    ('itm_demovegbiryani', 'cat_demobiryani','Vegetable Biryani','Dum-cooked, saffron, fried onion',                              29000,'veg',    'medium',TRUE, FALSE,25,10),
    ('itm_demochickenbiryani','cat_demobiryani','Hyderabadi Chicken Biryani','Kacchi dum, served with mirchi ka salan',            37000,'non_veg','hot',   TRUE, TRUE, 30,20),
    ('itm_demomuttonbiryani','cat_demobiryani','Mutton Biryani','Long-grain basmati, bone-in mutton',                             46000,'non_veg','hot',   TRUE, FALSE,35,30),

    -- Breads
    ('itm_demotandooriroti','cat_demobreads','Tandoori Roti','Whole wheat',                                                        3500,'veg',    NULL,    TRUE, FALSE, 8,10),
    ('itm_demobuttternaan','cat_demobreads','Butter Naan','Refined flour, brushed with butter',                                    5500,'veg',    NULL,    TRUE, TRUE,  8,20),
    ('itm_demogarlicnaan', 'cat_demobreads','Garlic Naan','Fresh garlic and coriander',                                            6500,'veg',    NULL,    TRUE, TRUE,  8,30),
    ('itm_demolachhaparatha','cat_demobreads','Lachha Paratha','Layered, flaky',                                                   6000,'veg',    NULL,    TRUE, FALSE, 10,40),

    -- Rice
    ('itm_demojeerarice',  'cat_demorice','Jeera Rice','Basmati tempered with cumin',                                             16000,'veg',    NULL,    TRUE, FALSE,12,10),
    ('itm_demosteamedrice','cat_demorice','Steamed Rice',NULL,                                                                    12000,'veg',    NULL,    TRUE, FALSE,10,20),

    -- Beverages
    ('itm_demomasalachai', 'cat_demobeverages','Masala Chai','Cardamom, ginger, clove',                                            6000,'veg',    NULL,    TRUE, FALSE, 6,10),
    ('itm_demosweetlassi', 'cat_demobeverages','Sweet Lassi','Thick, churned yoghurt',                                             9000,'veg',    NULL,    TRUE, TRUE,  5,20),
    ('itm_demomasalalime', 'cat_demobeverages','Masala Lime Soda','Fresh lime, black salt, soda',                                  8000,'veg',    NULL,    TRUE, FALSE, 4,30),
    ('itm_demofilterkaapi','cat_demobeverages','Filter Coffee','Chicory blend, served hot',                                        7000,'veg',    NULL,    TRUE, FALSE, 6,40),

    -- Desserts
    ('itm_demogulabjamun', 'cat_demodesserts','Gulab Jamun','Two pieces, warm sugar syrup',                                        12000,'veg',    NULL,    TRUE, TRUE,  5,10),
    ('itm_demogajarhalwa', 'cat_demodesserts','Gajar Halwa','Slow-cooked carrot, ghee, khoya',                                     14000,'veg',    NULL,    TRUE, FALSE, 8,20),
    ('itm_demorasmalai',   'cat_demodesserts','Ras Malai','Chilled, saffron and pistachio',                                        15000,'veg',    NULL,    FALSE,FALSE, 5,30)
) AS v(uid, category_uid, name, description, price_minor, food_type, spice_level,
       is_available, is_bestseller, prep_time_mins, sort_order)
WHERE r.slug = 'spice-garden' AND c.uid = v.category_uid
ON CONFLICT (uid) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Second restaurant: Coastal Curry.
--
-- Exists to exercise the multi-tenant path that DECISIONS.md D3 built for. Two restaurants is the
-- smallest number that proves tenant scoping actually works -- with one, every query returns the
-- right rows by accident.
--
-- Deliberately different in the ways that matter: a service charge (Spice Garden has none), a
-- different tax rate, its own UPI account, and a menu with no overlap. A second restaurant that
-- was a copy of the first would not catch a query that ignores restaurant_id.
-- ---------------------------------------------------------------------------

INSERT INTO restaurant (
    uid, name, slug, description, address, phone, currency, timezone,
    gst_number, tax_bps, service_charge_bps,
    upi_vpa, upi_payee_name, payment_provider, status
) VALUES (
    'rst_democoastalcurry', 'Coastal Curry', 'coastal-curry',
    'Mangalorean and Kerala seafood, cooked to order.',
    '48 Beach Road, Kochi 682001', '+919812345678', 'INR', 'Asia/Kolkata',
    '32FGHIJ5678K1Z9',
    -- 5% GST plus a 10% service charge, so the cart breakdown renders a line Spice Garden never
    -- shows and the totals arithmetic is exercised with both rates non-zero.
    500, 1000,
    'coastalcurry@okaxis', 'Coastal Curry',
    'upi_static', 'active'
)
ON CONFLICT (uid) DO NOTHING;

INSERT INTO staff_user (uid, restaurant_id, email, password_hash, name, role, status)
SELECT v.uid, r.id, v.email,
       '$2a$12$HN06UaxL9rImoi8Vd4.BveoYpYT3Hp9Gx5Ox9aN36lBtA7lRP1O/q',
       v.name, v.role, 'active'
FROM restaurant r
CROSS JOIN (VALUES
    ('stf_ccowner', 'owner@coastalcurry.test', 'Meera Menon', 'owner'),
    ('stf_ccstaff', 'staff@coastalcurry.test', 'Joseph Dsouza', 'staff')
) AS v(uid, email, name, role)
WHERE r.slug = 'coastal-curry'
ON CONFLICT (uid) DO NOTHING;

-- !! LOCAL ONLY !! Fixed qr_tokens so a developer's scan URL survives a reseed. In any deployed
-- environment these MUST come from utils.GenerateQRToken() -- a predictable token lets a stranger
-- order onto someone else's table (DECISIONS.md D4).
INSERT INTO restaurant_table (uid, restaurant_id, label, qr_token, seats, status)
SELECT v.uid, r.id, v.label, v.qr_token, v.seats, 'active'
FROM restaurant r
CROSS JOIN (VALUES
    ('tbl_cc01', '1',   'demolocalcoastaltabletoken000001', 2),
    ('tbl_cc02', '2',   'demolocalcoastaltabletoken000002', 4),
    ('tbl_cc03', '3',   'demolocalcoastaltabletoken000003', 4),
    ('tbl_cc04', 'Sea 1', 'demolocalcoastaltabletoken000004', 6)
) AS v(uid, label, qr_token, seats)
WHERE r.slug = 'coastal-curry'
ON CONFLICT (uid) DO NOTHING;

INSERT INTO menu_category (uid, restaurant_id, name, description, sort_order, status)
SELECT v.uid, r.id, v.name, v.description, v.sort_order, 'active'
FROM restaurant r
CROSS JOIN (VALUES
    ('cat_ccstarters', 'Starters',  'Fried and tawa-grilled',      10),
    ('cat_cccurries',  'Curries',   'Coconut, tamarind, kokum',    20),
    ('cat_ccrice',     'Rice',      'Neer dosa, appam, rice',      30),
    ('cat_ccdrinks',   'Drinks',    NULL,                          40)
) AS v(uid, name, description, sort_order)
WHERE r.slug = 'coastal-curry'
ON CONFLICT (uid) DO NOTHING;

INSERT INTO menu_item (
    uid, restaurant_id, category_id, name, description,
    price_minor, food_type, spice_level, is_available, is_bestseller,
    prep_time_mins, sort_order, status
)
SELECT v.uid, r.id, c.id, v.name, v.description,
       v.price_minor, v.food_type, v.spice_level, v.is_available, v.is_bestseller,
       v.prep_time_mins, v.sort_order, 'active'
FROM restaurant r
JOIN menu_category c
  ON c.restaurant_id = r.id
 AND c.uid = ANY (ARRAY['cat_ccstarters','cat_cccurries','cat_ccrice','cat_ccdrinks'])
CROSS JOIN (VALUES
    ('itm_ccfishfry',    'cat_ccstarters','Anjal Fish Fry','Kingfish, rava crust, curry leaves',        48000,'non_veg','medium',TRUE, TRUE, 20,10),
    ('itm_ccprawnkoliwada','cat_ccstarters','Prawn Koliwada','Batter-fried, chaat masala',              44000,'non_veg','hot',   TRUE, FALSE,18,20),
    ('itm_ccrawabhindi', 'cat_ccstarters','Rawa Bhindi','Semolina-crusted okra',                        22000,'veg',    'mild',  TRUE, FALSE,14,30),
    ('itm_ccfishcurry',  'cat_cccurries', 'Meen Curry','Kerala fish curry, kokum and coconut',          46000,'non_veg','hot',   TRUE, TRUE, 25,10),
    ('itm_ccprawnghee',  'cat_cccurries', 'Ghee Roast Prawn','Mangalorean, dry and fiery',              52000,'non_veg','hot',   TRUE, TRUE, 25,20),
    ('itm_ccchickenstew','cat_cccurries', 'Nadan Chicken Stew','Coconut milk, black pepper',            38000,'non_veg','mild',  TRUE, FALSE,28,30),
    ('itm_ccolan',   'cat_cccurries', 'Olan','Ash gourd and cowpeas in coconut milk',               24000,'veg',    'mild',  TRUE, FALSE,20,40),
    ('itm_cccrabmasala', 'cat_cccurries', 'Crab Masala','Whole crab, roasted spice',                    68000,'non_veg','hot',   FALSE,FALSE,35,50),
    ('itm_ccneerdosa',   'cat_ccrice',    'Neer Dosa','Three pieces, rice batter',                       9000,'veg',    NULL,    TRUE, TRUE,  8,10),
    ('itm_ccappam',      'cat_ccrice',    'Appam','Two pieces, coconut milk',                            9500,'veg',    NULL,    TRUE, FALSE, 8,20),
    ('itm_ccmatta',      'cat_ccrice',    'Kerala Matta Rice',NULL,                                     14000,'veg',    NULL,    TRUE, FALSE,12,30),
    ('itm_cctendercoco', 'cat_ccdrinks',  'Tender Coconut','Served in the shell',                        8000,'veg',    NULL,    TRUE, TRUE,  3,10),
    ('itm_ccsolkadhi',   'cat_ccdrinks',  'Sol Kadhi','Kokum and coconut, chilled',                      7000,'veg',    NULL,    TRUE, FALSE, 4,20),
    ('itm_ccfilterkaapi','cat_ccdrinks',  'Filter Coffee',NULL,                                          7000,'veg',    NULL,    TRUE, FALSE, 6,30)
) AS v(uid, category_uid, name, description, price_minor, food_type, spice_level,
       is_available, is_bestseller, prep_time_mins, sort_order)
WHERE r.slug = 'coastal-curry' AND c.uid = v.category_uid
ON CONFLICT (uid) DO NOTHING;

COMMIT;

-- A short confirmation, so `make seed` shows that it worked rather than staying silent.
SELECT
    (SELECT COUNT(*) FROM restaurant)                                   AS restaurants,
    (SELECT COUNT(*) FROM staff_user)                                   AS staff,
    (SELECT COUNT(*) FROM restaurant_table)                             AS tables,
    (SELECT COUNT(*) FROM menu_category)                                AS categories,
    (SELECT COUNT(*) FROM menu_item)                                    AS items,
    (SELECT COUNT(*) FROM menu_item WHERE NOT is_available)              AS sold_out;
