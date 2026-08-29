-- Jawahar -- full menu, transcribed from the printed boards (items 1-85).
--
-- This is a PRODUCTION data file, not demo data. It differs from local_seed.sql in three
-- ways that matter:
--
--   1. It touches NOTHING but the menu. No restaurant row, no staff logins, and above all
--      no restaurant_table rows -- local_seed.sql writes fixed, guessable qr_tokens, and a
--      predictable token lets a stranger order onto someone else's table (D4). Tables must
--      be created through the admin app so their tokens come from utils.GenerateQRToken().
--
--   2. It REFUSES to run against the wrong database. A seed whose WHERE clause matches no
--      restaurant inserts zero rows and reports success, which is the failure mode that
--      gets discovered by a diner scanning a QR code and finding an empty menu. The guard
--      below raises instead.
--
--   3. It is a SYNC, not an append. Run it twice and the second run is a no-op; change a
--      price here and re-run and the price moves. Anything this restaurant has on its menu
--      that is not in this file is archived, not deleted -- order_item.menu_item_id is
--      ON DELETE RESTRICT and last month's bills still point at it (D8).
--
-- What is deliberately preserved across a re-run, because this file is not the authority
-- on any of it:
--   * is_available -- the "we ran out" toggle staff flip during service (see models/menu.go)
--   * rating_count / rating_sum -- the review aggregate, maintained by delta inside the
--     review transaction (migration 016). Overwriting it would silently destroy history.
--   * image_url / image_key -- photos uploaded through the admin app (D15).
--
-- PORTIONS. The printed menu prices most dishes by Qtr / Half / Full, and menu_item carries
-- a single price_minor. Each printed portion therefore becomes its own orderable row --
-- "Chicken Biryani (Half)" and "Chicken Biryani (Full)" -- which is what the schema
-- supports today and what the cart, the kitchen ticket and the bill all read correctly.
-- 85 printed dishes expand to 142 rows.
--
-- TRANSCRIPTION NOTES -- read these before running:
--   * Items 46 and 47 (end of Curries) were not legible on the supplied photograph and are
--     NOT in this file. Add them here rather than through the admin app, or the next run
--     of this seed will archive them.
--   * Item 83 "Soft Drink" is priced "MRP" on the board. A price is required and inventing
--     one would mis-bill a real diner, so it is commented out at the foot of the item list
--     with the line ready to uncomment once a figure is decided.
--   * The red (S) marker is read as a house speciality and mapped to is_bestseller, which
--     is the badge the diner menu already renders. If (S) actually means something else on
--     this board -- spicy, seasonal -- change the flag column, not the marker.
--   * The board carries only name and price. description, spice_level and prep_time_mins
--     are NOT from the board -- the diner card renders all three (menu-screen.tsx:540-544)
--     and looks bare without them, so each dish carries its conventional preparation, a
--     house-default spice level and a kitchen estimate. Descriptions are safe; the other
--     two are guesses this kitchen should correct. Spice is left NULL where it is
--     meaningless -- breads, plain rice, dessert. Nothing here changes a price.
--
-- USAGE
--   Set the slug below to the restaurant this menu belongs to, then:
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/seeds/jawahar_menu.sql
--   Locally:
--     make seed SEED_FILE=backend/seeds/jawahar_menu.sql
--
-- The whole file is one transaction. A failure anywhere leaves the live menu untouched.

BEGIN;

