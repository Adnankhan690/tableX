-- menu_item.image_key: the object key of a dish photo this deployment hosts itself
-- (DECISIONS.md D15).

-- ADDED ALONGSIDE image_url, never in place of it. The two columns answer different
-- questions, and collapsing them would lose one of the answers:
--
--   image_key non-empty -> we hold the bytes. The URL a client renders is
--                          {storage.public_base_url}/{image_key}, resolved at READ time.
--                          Moving buckets, or putting a different CDN hostname in front of
--                          the same bucket, is then a config change rather than an UPDATE
--                          over every row.
--   image_key empty     -> image_url is a URL the restaurant pasted from a site they
--                          already run, and it is served verbatim. Every restaurant
--                          onboarded before uploads existed is in this state, and must
--                          keep working untouched.
--
-- Storing the resolved URL in image_url instead would bake today's hostname into the data
-- and leave nothing to delete the object by: an object key cannot be reliably recovered by
-- parsing a URL back apart once a CDN or a path prefix sits in front of it.
ALTER TABLE menu_item ADD COLUMN image_key TEXT;

-- Deliberately NOT indexed. Nothing looks a dish up by its image: the key is read from a
-- row already loaded by uid, and written by id. An index here would be paid for on every
-- menu write to serve no query.
