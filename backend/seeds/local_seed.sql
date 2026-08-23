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

COMMIT;

-- A short confirmation, so `make seed` shows that it worked rather than staying silent.
SELECT
    (SELECT COUNT(*) FROM restaurant)                                   AS restaurants,
    (SELECT COUNT(*) FROM staff_user)                                   AS staff,
    (SELECT COUNT(*) FROM restaurant_table)                             AS tables,
    (SELECT COUNT(*) FROM menu_category)                                AS categories,
    (SELECT COUNT(*) FROM menu_item)                                    AS items,
    (SELECT COUNT(*) FROM menu_item WHERE NOT is_available)              AS sold_out;