-- ---------------------------------------------------------------------------
-- Target restaurant. THE ONE LINE TO EDIT.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE jw_target (slug TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO jw_target (slug) VALUES ('jawahar');

DO $guard$
DECLARE
    target TEXT := (SELECT slug FROM jw_target);
    found  INT;
BEGIN
    SELECT count(*) INTO found FROM restaurant WHERE slug = target;
    IF found = 0 THEN
        RAISE EXCEPTION
            'no restaurant with slug %. Set it at the top of this file; the menu was NOT changed.',
            target;
    END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- The menu, staged in temp tables so the item list is written once: it is used
-- to insert, and again to work out what is no longer on the menu.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE jw_category (
    uid TEXT, name TEXT, description TEXT, sort_order INT
) ON COMMIT DROP;

INSERT INTO jw_category (uid, name, description, sort_order) VALUES
    ('cat_jw_special'      , 'Special'             , 'The house kababs'    ,   10),
    ('cat_jw_tandoori'     , 'Tandoori & Roasted'  , 'From the tandoor'    ,   20),
    ('cat_jw_mughlai'      , 'Mughlai'             , NULL                  ,   30),
    ('cat_jw_curries'      , 'Curries'             , NULL                  ,   40),
    ('cat_jw_rice'         , 'Rice & Pulao'        , NULL                  ,   50),
    ('cat_jw_kabab_rolls'  , 'Kabab & Rolls'       , NULL                  ,   60),
    ('cat_jw_veg'          , 'Veg'                 , NULL                  ,   70),
    ('cat_jw_breads'       , 'Roti & Naan'         , 'From the tandoor'    ,   80),
    ('cat_jw_dessert'      , 'Dessert'             , NULL                  ,  100)
;

-- Prices are integer paise (D7): 34000 is Rs 340.00.
-- sort_order is the printed menu number x10, plus 1/2/3 for Qtr/Half/Full, so the app
-- lists the menu in exactly the order it is printed on the board.
CREATE TEMP TABLE jw_item (
    uid TEXT, category_uid TEXT, name TEXT, description TEXT,
    price_minor BIGINT, food_type TEXT, spice_level TEXT, is_bestseller BOOLEAN,
    prep_time_mins INT, sort_order INT
) ON COMMIT DROP;

INSERT INTO jw_item (uid, category_uid, name, description, price_minor, food_type,
                     spice_level, is_bestseller, prep_time_mins, sort_order) VALUES

    -- Special
    ('itm_jw_01_kalmi_kabab_h'                     , 'cat_jw_special'    , 'Kalmi Kabab (Half)'                              ,
     'Chicken drumsticks in a yoghurt and cheese marinade, finished in the tandoor',
      34000, 'non_veg', 'medium', FALSE,   22,   12),
    ('itm_jw_01_kalmi_kabab_f'                     , 'cat_jw_special'    , 'Kalmi Kabab (Full)'                              ,
     'Chicken drumsticks in a yoghurt and cheese marinade, finished in the tandoor',
      62000, 'non_veg', 'medium', FALSE,   22,   13),
    ('itm_jw_02_chicken_pahadi_tikka_h'            , 'cat_jw_special'    , 'Chicken Pahadi Tikka (Half)'                     ,
     'Green marinade of mint, coriander and green chilli',
      33000, 'non_veg', 'medium', FALSE,   22,   22),
    ('itm_jw_02_chicken_pahadi_tikka_f'            , 'cat_jw_special'    , 'Chicken Pahadi Tikka (Full)'                     ,
     'Green marinade of mint, coriander and green chilli',
      60000, 'non_veg', 'medium', FALSE,   22,   23),
    ('itm_jw_03_chicken_gilafi_kabab_4_pcs'        , 'cat_jw_special'    , 'Chicken Gilafi Kabab (4 pcs)'                    ,
     'Minced chicken seekh in a coat of onion and capsicum',
      38000, 'non_veg', 'medium', FALSE,   20,   33),
    ('itm_jw_04_mutton_gilafi_kabab_4_pcs'         , 'cat_jw_special'    , 'Mutton Gilafi Kabab (4 pcs)'                     ,
     'Minced mutton seekh in a coat of onion and capsicum',
      42000, 'non_veg', 'medium', FALSE,   22,   43),
    ('itm_jw_05_chicken_burra_h'                   , 'cat_jw_special'    , 'Chicken Burra (Half)'                            ,
     'Bone-in leg, deep marinade, charred in the tandoor',
      34000, 'non_veg', 'medium', FALSE,   25,   52),
    ('itm_jw_05_chicken_burra_f'                   , 'cat_jw_special'    , 'Chicken Burra (Full)'                            ,
     'Bone-in leg, deep marinade, charred in the tandoor',
      63000, 'non_veg', 'medium', FALSE,   25,   53),
    ('itm_jw_06_irani_kabab_4_pcs'                 , 'cat_jw_special'    , 'Irani Kabab (4 pcs)'                             ,
     'Minced kabab cooked over coals, Irani style',
      42000, 'non_veg', 'mild'  , FALSE,   20,   63),

    -- Tandoori & Roasted
    ('itm_jw_07_butter_chicken_dahiwala_q'         , 'cat_jw_tandoori'   , 'Butter Chicken Dahiwala (Quarter)'               ,
     'Yoghurt-based butter chicken -- lighter and tangier than the usual',
      17000, 'non_veg', 'mild'  , FALSE,   20,   71),
    ('itm_jw_07_butter_chicken_dahiwala_h'         , 'cat_jw_tandoori'   , 'Butter Chicken Dahiwala (Half)'                  ,
     'Yoghurt-based butter chicken -- lighter and tangier than the usual',
      31000, 'non_veg', 'mild'  , FALSE,   20,   72),
    ('itm_jw_07_butter_chicken_dahiwala_f'         , 'cat_jw_tandoori'   , 'Butter Chicken Dahiwala (Full)'                  ,
     'Yoghurt-based butter chicken -- lighter and tangier than the usual',
      58000, 'non_veg', 'mild'  , FALSE,   20,   73),
    ('itm_jw_08_chicken_fry_h'                     , 'cat_jw_tandoori'   , 'Chicken Fry (Half)'                              ,
     'Marinated and fried until crisp',
      28000, 'non_veg', 'medium', FALSE,   18,   82),
    ('itm_jw_08_chicken_fry_f'                     , 'cat_jw_tandoori'   , 'Chicken Fry (Full)'                              ,
     'Marinated and fried until crisp',
      52000, 'non_veg', 'medium', FALSE,   18,   83),
    ('itm_jw_09_chicken_lollipop_h'                , 'cat_jw_tandoori'   , 'Chicken Lollipop (Half)'                         ,
     'Frenched wings, batter-fried, served with a dip',
      28000, 'non_veg', 'medium', FALSE,   18,   92),
    ('itm_jw_09_chicken_lollipop_f'                , 'cat_jw_tandoori'   , 'Chicken Lollipop (Full)'                         ,
     'Frenched wings, batter-fried, served with a dip',
      52000, 'non_veg', 'medium', FALSE,   18,   93),
    ('itm_jw_10_tandoori_chicken_h'                , 'cat_jw_tandoori'   , 'Tandoori Chicken (Half)'                         ,
     'Overnight yoghurt marinade, roasted on the bone',
      28000, 'non_veg', 'medium', FALSE,   25,  102),
    ('itm_jw_10_tandoori_chicken_f'                , 'cat_jw_tandoori'   , 'Tandoori Chicken (Full)'                         ,
     'Overnight yoghurt marinade, roasted on the bone',
      53000, 'non_veg', 'medium', FALSE,   25,  103),
    ('itm_jw_11_chicken_tikka_h'                   , 'cat_jw_tandoori'   , 'Chicken Tikka (Half)'                            ,
     'Boneless thigh, char-grilled',
      31000, 'non_veg', 'medium', FALSE,   22,  112),
    ('itm_jw_11_chicken_tikka_f'                   , 'cat_jw_tandoori'   , 'Chicken Tikka (Full)'                            ,
     'Boneless thigh, char-grilled',
      58000, 'non_veg', 'medium', FALSE,   22,  113),
    ('itm_jw_12_chicken_malai_tikka_h'             , 'cat_jw_tandoori'   , 'Chicken Malai Tikka (Half)'                      ,
     'Cream, cheese and cardamom marinade. Rich and mild.',
      32000, 'non_veg', 'mild'  , FALSE,   22,  122),
    ('itm_jw_12_chicken_malai_tikka_f'             , 'cat_jw_tandoori'   , 'Chicken Malai Tikka (Full)'                      ,
     'Cream, cheese and cardamom marinade. Rich and mild.',
      60000, 'non_veg', 'mild'  , FALSE,   22,  123),
    ('itm_jw_13_chicken_afghani_h'                 , 'cat_jw_tandoori'   , 'Chicken Afghani (Half)'                          ,
     'White marinade of cream, cashew and pepper',
      33000, 'non_veg', 'mild'  , FALSE,   22,  132),
    ('itm_jw_13_chicken_afghani_f'                 , 'cat_jw_tandoori'   , 'Chicken Afghani (Full)'                          ,
     'White marinade of cream, cashew and pepper',
      61000, 'non_veg', 'mild'  , FALSE,   22,  133),
    ('itm_jw_14_mutton_burra_h'                    , 'cat_jw_tandoori'   , 'Mutton Burra (Half)'                             ,
     'Bone-in chops, slow-marinated and charred',
      40000, 'non_veg', 'medium', FALSE,   30,  142),
    ('itm_jw_14_mutton_burra_f'                    , 'cat_jw_tandoori'   , 'Mutton Burra (Full)'                             ,
     'Bone-in chops, slow-marinated and charred',
      75000, 'non_veg', 'medium', FALSE,   30,  143),
    ('itm_jw_15_mutton_burra_with_butter_gravy_h'  , 'cat_jw_tandoori'   , 'Mutton Burra with Butter Gravy (Half)'           ,
     'The charred chops, finished in a butter gravy',
      42000, 'non_veg', 'medium', FALSE,   32,  152),
    ('itm_jw_15_mutton_burra_with_butter_gravy_f'  , 'cat_jw_tandoori'   , 'Mutton Burra with Butter Gravy (Full)'           ,
     'The charred chops, finished in a butter gravy',
      77000, 'non_veg', 'medium', FALSE,   32,  153),
    ('itm_jw_16_tandoori_raan'                     , 'cat_jw_tandoori'   , 'Tandoori Raan'                                   ,
     'Whole marinated leg of mutton, slow-roasted. Served 20 minutes from ordering.',
     145000, 'non_veg', 'medium', TRUE ,   20,  163),
    ('itm_jw_17_tandoori_fish_1_pc'                , 'cat_jw_tandoori'   , 'Tandoori Fish (1 pc)'                            ,
     'Pomfret, ajwain marinade. Winter dish, served 20 minutes from ordering.',
      43000, 'non_veg', 'medium', TRUE ,   20,  173),
    ('itm_jw_18_fish_tikka_h'                      , 'cat_jw_tandoori'   , 'Fish Tikka (Half)'                               ,
     'Surmai steaks, carom and lemon marinade. Winter dish.',
      44000, 'non_veg', 'medium', TRUE ,   22,  182),
    ('itm_jw_18_fish_tikka_f'                      , 'cat_jw_tandoori'   , 'Fish Tikka (Full)'                               ,
     'Surmai steaks, carom and lemon marinade. Winter dish.',
      80000, 'non_veg', 'medium', TRUE ,   22,  183),
    ('itm_jw_19_fish_fry_h'                        , 'cat_jw_tandoori'   , 'Fish Fry (Half)'                                 ,
     'Surmai, batter-fried. Winter dish.',
      44000, 'non_veg', 'medium', FALSE,   20,  192),
    ('itm_jw_19_fish_fry_f'                        , 'cat_jw_tandoori'   , 'Fish Fry (Full)'                                 ,
     'Surmai, batter-fried. Winter dish.',
      80000, 'non_veg', 'medium', FALSE,   20,  193),

    -- Mughlai
    ('itm_jw_20_mutton_qorma_h'                    , 'cat_jw_mughlai'    , 'Mutton Qorma (Half)'                             ,
     'Slow-cooked in yoghurt, fried onion and whole spices',
      26000, 'non_veg', 'medium', FALSE,   25,  202),
    ('itm_jw_20_mutton_qorma_f'                    , 'cat_jw_mughlai'    , 'Mutton Qorma (Full)'                             ,
     'Slow-cooked in yoghurt, fried onion and whole spices',
      49000, 'non_veg', 'medium', FALSE,   25,  203),
    ('itm_jw_21_mutton_stew_h'                     , 'cat_jw_mughlai'    , 'Mutton Stew (Half)'                              ,
     'Clear, gently spiced broth with soft mutton',
      26000, 'non_veg', 'mild'  , FALSE,   25,  212),
    ('itm_jw_21_mutton_stew_f'                     , 'cat_jw_mughlai'    , 'Mutton Stew (Full)'                              ,
     'Clear, gently spiced broth with soft mutton',
      49000, 'non_veg', 'mild'  , FALSE,   25,  213),
    ('itm_jw_22_mutton_kadhai_gosht_h'             , 'cat_jw_mughlai'    , 'Mutton Kadhai Gosht (Half)'                      ,
     'Tossed with capsicum, tomato and freshly ground kadhai masala',
      27000, 'non_veg', 'medium', FALSE,   25,  222),
    ('itm_jw_22_mutton_kadhai_gosht_f'             , 'cat_jw_mughlai'    , 'Mutton Kadhai Gosht (Full)'                      ,
     'Tossed with capsicum, tomato and freshly ground kadhai masala',
      50000, 'non_veg', 'medium', FALSE,   25,  223),
    ('itm_jw_23_aloo_gosht_h'                      , 'cat_jw_mughlai'    , 'Aloo Gosht (Half)'                               ,
     'Mutton and potato in an onion-tomato gravy',
      26000, 'non_veg', 'medium', FALSE,   25,  232),
    ('itm_jw_23_aloo_gosht_f'                      , 'cat_jw_mughlai'    , 'Aloo Gosht (Full)'                               ,
     'Mutton and potato in an onion-tomato gravy',
      49000, 'non_veg', 'medium', FALSE,   25,  233),
    ('itm_jw_24_nahari_h'                          , 'cat_jw_mughlai'    , 'Nahari (Half)'                                   ,
     'Shank braised overnight in a deeply spiced gravy',
      26000, 'non_veg', 'hot'   , FALSE,   20,  242),
    ('itm_jw_24_nahari_f'                          , 'cat_jw_mughlai'    , 'Nahari (Full)'                                   ,
     'Shank braised overnight in a deeply spiced gravy',
      49000, 'non_veg', 'hot'   , FALSE,   20,  243),
    ('itm_jw_25_paya_h'                            , 'cat_jw_mughlai'    , 'Paya (Half)'                                     ,
     'Trotters, slow-cooked until the gravy runs thick',
      26000, 'non_veg', 'medium', FALSE,   20,  252),
    ('itm_jw_25_paya_f'                            , 'cat_jw_mughlai'    , 'Paya (Full)'                                     ,
     'Trotters, slow-cooked until the gravy runs thick',
      49000, 'non_veg', 'medium', FALSE,   20,  253),
    ('itm_jw_26_brain_curry_h'                     , 'cat_jw_mughlai'    , 'Brain Curry (Half)'                              ,
     'Mutton brain, fried with onion and green chilli',
      28000, 'non_veg', 'hot'   , FALSE,   20,  262),
    ('itm_jw_26_brain_curry_f'                     , 'cat_jw_mughlai'    , 'Brain Curry (Full)'                              ,
     'Mutton brain, fried with onion and green chilli',
      53000, 'non_veg', 'hot'   , FALSE,   20,  263),
    ('itm_jw_27_qeema_h'                           , 'cat_jw_mughlai'    , 'Qeema (Half)'                                    ,
     'Minced mutton, slow-fried with onion and spices',
      26000, 'non_veg', 'medium', FALSE,   22,  272),
    ('itm_jw_27_qeema_f'                           , 'cat_jw_mughlai'    , 'Qeema (Full)'                                    ,
     'Minced mutton, slow-fried with onion and spices',
      49000, 'non_veg', 'medium', FALSE,   22,  273),
    ('itm_jw_28_chicken_jahangiri_q'               , 'cat_jw_mughlai'    , 'Chicken Jahangiri (Quarter)'                     ,
     'Cashew and cream gravy, mildly sweet. A house speciality.',
      26000, 'non_veg', 'mild'  , TRUE ,   22,  281),
    ('itm_jw_28_chicken_jahangiri_h'               , 'cat_jw_mughlai'    , 'Chicken Jahangiri (Half)'                        ,
     'Cashew and cream gravy, mildly sweet. A house speciality.',
      47000, 'non_veg', 'mild'  , TRUE ,   22,  282),
    ('itm_jw_28_chicken_jahangiri_f'               , 'cat_jw_mughlai'    , 'Chicken Jahangiri (Full)'                        ,
     'Cashew and cream gravy, mildly sweet. A house speciality.',
      89000, 'non_veg', 'mild'  , TRUE ,   22,  283),
    ('itm_jw_29_chicken_mughlai_q'                 , 'cat_jw_mughlai'    , 'Chicken Mughlai (Quarter)'                       ,
     'Rich almond and yoghurt gravy',
      26000, 'non_veg', 'mild'  , FALSE,   22,  291),
    ('itm_jw_29_chicken_mughlai_h'                 , 'cat_jw_mughlai'    , 'Chicken Mughlai (Half)'                          ,
     'Rich almond and yoghurt gravy',
      47000, 'non_veg', 'mild'  , FALSE,   22,  292),
    ('itm_jw_29_chicken_mughlai_f'                 , 'cat_jw_mughlai'    , 'Chicken Mughlai (Full)'                          ,
     'Rich almond and yoghurt gravy',
      89000, 'non_veg', 'mild'  , FALSE,   22,  293),
    ('itm_jw_30_chicken_stew_q'                    , 'cat_jw_mughlai'    , 'Chicken Stew (Quarter)'                          ,
     'Lightly spiced, clear gravy',
      25000, 'non_veg', 'mild'  , FALSE,   22,  301),
    ('itm_jw_30_chicken_stew_h'                    , 'cat_jw_mughlai'    , 'Chicken Stew (Half)'                             ,
     'Lightly spiced, clear gravy',
      46000, 'non_veg', 'mild'  , FALSE,   22,  302),
    ('itm_jw_30_chicken_stew_f'                    , 'cat_jw_mughlai'    , 'Chicken Stew (Full)'                             ,
     'Lightly spiced, clear gravy',
      85000, 'non_veg', 'mild'  , FALSE,   22,  303),
    ('itm_jw_31_murgh_musallam'                    , 'cat_jw_mughlai'    , 'Murgh Musallam'                                  ,
     'Whole chicken stuffed with qeema and egg. Order at least 2 hours in advance.',
     110000, 'non_veg', 'medium', FALSE,  120,  313),
    ('itm_jw_32_handi_gosht_h'                     , 'cat_jw_mughlai'    , 'Handi Gosht (Half)'                              ,
     'Mutton slow-cooked in a sealed handi. A house speciality.',
      31000, 'non_veg', 'medium', TRUE ,   28,  322),
    ('itm_jw_32_handi_gosht_f'                     , 'cat_jw_mughlai'    , 'Handi Gosht (Full)'                              ,
     'Mutton slow-cooked in a sealed handi. A house speciality.',
      60000, 'non_veg', 'medium', TRUE ,   28,  323),
    ('itm_jw_33_mutton_jahangiri_h'                , 'cat_jw_mughlai'    , 'Mutton Jahangiri (Half)'                         ,
     'Cashew and cream gravy with mutton. A house speciality.',
      29000, 'non_veg', 'mild'  , TRUE ,   28,  332),
    ('itm_jw_33_mutton_jahangiri_f'                , 'cat_jw_mughlai'    , 'Mutton Jahangiri (Full)'                         ,
     'Cashew and cream gravy with mutton. A house speciality.',
      54000, 'non_veg', 'mild'  , TRUE ,   28,  333),
    ('itm_jw_34_tamatar_gosht_h'                   , 'cat_jw_mughlai'    , 'Tamatar Gosht (Half)'                            ,
     'Mutton in a tomato-forward gravy',
      27000, 'non_veg', 'medium', FALSE,   25,  342),
    ('itm_jw_34_tamatar_gosht_f'                   , 'cat_jw_mughlai'    , 'Tamatar Gosht (Full)'                            ,
     'Mutton in a tomato-forward gravy',
      52000, 'non_veg', 'medium', FALSE,   25,  343),

    -- Curries
    ('itm_jw_35_kali_mirch_chicken_q'              , 'cat_jw_curries'    , 'Kali Mirch Chicken (Quarter)'                    ,
     'Crushed black pepper, yoghurt and cream',
      26000, 'non_veg', 'medium', FALSE,   20,  351),
    ('itm_jw_35_kali_mirch_chicken_h'              , 'cat_jw_curries'    , 'Kali Mirch Chicken (Half)'                       ,
     'Crushed black pepper, yoghurt and cream',
      48000, 'non_veg', 'medium', FALSE,   20,  352),
    ('itm_jw_35_kali_mirch_chicken_f'              , 'cat_jw_curries'    , 'Kali Mirch Chicken (Full)'                       ,
     'Crushed black pepper, yoghurt and cream',
      84000, 'non_veg', 'medium', FALSE,   20,  353),
    ('itm_jw_36_chicken_angara_q'                  , 'cat_jw_curries'    , 'Chicken Angara (Quarter)'                        ,
     'Smoked over charcoal, deep red and fiery',
      25500, 'non_veg', 'hot'   , FALSE,   20,  361),
    ('itm_jw_36_chicken_angara_h'                  , 'cat_jw_curries'    , 'Chicken Angara (Half)'                           ,
     'Smoked over charcoal, deep red and fiery',
      47000, 'non_veg', 'hot'   , FALSE,   20,  362),
    ('itm_jw_36_chicken_angara_f'                  , 'cat_jw_curries'    , 'Chicken Angara (Full)'                           ,
     'Smoked over charcoal, deep red and fiery',
      84000, 'non_veg', 'hot'   , FALSE,   20,  363),
    ('itm_jw_37_chicken_do_pyaza_q'                , 'cat_jw_curries'    , 'Chicken Do Pyaza (Quarter)'                      ,
     'Onion twice over -- once in the base, once seared through',
      25000, 'non_veg', 'medium', FALSE,   20,  371),
    ('itm_jw_37_chicken_do_pyaza_h'                , 'cat_jw_curries'    , 'Chicken Do Pyaza (Half)'                         ,
     'Onion twice over -- once in the base, once seared through',
      47000, 'non_veg', 'medium', FALSE,   20,  372),
    ('itm_jw_37_chicken_do_pyaza_f'                , 'cat_jw_curries'    , 'Chicken Do Pyaza (Full)'                         ,
     'Onion twice over -- once in the base, once seared through',
      84000, 'non_veg', 'medium', FALSE,   20,  373),
    ('itm_jw_38_handi_chicken_q'                   , 'cat_jw_curries'    , 'Handi Chicken (Quarter)'                         ,
     'Slow-cooked in a sealed handi. A house speciality.',
      30000, 'non_veg', 'medium', TRUE ,   25,  381),
    ('itm_jw_38_handi_chicken_h'                   , 'cat_jw_curries'    , 'Handi Chicken (Half)'                            ,
     'Slow-cooked in a sealed handi. A house speciality.',
      55000, 'non_veg', 'medium', TRUE ,   25,  382),
    ('itm_jw_38_handi_chicken_f'                   , 'cat_jw_curries'    , 'Handi Chicken (Full)'                            ,
     'Slow-cooked in a sealed handi. A house speciality.',
     100000, 'non_veg', 'medium', TRUE ,   25,  383),
    ('itm_jw_39_butter_chicken_q'                  , 'cat_jw_curries'    , 'Butter Chicken (Quarter)'                        ,
     'Tomato, butter and kasuri methi. The classic.',
      26000, 'non_veg', 'mild'  , FALSE,   20,  391),
    ('itm_jw_39_butter_chicken_h'                  , 'cat_jw_curries'    , 'Butter Chicken (Half)'                           ,
     'Tomato, butter and kasuri methi. The classic.',
      48000, 'non_veg', 'mild'  , FALSE,   20,  392),
    ('itm_jw_39_butter_chicken_f'                  , 'cat_jw_curries'    , 'Butter Chicken (Full)'                           ,
     'Tomato, butter and kasuri methi. The classic.',
      84000, 'non_veg', 'mild'  , FALSE,   20,  393),
    ('itm_jw_40_butter_chicken_boneless_q'         , 'cat_jw_curries'    , 'Butter Chicken Boneless (Quarter)'               ,
     'The same gravy, boneless thigh',
      28000, 'non_veg', 'mild'  , FALSE,   20,  401),
    ('itm_jw_40_butter_chicken_boneless_h'         , 'cat_jw_curries'    , 'Butter Chicken Boneless (Half)'                  ,
     'The same gravy, boneless thigh',
      51000, 'non_veg', 'mild'  , FALSE,   20,  402),
    ('itm_jw_40_butter_chicken_boneless_f'         , 'cat_jw_curries'    , 'Butter Chicken Boneless (Full)'                  ,
     'The same gravy, boneless thigh',
      88000, 'non_veg', 'mild'  , FALSE,   20,  403),
    ('itm_jw_41_chicken_changezi_q'                , 'cat_jw_curries'    , 'Chicken Changezi (Quarter)'                      ,
     'Cream and cashew, with a heavy hand on the spices',
      26000, 'non_veg', 'medium', FALSE,   22,  411),
    ('itm_jw_41_chicken_changezi_h'                , 'cat_jw_curries'    , 'Chicken Changezi (Half)'                         ,
     'Cream and cashew, with a heavy hand on the spices',
      48000, 'non_veg', 'medium', FALSE,   22,  412),
    ('itm_jw_41_chicken_changezi_f'                , 'cat_jw_curries'    , 'Chicken Changezi (Full)'                         ,
     'Cream and cashew, with a heavy hand on the spices',
      84000, 'non_veg', 'medium', FALSE,   22,  413),
    ('itm_jw_42_kadhai_chicken_q'                  , 'cat_jw_curries'    , 'Kadhai Chicken (Quarter)'                        ,
     'Capsicum, tomato and coarsely ground coriander',
      26000, 'non_veg', 'medium', FALSE,   20,  421),
    ('itm_jw_42_kadhai_chicken_h'                  , 'cat_jw_curries'    , 'Kadhai Chicken (Half)'                           ,
     'Capsicum, tomato and coarsely ground coriander',
      48000, 'non_veg', 'medium', FALSE,   20,  422),
    ('itm_jw_42_kadhai_chicken_f'                  , 'cat_jw_curries'    , 'Kadhai Chicken (Full)'                           ,
     'Capsicum, tomato and coarsely ground coriander',
      84000, 'non_veg', 'medium', FALSE,   20,  423),
    ('itm_jw_43_chicken_masala_q'                  , 'cat_jw_curries'    , 'Chicken Masala (Quarter)'                        ,
     'The everyday onion-tomato masala',
      26000, 'non_veg', 'medium', FALSE,   20,  431),
    ('itm_jw_43_chicken_masala_h'                  , 'cat_jw_curries'    , 'Chicken Masala (Half)'                           ,
     'The everyday onion-tomato masala',
      48000, 'non_veg', 'medium', FALSE,   20,  432),
    ('itm_jw_43_chicken_masala_f'                  , 'cat_jw_curries'    , 'Chicken Masala (Full)'                           ,
     'The everyday onion-tomato masala',
      84000, 'non_veg', 'medium', FALSE,   20,  433),
    ('itm_jw_44_chicken_jawahar_special_q'         , 'cat_jw_curries'    , 'Chicken Jawahar Special (Quarter)'               ,
     'The kitchen''s own gravy, cooked to the house recipe. A speciality.',
      30000, 'non_veg', 'medium', TRUE ,   25,  441),
    ('itm_jw_44_chicken_jawahar_special_h'         , 'cat_jw_curries'    , 'Chicken Jawahar Special (Half)'                  ,
     'The kitchen''s own gravy, cooked to the house recipe. A speciality.',
      55000, 'non_veg', 'medium', TRUE ,   25,  442),
    ('itm_jw_44_chicken_jawahar_special_f'         , 'cat_jw_curries'    , 'Chicken Jawahar Special (Full)'                  ,
     'The kitchen''s own gravy, cooked to the house recipe. A speciality.',
     100000, 'non_veg', 'medium', TRUE ,   25,  443),
    ('itm_jw_45_chicken_lababdar_boneless_q'       , 'cat_jw_curries'    , 'Chicken Lababdar (Boneless) (Quarter)'           ,
     'Tomato and cashew, finished with butter and cream. A house speciality.',
      28000, 'non_veg', 'mild'  , TRUE ,   22,  451),
    ('itm_jw_45_chicken_lababdar_boneless_h'       , 'cat_jw_curries'    , 'Chicken Lababdar (Boneless) (Half)'              ,
     'Tomato and cashew, finished with butter and cream. A house speciality.',
      51000, 'non_veg', 'mild'  , TRUE ,   22,  452),
    ('itm_jw_45_chicken_lababdar_boneless_f'       , 'cat_jw_curries'    , 'Chicken Lababdar (Boneless) (Full)'              ,
     'Tomato and cashew, finished with butter and cream. A house speciality.',
      88000, 'non_veg', 'mild'  , TRUE ,   22,  453),

    -- Rice & Pulao
    ('itm_jw_48_mutton_biryani_h'                  , 'cat_jw_rice'       , 'Mutton Biryani (Half)'                           ,
     'Dum-cooked with bone-in mutton and long-grain basmati',
      28000, 'non_veg', 'medium', FALSE,   30,  482),
    ('itm_jw_48_mutton_biryani_f'                  , 'cat_jw_rice'       , 'Mutton Biryani (Full)'                           ,
     'Dum-cooked with bone-in mutton and long-grain basmati',
      52000, 'non_veg', 'medium', FALSE,   30,  483),
    ('itm_jw_49_chicken_biryani_h'                 , 'cat_jw_rice'       , 'Chicken Biryani (Half)'                          ,
     'Dum-cooked, saffron and fried onion',
      26000, 'non_veg', 'medium', FALSE,   28,  492),
    ('itm_jw_49_chicken_biryani_f'                 , 'cat_jw_rice'       , 'Chicken Biryani (Full)'                          ,
     'Dum-cooked, saffron and fried onion',
      49000, 'non_veg', 'medium', FALSE,   28,  493),
    ('itm_jw_50_veg_pulao_h'                       , 'cat_jw_rice'       , 'Veg Pulao (Half)'                                ,
     'Basmati with seasonal vegetables and whole spices',
      20000, 'veg'    , 'mild'  , FALSE,   22,  502),
    ('itm_jw_50_veg_pulao_f'                       , 'cat_jw_rice'       , 'Veg Pulao (Full)'                                ,
     'Basmati with seasonal vegetables and whole spices',
      34000, 'veg'    , 'mild'  , FALSE,   22,  503),
    ('itm_jw_51_plain_rice_h'                      , 'cat_jw_rice'       , 'Plain Rice (Half)'                               ,
     'Steamed basmati',
      12000, 'veg'    , NULL    , FALSE,   15,  512),
    ('itm_jw_51_plain_rice_f'                      , 'cat_jw_rice'       , 'Plain Rice (Full)'                               ,
     'Steamed basmati',
      20000, 'veg'    , NULL    , FALSE,   15,  513),
    ('itm_jw_52_zeera_rice_h'                      , 'cat_jw_rice'       , 'Zeera Rice (Half)'                               ,
     'Basmati tempered with cumin',
      13000, 'veg'    , NULL    , FALSE,   15,  522),
    ('itm_jw_52_zeera_rice_f'                      , 'cat_jw_rice'       , 'Zeera Rice (Full)'                               ,
     'Basmati tempered with cumin',
      22000, 'veg'    , NULL    , FALSE,   15,  523),

    -- Kabab & Rolls
    ('itm_jw_53_mutton_seekh_kabab_1_pc'           , 'cat_jw_kabab_rolls', 'Mutton Seekh Kabab (1 pc)'                       ,
     'Minced mutton on the skewer, char-grilled',
       9000, 'non_veg', 'medium', FALSE,   18,  533),
    ('itm_jw_54_mutton_seekh_kabab_with_butter_gra', 'cat_jw_kabab_rolls', 'Mutton Seekh Kabab with Butter Gravy (4 pcs)'    ,
     'Four skewers, finished in a butter gravy',
      40000, 'non_veg', 'medium', FALSE,   22,  543),
    ('itm_jw_55_chicken_seekh_kabab_1_pc'          , 'cat_jw_kabab_rolls', 'Chicken Seekh Kabab (1 pc)'                      ,
     'Minced chicken on the skewer, char-grilled',
       8000, 'non_veg', 'medium', FALSE,   18,  553),
    ('itm_jw_56_chicken_seekh_kabab_with_butter_gr', 'cat_jw_kabab_rolls', 'Chicken Seekh Kabab with Butter Gravy (4 pcs)'   ,
     'Four skewers, finished in a butter gravy',
      36000, 'non_veg', 'medium', FALSE,   22,  563),
    ('itm_jw_57_shami_kabab_1_pc'                  , 'cat_jw_kabab_rolls', 'Shami Kabab (1 pc)'                              ,
     'Minced mutton and chana dal, pan-fried soft',
      10000, 'non_veg', 'medium', FALSE,   15,  573),
    ('itm_jw_58_mutton_seekh_roll_1_pc'            , 'cat_jw_kabab_rolls', 'Mutton Seekh Roll (1 pc)'                        ,
     'Seekh kabab rolled into a paratha with onion and chutney',
      20000, 'non_veg', 'medium', FALSE,   18,  583),
    ('itm_jw_59_chicken_seekh_roll_1_pc'           , 'cat_jw_kabab_rolls', 'Chicken Seekh Roll (1 pc)'                       ,
     'Chicken seekh rolled into a paratha with onion and chutney',
      18000, 'non_veg', 'medium', FALSE,   18,  593),
    ('itm_jw_60_chicken_boti_roll_1_pc'            , 'cat_jw_kabab_rolls', 'Chicken Boti Roll (1 pc)'                        ,
     'Boneless tikka pieces rolled into a paratha',
      18000, 'non_veg', 'medium', FALSE,   18,  603),

    -- Veg
    ('itm_jw_61_plain_daal'                        , 'cat_jw_veg'        , 'Plain Daal'                                      ,
     'Everyday yellow dal, tempered with cumin',
      10000, 'veg'    , 'mild'  , FALSE,   15,  613),
    ('itm_jw_62_daal_makhani'                      , 'cat_jw_veg'        , 'Daal Makhani'                                    ,
     'Black lentils, slow-cooked overnight with butter',
      18000, 'veg'    , 'mild'  , FALSE,   18,  623),
    ('itm_jw_63_shahi_paneer'                      , 'cat_jw_veg'        , 'Shahi Paneer'                                    ,
     'Cashew and cream gravy, mildly sweet',
      20000, 'veg'    , 'mild'  , FALSE,   18,  633),
    ('itm_jw_64_paneer_tikka_h'                    , 'cat_jw_veg'        , 'Paneer Tikka (Half)'                             ,
     'Cottage cheese marinated in yoghurt and spices, char-grilled',
      16000, 'veg'    , 'medium', FALSE,   20,  642),
    ('itm_jw_64_paneer_tikka_f'                    , 'cat_jw_veg'        , 'Paneer Tikka (Full)'                             ,
     'Cottage cheese marinated in yoghurt and spices, char-grilled',
      34000, 'veg'    , 'medium', FALSE,   20,  643),
    ('itm_jw_65_paneer_do_pyaza'                   , 'cat_jw_veg'        , 'Paneer Do Pyaza'                                 ,
     'Paneer with onion two ways',
      25000, 'veg'    , 'medium', FALSE,   18,  653),
    ('itm_jw_66_kadhai_paneer'                     , 'cat_jw_veg'        , 'Kadhai Paneer'                                   ,
     'Capsicum, tomato and freshly ground kadhai masala',
      21000, 'veg'    , 'medium', FALSE,   18,  663),
    ('itm_jw_67_mattar_paneer'                     , 'cat_jw_veg'        , 'Mattar Paneer'                                   ,
     'Paneer and green peas in an onion-tomato gravy',
      18000, 'veg'    , 'mild'  , FALSE,   18,  673),
    ('itm_jw_68_paneer_lababdar'                   , 'cat_jw_veg'        , 'Paneer Lababdar'                                 ,
     'Tomato and cashew, finished with butter. A house speciality.',
      22000, 'veg'    , 'mild'  , TRUE ,   18,  683),
    ('itm_jw_69_nizami_handi'                      , 'cat_jw_veg'        , 'Nizami Handi'                                    ,
     'Mixed vegetables in a rich Hyderabadi gravy. A house speciality.',
      24000, 'veg'    , 'medium', TRUE ,   22,  693),
    ('itm_jw_70_tandoori_vegetables'               , 'cat_jw_veg'        , 'Tandoori Vegetables'                             ,
     'Paneer, capsicum, onion and pineapple from the tandoor',
      20000, 'veg'    , 'medium', FALSE,   20,  703),

    -- Roti & Naan
    ('itm_jw_71_tandoori_roti'                     , 'cat_jw_breads'     , 'Tandoori Roti'                                   ,
     'Whole wheat, from the tandoor',
       1500, 'veg'    , NULL    , FALSE,    8,  710),
    ('itm_jw_72_khamiri_roti'                      , 'cat_jw_breads'     , 'Khamiri Roti'                                    ,
     'Leavened and soft, the old Delhi way',
       2000, 'veg'    , NULL    , FALSE,   10,  720),
    ('itm_jw_73_butter_khamiri_roti'               , 'cat_jw_breads'     , 'Butter Khamiri Roti'                             ,
     'Leavened roti, brushed with butter',
       2500, 'veg'    , NULL    , FALSE,   10,  730),
    ('itm_jw_74_rumali_roti'                       , 'cat_jw_breads'     , 'Rumali Roti'                                     ,
     'Paper-thin, folded like a handkerchief',
       1000, 'veg'    , NULL    , FALSE,    8,  740),
    ('itm_jw_75_butter_tandoori_roti'              , 'cat_jw_breads'     , 'Butter Tandoori Roti'                            ,
     'Whole wheat, brushed with butter',
       2000, 'veg'    , NULL    , FALSE,    8,  750),
    ('itm_jw_76_sheer_maal'                        , 'cat_jw_breads'     , 'Sheer Maal'                                      ,
     'Saffron and milk bread, faintly sweet',
      10000, 'veg'    , NULL    , FALSE,   12,  760),
    ('itm_jw_77_plain_naan'                        , 'cat_jw_breads'     , 'Plain Naan'                                      ,
     'Refined flour, from the tandoor',
       8000, 'veg'    , NULL    , FALSE,    8,  770),
    ('itm_jw_78_qeema_naan'                        , 'cat_jw_breads'     , 'Qeema Naan'                                      ,
     'Stuffed with spiced minced mutton',
      16000, 'non_veg', 'medium', FALSE,   12,  780),
    ('itm_jw_79_butter_naan'                       , 'cat_jw_breads'     , 'Butter Naan'                                     ,
     'Brushed with butter',
      10000, 'veg'    , NULL    , FALSE,    8,  790),
    ('itm_jw_80_paneer_prantha'                    , 'cat_jw_breads'     , 'Paneer Prantha'                                  ,
     'Stuffed with spiced cottage cheese',
       8000, 'veg'    , 'mild'  , FALSE,   12,  800),
    ('itm_jw_81_lachcha_parantha'                  , 'cat_jw_breads'     , 'Lachcha Parantha'                                ,
     'Layered and flaky',
       6000, 'veg'    , NULL    , FALSE,   10,  810),
    ('itm_jw_82_garlic_naan'                       , 'cat_jw_breads'     , 'Garlic Naan'                                     ,
     'Fresh garlic and coriander',
      10000, 'veg'    , NULL    , FALSE,    8,  820),

    -- Dessert
    ('itm_jw_84_kheer'                             , 'cat_jw_dessert'    , 'Kheer'                                           ,
     'Slow-cooked rice pudding with cardamom',
       5000, 'veg'    , NULL    , FALSE,    5,  840),
    ('itm_jw_85_gulab_jamun'                       , 'cat_jw_dessert'    , 'Gulab Jamun'                                     ,
     'Warm, in sugar syrup',
       6000, 'veg'    , NULL    , FALSE,    5,  850)
;

-- Item 83, "Soft Drink", is priced MRP on the board. price_minor is NOT NULL and a guessed
-- figure would mis-bill a real diner, so it is left out. Decide a price, add a Drinks row to
-- jw_category above (sort_order 90 is free), and uncomment:
--
-- INSERT INTO jw_item VALUES
--     ('itm_jw_83_soft_drink', 'cat_jw_drinks', 'Soft Drink', NULL, 0 /* paise */, 'veg', FALSE, NULL, 830);

-- ---------------------------------------------------------------------------
-- 1. Retire what is no longer on the board.
--
-- Runs BEFORE the insert, and archives rather than deletes. Two reasons it cannot be a
-- DELETE: order_item.menu_item_id is ON DELETE RESTRICT so the delete would simply fail on
-- any dish ever sold, and if it succeeded it would take the sales history with it.
--
-- Categories first, because an item cannot be archived out of a category that still has to
-- exist to hold it.
-- ---------------------------------------------------------------------------
UPDATE menu_category c
SET status = 'archived', updated_at = NOW()
FROM restaurant r, jw_target t
WHERE c.restaurant_id = r.id AND r.slug = t.slug
  AND c.uid NOT IN (SELECT uid FROM jw_category)
  AND c.status <> 'archived';

/*
    Freeing the NAME, not just the uid.

    menu_category carries UNIQUE (restaurant_id, name) and menu_item carries
    UNIQUE (restaurant_id, category_id, name). A retired row keeps its name, so if this
    restaurant already has a "Butter Chicken" under some other uid -- a demo menu, an entry
    typed by hand in the admin app -- the insert below fails on the constraint and the whole
    transaction rolls back.

    Only rows whose name actually collides are touched, so an unrelated retired dish keeps
    the name it was sold under. The NOT LIKE guard makes a second run a no-op rather than
    appending the suffix twice.
*/
UPDATE menu_category c
SET name = left(c.name, 53) || ' [retired]', updated_at = NOW()
FROM restaurant r, jw_target t
WHERE c.restaurant_id = r.id AND r.slug = t.slug
  AND c.uid NOT IN (SELECT uid FROM jw_category)
  AND c.name NOT LIKE '% [retired]'
  AND c.name IN (SELECT name FROM jw_category);

-- ---------------------------------------------------------------------------
-- 2. Categories.
--
-- The WHERE on DO UPDATE is a tenant guard: uid is globally unique, so without it a uid
-- collision with another restaurant would quietly hand this restaurant's menu row to
-- someone else's. Not matching means the row is skipped, which is the safe direction.
-- ---------------------------------------------------------------------------
INSERT INTO menu_category (uid, restaurant_id, name, description, sort_order, status,
                           created_at, updated_at)
SELECT v.uid, r.id, v.name, v.description, v.sort_order, 'active', NOW(), NOW()
FROM restaurant r
JOIN jw_target t ON t.slug = r.slug
CROSS JOIN jw_category v
ON CONFLICT (uid) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    sort_order  = EXCLUDED.sort_order,
    status      = 'active',
    updated_at  = NOW()
WHERE menu_category.restaurant_id = EXCLUDED.restaurant_id;

-- ---------------------------------------------------------------------------
-- 3. Retire the dishes that are no longer on the board, and free their names.
--
-- After the categories exist, so the collision test can compare a live row against the
-- category the new dish is actually going into.
-- ---------------------------------------------------------------------------
UPDATE menu_item m
SET status = 'archived', is_available = FALSE, updated_at = NOW()
FROM restaurant r, jw_target t
WHERE m.restaurant_id = r.id AND r.slug = t.slug
  AND m.uid NOT IN (SELECT uid FROM jw_item)
  AND m.status <> 'archived';

UPDATE menu_item m
SET name = left(m.name, 117) || ' [retired]', updated_at = NOW()
FROM restaurant r, jw_target t
WHERE m.restaurant_id = r.id AND r.slug = t.slug
  AND m.uid NOT IN (SELECT uid FROM jw_item)
  AND m.name NOT LIKE '% [retired]'
  AND EXISTS (
      SELECT 1
      FROM jw_item i
      JOIN menu_category c ON c.uid = i.category_uid AND c.restaurant_id = m.restaurant_id
      WHERE i.name = m.name AND c.id = m.category_id
  );

-- ---------------------------------------------------------------------------
-- 4. The dishes.
--
-- Note what the DO UPDATE list does NOT contain. is_available, rating_count, rating_sum,
-- image_url and image_key are absent on purpose: this file is the authority on what is on
-- the menu and how it is described, and on nothing else. Re-running it must not un-sell-out
-- a dish the kitchen just ran out of, wipe its reviews, or drop a photo somebody uploaded.
--
-- spice_level IS in the list, which is a trade-off worth stating: it means a re-run
-- overwrites a spice level corrected in the admin app. Correct it here instead, or move the
-- line out of the DO UPDATE once the kitchen has been through the menu.
--
-- status IS forced back to 'active', because a dish printed on this board is on the menu by
-- definition. Take a dish off the board and out of this file to retire it.
-- ---------------------------------------------------------------------------
INSERT INTO menu_item (uid, restaurant_id, category_id, name, description, price_minor,
                       food_type, spice_level, is_available, is_bestseller, prep_time_mins,
                       sort_order, status, created_at, updated_at)
SELECT v.uid, r.id, c.id, v.name, v.description, v.price_minor,
       v.food_type, v.spice_level, TRUE, v.is_bestseller, v.prep_time_mins,
       v.sort_order, 'active', NOW(), NOW()
FROM restaurant r
JOIN jw_target t ON t.slug = r.slug
CROSS JOIN jw_item v
JOIN menu_category c ON c.restaurant_id = r.id AND c.uid = v.category_uid
ON CONFLICT (uid) DO UPDATE SET
    category_id    = EXCLUDED.category_id,
    name           = EXCLUDED.name,
    description    = EXCLUDED.description,
    price_minor    = EXCLUDED.price_minor,
    food_type      = EXCLUDED.food_type,
    spice_level    = EXCLUDED.spice_level,
    is_bestseller  = EXCLUDED.is_bestseller,
    prep_time_mins = EXCLUDED.prep_time_mins,
    sort_order     = EXCLUDED.sort_order,
    status         = 'active',
    updated_at     = NOW()
WHERE menu_item.restaurant_id = EXCLUDED.restaurant_id;

-- ---------------------------------------------------------------------------
-- 5. Prove it landed.
--
-- Counted inside the transaction and raised as an exception on a mismatch, so a partial
-- load rolls back rather than going live half-applied. The count is the one thing worth
-- asserting: everything above is driven off jw_item, so if the numbers agree, the menu the
-- diner sees is the menu in this file.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
    rid       INT := (SELECT r.id FROM restaurant r JOIN jw_target t ON t.slug = r.slug);
    expected  INT := (SELECT count(*) FROM jw_item);
    live      INT;
    live_cats INT;
    retired   INT;
BEGIN
    SELECT count(*) INTO live
    FROM menu_item WHERE restaurant_id = rid AND status = 'active';

    SELECT count(*) INTO live_cats
    FROM menu_category WHERE restaurant_id = rid AND status = 'active';

    SELECT count(*) INTO retired
    FROM menu_item WHERE restaurant_id = rid AND status = 'archived';

    IF live <> expected THEN
        RAISE EXCEPTION
            'expected % active dishes, found % -- rolled back, the live menu is unchanged',
            expected, live;
    END IF;

    RAISE NOTICE 'Jawahar menu: % dishes across % categories (% retired).',
        live, live_cats, retired;
END
$verify$;

COMMIT;
