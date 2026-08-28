-- Dropping the column strands whatever objects it referenced in the bucket. That is the
-- correct trade for a rollback: deleting a restaurant's photographs because a deploy was
-- reverted is not recoverable, whereas an orphaned object costs storage and can be swept.
ALTER TABLE menu_item DROP COLUMN IF EXISTS image_key;
