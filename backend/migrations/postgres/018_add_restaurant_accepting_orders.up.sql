-- restaurant.accepting_orders: the "we are open" switch staff flip during service.

-- DELIBERATELY SEPARATE FROM status, and the split is the same one menu_item already makes
-- between status and is_available.
--
--   status           lifecycle. Is this restaurant on the platform at all? active / inactive /
--                    archived. Changed rarely, by an operator.
--   accepting_orders today-and-right-now. Are we taking orders this minute? Flipped twice a day
--                    by whoever is on the floor.
--
-- Collapsing them would mean closing up for the night ARCHIVES the restaurant -- orphaning its
-- order history and dropping it out of the public directory -- and that reopening in the morning
-- is an operator action rather than a staff one. Exactly the reasoning in migration 005 for why a
-- sold-out dish is not an archived dish.
--
-- DEFAULT TRUE because every restaurant that exists today is taking orders, and a migration that
-- silently closed all of them would be an outage.
ALTER TABLE restaurant ADD COLUMN accepting_orders BOOLEAN NOT NULL DEFAULT TRUE;

-- Deliberately NOT indexed. It is read as part of a row already being loaded by uid or slug, and
-- never used as a search predicate -- an index here would be paid for on every restaurant write to
-- serve no query.

-- NOTE ON WHAT THIS DOES NOT DO. A manual switch protects nothing on the night somebody forgets to
-- flip it, and forgetting is the normal case rather than the exceptional one. The intended
-- follow-up is scheduled service hours, with this column as the manual override on top of them:
-- the schedule closes the restaurant when everyone has gone home, and the switch handles closing
-- early, a kitchen failure, or a private event. Until that lands, this is a floor control rather
-- than a security boundary, and should be described as one.
