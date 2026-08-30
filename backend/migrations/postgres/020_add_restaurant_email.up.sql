-- restaurant.email: the restaurant's own contact address.

-- Sits alongside phone and address as the third piece of "how do you reach this restaurant",
-- and is edited on the same Settings screen.
--
-- DELIBERATELY NOT staff_user.email. That column is an identity -- it is what an owner or
-- manager logs in with, and it is unique per person. This one is the business's address:
-- shared, changed when the restaurant changes accountant or mail provider, and carrying no
-- authentication meaning whatever. Collapsing them would mean changing where invoices arrive
-- locks somebody out of the panel.
--
-- NULLABLE, and no default. A restaurant that has been running for a year without an email on
-- file is not misconfigured, and a migration that invented one would be worse than the gap.
--
-- VARCHAR(254) is the longest address RFC 5321 permits on the wire, so the column can never be
-- the thing that rejects a legitimate one.
ALTER TABLE restaurant ADD COLUMN email VARCHAR(254);

-- Deliberately NOT indexed, and NOT unique. It is read as part of a row already loaded by uid or
-- slug, never searched on; and two restaurants under one owner may legitimately share an address.
