ALTER TABLE menu_item DROP CONSTRAINT IF EXISTS menu_item_rating_sum_non_negative;
ALTER TABLE menu_item DROP CONSTRAINT IF EXISTS menu_item_rating_count_non_negative;
ALTER TABLE menu_item DROP COLUMN IF EXISTS rating_sum;
ALTER TABLE menu_item DROP COLUMN IF EXISTS rating_count;
