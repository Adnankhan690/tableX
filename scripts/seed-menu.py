#!/usr/bin/env python3
"""Seed a detailed menu into a DEPLOYED tableX restaurant over the admin API.

Why the API and not SQL: a deployed database is reached through Supabase's SQL editor, where
a hand-written INSERT has to reproduce uid generation, the paise convention and the
(restaurant_id, name) uniqueness rules by hand. Going through POST /menu/categories and
POST /menu/items means the server applies its own validation -- a mislabelled food_type or a
price with a decimal point is refused here rather than discovered on the diner page.

Local `make seed` is not usable for this: backend/seeds/local_seed.sql hard-codes qr_token
values and demo restaurants, and its header says in as many words never to point it at a
deployed environment.

Idempotent. It reads the existing menu first and creates only what is missing, so an
interrupted run is fixed by running it again. Nothing is ever updated or deleted: an item
whose name already exists is left exactly as the restaurant has it.

Usage:
    TABLEX_EMAIL=owner@example.com TABLEX_PASSWORD=... \
        python3 scripts/seed-menu.py [--base-url https://api.tabley.in] [--dry-run]

The account must be `owner` or `manager`; menu writes are behind RequireRole and a `staff`
token answers 403.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# The menu.
#
# Prices are integer paise (docs/DECISIONS.md D7): 32000 is Rs 320.00.
# sort_order follows kitchen convention -- soups before starters before mains -- and is
# spaced by 10 so a dish can be slotted in later without renumbering its neighbours.
#
# Item tuples: (name, description, price_minor, food_type, spice_level, bestseller, available, prep_mins)
# spice_level is None where it is meaningless: a naan and an ice cream have no heat.
# A handful of rows are deliberately available=False -- a menu where nothing is ever sold
# out never exercises the greyed-out state the diner app renders (types.MenuItemView).
# ---------------------------------------------------------------------------
MENU = [
    ("Soups", "Clear and thick, served with garlic bread", 10, [
        ("Tomato Dhania Shorba", "Roasted tomato, coriander root, black pepper", 18000, "veg", "mild", False, True, 12),
        ("Sweet Corn Veg Soup", "Sweet corn, carrot and beans in a light broth", 17000, "veg", "mild", False, True, 12),
        ("Chicken Manchow Soup", "Indo-Chinese, topped with fried noodles", 21000, "non_veg", "medium", True, True, 14),
        ("Murgh Badami Shorba", "Almond and chicken, finished with cream", 23000, "non_veg", "mild", False, True, 15),
    ]),
    ("Starters - Veg", "Tandoori and fried, with mint chutney", 20, [
        ("Paneer Tikka Adnani", "House marinade of hung curd, ajwain and kasuri methi", 32000, "veg", "medium", True, True, 18),
        ("Malai Paneer Tikka", "Cream and cheese marinade, mild by design", 34000, "veg", "mild", False, True, 18),
        ("Hara Bhara Kebab", "Spinach, green peas and potato, pan-seared", 24000, "veg", "mild", False, True, 15),
        ("Mixed Veg Pakora", "Onion, potato and spinach fritters", 17000, "veg", "mild", False, True, 12),
        ("Crispy Corn Chaat", "Fried corn tossed with onion, chaat masala and lime", 19000, "veg", "medium", True, True, 10),
        ("Tandoori Mushroom", "Button mushrooms, bell pepper, tandoori masala", 29000, "veg", "medium", False, True, 18),
        ("Achari Soya Chaap", "Pickling spices, mustard oil", 27000, "veg", "hot", False, True, 20),
    ]),
    ("Starters - Non-Veg", "From the tandoor and the fryer", 30, [
        ("Chicken Tikka", "Boneless thigh, overnight marinade, charcoal tandoor", 36000, "non_veg", "medium", True, True, 20),
        ("Murgh Malai Kebab", "Cream, cheese and white pepper", 38000, "non_veg", "mild", False, True, 22),
        ("Amritsari Fish Fry", "Gram-flour batter, ajwain and lemon", 44000, "non_veg", "medium", False, True, 20),
        ("Tandoori Prawns", "Jumbo prawns, carom seed marinade", 52000, "non_veg", "medium", False, False, 22),
        ("Mutton Seekh Kebab", "Minced mutton, green chilli, hand-rolled on the skewer", 46000, "non_veg", "hot", True, True, 25),
        ("Chicken 65", "South Indian, curry leaf and dried red chilli", 32000, "non_veg", "hot", False, True, 18),
        ("Egg Chilli Fry", "Boiled eggs tossed with capsicum and onion", 20000, "egg", "hot", False, True, 15),
        ("Tandoori Chicken (Half)", "Bone-in, yoghurt and Kashmiri chilli", 42000, "non_veg", "medium", True, True, 28),
    ]),
    ("From the Tandoor", "Platters and whole cuts, for the table", 40, [
        ("Tandoori Chicken (Full)", "Whole bird, served with onion and lemon", 78000, "non_veg", "medium", False, True, 35),
        ("Adnani Kebab Platter", "Chicken tikka, seekh kebab, malai kebab and fish", 89000, "non_veg", "medium", True, True, 35),
        ("Veg Kebab Platter", "Paneer tikka, hara bhara kebab, mushroom and chaap", 62000, "veg", "medium", False, True, 30),
        ("Reshmi Kebab", "Silken chicken mince, cashew paste", 40000, "non_veg", "mild", False, True, 22),
        ("Mutton Galouti Kebab", "Slow-pounded mince, served on ulte tawa paratha", 52000, "non_veg", "medium", False, True, 28),
        ("Paneer Malai Roll", "Stuffed with mint and cheese, tandoor-finished", 33000, "veg", "mild", False, True, 20),
    ]),
    ("Main Course - Veg", "Curries, sabzi and koftas", 50, [
        ("Dal Makhani", "Black lentils, cooked overnight with butter and cream", 28000, "veg", "mild", True, True, 20),
        ("Paneer Butter Masala", "Tomato and cashew gravy, mildly sweet", 33000, "veg", "mild", True, True, 20),
        ("Kadai Paneer", "Bell peppers, onion, freshly ground kadai masala", 33000, "veg", "medium", False, True, 20),
        ("Palak Paneer", "Spinach, garlic and cottage cheese", 31000, "veg", "mild", False, True, 20),
        ("Shahi Paneer Korma", "Mughlai white gravy, melon seeds and khoya", 35000, "veg", "mild", False, True, 22),
        ("Malai Kofta", "Paneer and khoya dumplings in a cashew gravy", 32000, "veg", "mild", False, True, 22),
        ("Aloo Gobhi Masala", "Potato and cauliflower, dry, ginger and cumin", 24000, "veg", "medium", False, True, 18),
        ("Bhindi Do Pyaza", "Okra with double onion, tawa-cooked", 25000, "veg", "medium", False, True, 18),
        ("Mixed Veg Jalfrezi", "Seasonal vegetables, tomato and capsicum", 26000, "veg", "medium", False, True, 18),
        ("Soya Chaap Masala", "Punjabi dhaba style, thick onion gravy", 29000, "veg", "hot", False, False, 22),
    ]),
    ("Main Course - Non-Veg", "Chicken, mutton, fish and prawn", 60, [
        ("Butter Chicken", "The classic -- tomato, butter and kasuri methi", 42000, "non_veg", "mild", True, True, 25),
        ("Chicken Tikka Masala", "Tandoori tikka finished in a spiced gravy", 41000, "non_veg", "medium", False, True, 25),
        ("Kadai Chicken", "Bone-in, coarse-ground spices, capsicum", 39000, "non_veg", "hot", False, True, 25),
        ("Chicken Handi Adnani", "House speciality -- sealed handi, brown onion base", 44000, "non_veg", "medium", True, True, 28),
        ("Mutton Rogan Josh", "Kashmiri chillies, slow-braised shoulder", 52000, "non_veg", "hot", False, True, 32),
        ("Mutton Korma", "Yoghurt and almond gravy, whole spices", 54000, "non_veg", "medium", False, True, 32),
        ("Nihari Gosht", "Overnight shank stew, served with the marrow", 58000, "non_veg", "hot", False, False, 35),
        ("Fish Curry Malabari", "Coconut milk, kokum and curry leaf", 48000, "non_veg", "medium", False, True, 28),
        ("Egg Masala Curry", "Boiled eggs in onion-tomato masala", 24000, "egg", "medium", False, True, 18),
        ("Prawn Masala", "Tawa-roasted prawns, thick masala", 56000, "non_veg", "hot", False, True, 28),
    ]),
    ("Dal & Rice", "Everyday lentils and rice", 70, [
        ("Dal Tadka", "Yellow lentils, ghee and garlic tempering", 22000, "veg", "medium", False, True, 15),
        ("Dal Panchmel", "Five lentils, Rajasthani style", 24000, "veg", "mild", False, True, 18),
        ("Jeera Rice", "Basmati tempered with cumin", 17000, "veg", None, False, True, 12),
        ("Steamed Basmati Rice", "Plain, long grain", 13000, "veg", None, False, True, 10),
        ("Veg Fried Rice", "Wok-tossed with spring onion", 21000, "veg", "medium", False, True, 15),
        ("Egg Fried Rice", "Scrambled egg, soy and pepper", 23000, "egg", "medium", False, True, 15),
    ]),
    ("Biryani & Pulao", "Dum-cooked, served with raita and salan", 80, [
        ("Hyderabadi Chicken Dum Biryani", "Kacchi dum, saffron, served with mirchi ka salan", 39000, "non_veg", "hot", True, True, 30),
        ("Mutton Dum Biryani", "Bone-in mutton, long-grain basmati, sealed dough lid", 49000, "non_veg", "hot", True, True, 35),
        ("Adnani Special Biryani", "Chicken, boiled egg and kebab in one degh", 54000, "non_veg", "medium", False, True, 35),
        ("Subz Dum Biryani", "Seasonal vegetables, fried onion, mint", 31000, "veg", "medium", False, True, 25),
        ("Egg Biryani", "Whole eggs layered with masala rice", 27000, "egg", "medium", False, True, 22),
        ("Kashmiri Pulao", "Sweet, with pineapple, pomegranate and nuts", 25000, "veg", "mild", False, True, 20),
    ]),
    ("Breads", "From the tandoor, made to order", 90, [
        ("Tandoori Roti", "Whole wheat, plain or buttered", 3500, "veg", None, False, True, 8),
        ("Butter Naan", "Refined flour, brushed with butter", 5500, "veg", None, True, True, 8),
        ("Garlic Naan", "Fresh garlic and coriander", 6500, "veg", None, True, True, 8),
        ("Cheese Naan", "Stuffed with processed and mozzarella cheese", 9000, "veg", None, False, True, 10),
        ("Lachha Paratha", "Layered and flaky", 6000, "veg", None, False, True, 10),
        ("Missi Roti", "Gram flour, onion and ajwain", 5000, "veg", None, False, True, 10),
        ("Sheermal", "Saffron and milk, mildly sweet", 8000, "veg", None, False, True, 12),
    ]),
    ("Indo-Chinese", "Wok dishes, hot and dry or in gravy", 100, [
        ("Veg Hakka Noodles", "Julienned vegetables, dark soy", 22000, "veg", "medium", False, True, 15),
        ("Chicken Hakka Noodles", "Shredded chicken, spring onion", 26000, "non_veg", "medium", False, True, 15),
        ("Chilli Paneer Dry", "Capsicum, onion and green chilli", 29000, "veg", "hot", False, True, 18),
        ("Chilli Chicken Dry", "Batter-fried chicken, tossed hot", 33000, "non_veg", "hot", True, True, 18),
        ("Veg Manchurian Gravy", "Fried vegetable balls in a garlic gravy", 25000, "veg", "medium", False, True, 18),
        ("Schezwan Fried Rice", "House schezwan paste, fiery", 24000, "veg", "hot", False, True, 15),
    ]),
    ("Accompaniments", "Raita, salad and papad", 110, [
        ("Boondi Raita", "Chilled, with roasted cumin", 9000, "veg", None, False, True, 5),
        ("Mixed Veg Raita", "Onion, tomato and cucumber", 10000, "veg", None, False, True, 6),
        ("Green Salad", "Onion, cucumber, tomato and lemon", 8000, "veg", None, False, True, 5),
        ("Masala Papad", "Roasted, with onion and chaat masala", 7000, "veg", "mild", False, True, 5),
        ("Mirchi Ka Salan", "Peanut and sesame gravy, served with biryani", 9000, "veg", "hot", False, True, 8),
    ]),
    ("Desserts", "House-made, plus ice cream", 120, [
        ("Gulab Jamun (2 pcs)", "Warm, in cardamom sugar syrup", 12000, "veg", None, True, True, 5),
        ("Ras Malai", "Chilled, saffron and pistachio", 15000, "veg", None, False, True, 5),
        ("Gajar Ka Halwa", "Slow-cooked carrot, ghee and khoya", 14000, "veg", None, False, True, 8),
        ("Shahi Tukda", "Fried bread in rabri, silver leaf", 16000, "veg", None, False, True, 10),
        ("Phirni", "Ground rice pudding, served in an earthen bowl", 13000, "veg", None, False, False, 6),
        ("Vanilla Ice Cream", "Two scoops", 9000, "veg", None, False, True, 3),
    ]),
    ("Beverages", None, 130, [
        ("Masala Chai", "Cardamom, ginger and clove", 6000, "veg", None, False, True, 6),
        ("Filter Coffee", "Chicory blend, served hot", 7000, "veg", None, False, True, 6),
        ("Sweet Lassi", "Thick, churned yoghurt", 10000, "veg", None, True, True, 5),
        ("Salted Chaas", "Buttermilk with cumin and curry leaf", 8000, "veg", None, False, True, 4),
        ("Masala Lime Soda", "Fresh lime, black salt, soda", 8000, "veg", None, False, True, 4),
        ("Fresh Mango Shake", "Seasonal, no syrup", 14000, "veg", None, False, True, 6),
        ("Rose Falooda", "Vermicelli, basil seed, rose syrup and ice cream", 16000, "veg", None, False, True, 10),
        ("Packaged Water (1L)", None, 3000, "veg", None, False, True, 1),
    ]),
    ("Thalis & Kids", "Full meals on one plate", 140, [
        ("Adnani Veg Thali", "Two sabzi, dal, rice, three rotis, raita and dessert", 34000, "veg", "mild", True, True, 25),
        ("Adnani Non-Veg Thali", "Butter chicken, dal, rice, three rotis, raita and dessert", 44000, "non_veg", "medium", True, True, 28),
        ("Kids Butter Chicken Combo", "Small portion, one butter naan, ice cream", 32000, "non_veg", "mild", False, True, 22),
        ("Kids Paneer Combo", "Paneer butter masala, one butter naan, ice cream", 28000, "veg", "mild", False, True, 20),
    ]),
]


class APIError(Exception):
    pass


def call(base_url, method, path, body=None, token=None):
    """One HTTP call. Returns (status, decoded_body).

    A 4xx is returned rather than raised: 409 is an expected, benign answer here (the row
    already exists) and the caller decides what a status means.
    """
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base_url + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            return err.code, json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return err.code, {"message": raw.decode(errors="replace")[:400]}
    except urllib.error.URLError as err:
        raise APIError(f"cannot reach {base_url}: {err.reason}") from err


def login(base_url, email, password):
    status, body = call(base_url, "POST", "/api/admin/v1/auth/login",
                        {"email": email, "password": password})
    if status != 200:
        raise APIError(f"login failed ({status}): {body.get('code', '')} {body.get('message', '')}")
    d = body["data"]
    if d["staff"]["role"] not in ("owner", "manager"):
        # Fail here rather than on the first write: menu routes are behind RequireRole, so a
        # staff token would produce 403 on every single item and look like a server fault.
        raise APIError(f"{email} is role '{d['staff']['role']}'; menu writes need owner or manager")
    return d["access_token"], d["restaurant"]


def existing_menu(base_url, token):
    """Current categories, and items keyed by name, so this run creates only what is missing."""
    status, body = call(base_url, "GET", "/api/admin/v1/menu", token=token)
    if status != 200:
        raise APIError(f"could not read the existing menu ({status}): {body.get('message', '')}")
    cats, items = {}, {}
    for c in body["data"].get("categories") or []:
        cats[c["name"]] = c["uid"]
        for i in c.get("items") or []:
            # Keyed by name across the whole menu, not per category: names are unique per
            # restaurant, so a dish moved between categories must not be created twice.
            items[i["name"]] = {"uid": i["uid"], "is_available": i["is_available"]}
    return cats, items


def set_unavailable(base_url, token, uid, name):
    """Mark one dish sold out, as a separate PATCH after creation.

    Not a workaround that can be folded back into the create call: POST /menu/items accepts
    `is_available` and then loses it. The service builds a models.MenuItem struct, and the
    field is tagged `gorm:"not null;default:true"`, so GORM treats the Go zero value `false`
    as "not set" and omits the column -- Postgres then applies its own DEFAULT TRUE
    (migration 005). The item is created available whatever the request said.

    PATCH /menu/items/:uid/availability goes through UpdateItemFields, which builds a
    map[string]any, and a map carries `false` faithfully. So the state is reachable, just not
    in one call.
    """
    status, body = call(base_url, "PATCH", f"/api/admin/v1/menu/items/{uid}/availability",
                        {"is_available": False}, token)
    if status == 200:
        return True
    print(f"    ! {name} -- could not mark sold out: {status} "
          f"{body.get('code', '')} {body.get('message', '')}")
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default=os.environ.get("TABLEX_API", "https://api.tabley.in"),
                    help="API root (default: https://api.tabley.in)")
    ap.add_argument("--dry-run", action="store_true",
                    help="log in, read the menu, print what would be created, write nothing")
    args = ap.parse_args()

    email = os.environ.get("TABLEX_EMAIL")
    password = os.environ.get("TABLEX_PASSWORD")
    if not email or not password:
        sys.exit("set TABLEX_EMAIL and TABLEX_PASSWORD (an owner or manager login)")

    base_url = args.base_url.rstrip("/")
    token, restaurant = login(base_url, email, password)
    print(f"signed in to {restaurant['name']} ({restaurant['slug']}) at {base_url}")

    cats, items = existing_menu(base_url, token)
    if cats or items:
        print(f"  existing: {len(cats)} categories, {len(items)} items -- these are left untouched")

    planned_items = sum(len(c[3]) for c in MENU)
    if args.dry_run:
        new_cats = [c[0] for c in MENU if c[0] not in cats]
        new_items = [i[0] for c in MENU for i in c[3] if i[0] not in items]
        # Sold-out state is applied by a second call, so a run that creates nothing can
        # still have work to do.
        fixups = [i[0] for c in MENU for i in c[3]
                  if not i[6] and items.get(i[0], {}).get("is_available", False)]
        print(f"\ndry run: would create {len(new_cats)}/{len(MENU)} categories "
              f"and {len(new_items)}/{planned_items} items")
        if fixups:
            print(f"  and mark {len(fixups)} existing items sold out")
        for name in new_cats:
            print(f"  + category  {name}")
        for name in new_items:
            print(f"  + item      {name}")
        for name in fixups:
            print(f"  ~ sold out  {name}")
        return

    made_c = made_i = skipped = sold_out = 0
    failures = []

    for cat_name, cat_desc, cat_sort, cat_items in MENU:
        uid = cats.get(cat_name)
        if uid:
            print(f"= {cat_name}")
        else:
            status, body = call(base_url, "POST", "/api/admin/v1/menu/categories", {
                "name": cat_name,
                "description": cat_desc or "",
                "sort_order": cat_sort,
            }, token)
            if status == 201:
                uid = body["data"]["uid"]
                made_c += 1
                print(f"+ {cat_name}")
            elif status == 409:
                # Created by a concurrent run, or present under a status this listing skipped.
                # Re-read rather than guess a uid.
                cats, _ = existing_menu(base_url, token)
                uid = cats.get(cat_name)
                print(f"= {cat_name} (already existed)")
            if not uid:
                failures.append(f"category {cat_name}: {status} {body.get('code', '')} {body.get('message', '')}")
                print(f"! {cat_name} -- skipping its {len(cat_items)} items")
                continue
            cats[cat_name] = uid

        for position, (name, desc, price, food_type, spice, best, avail, prep) in enumerate(cat_items, start=1):
            if name in items:
                skipped += 1
                # An item already present is left as the restaurant has it, with one
                # exception: a dish this menu defines as sold out that is currently on sale
                # was almost certainly created by an earlier run of this script, before the
                # availability PATCH below existed.
                if not avail and items[name]["is_available"]:
                    if set_unavailable(base_url, token, items[name]["uid"], name):
                        sold_out += 1
                        items[name]["is_available"] = False
                        print(f"    ~ {name} marked sold out")
                continue
            payload = {
                "category_uid": uid,
                "name": name,
                "description": desc or "",
                "price_minor": price,
                "food_type": food_type,
                "is_available": avail,
                "is_bestseller": best,
                "prep_time_mins": prep,
                # Spaced by 10 within the category, in the order listed above, so a dish can
                # be slotted between two others later without renumbering the rest.
                "sort_order": position * 10,
            }
            if spice:
                payload["spice_level"] = spice
            status, body = call(base_url, "POST", "/api/admin/v1/menu/items", payload, token)
            if status == 201:
                made_i += 1
                created = body["data"]
                items[name] = {"uid": created["uid"], "is_available": created["is_available"]}
                note = ""
                # See set_unavailable: the create call cannot store `false`, so every
                # sold-out dish takes a second PATCH here.
                if not avail and created["is_available"]:
                    if set_unavailable(base_url, token, created["uid"], name):
                        sold_out += 1
                        items[name]["is_available"] = False
                        note = "  [sold out]"
                print(f"    + {name}  {created['price']['display']}{note}")
            elif status == 409:
                skipped += 1
                # Created concurrently, or under a category this listing did not show. Re-read
                # to pick up its uid before deciding anything about its availability.
                _, items = existing_menu(base_url, token)
                print(f"    = {name} (already existed)")
                if not avail and items.get(name, {}).get("is_available"):
                    if set_unavailable(base_url, token, items[name]["uid"], name):
                        sold_out += 1
                        items[name]["is_available"] = False
            else:
                failures.append(f"item {name}: {status} {body.get('code', '')} {body.get('message', '')}")
                print(f"    ! {name} -- {status} {body.get('code', '')} {body.get('message', '')}")

    print(f"\ncreated {made_c} categories and {made_i} items; {skipped} already present; "
          f"{sold_out} marked sold out")

    cats, items = existing_menu(base_url, token)
    unavailable = sum(1 for i in items.values() if not i["is_available"])
    print(f"menu now: {len(cats)} categories, {len(items)} items, {unavailable} sold out")

    if failures:
        print(f"\n{len(failures)} failed:")
        for f in failures:
            print(f"  {f}")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except APIError as err:
        sys.exit(f"error: {err}")
