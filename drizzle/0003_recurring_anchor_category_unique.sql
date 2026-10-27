ALTER TABLE "recurring" ADD COLUMN "anchor_day" smallint;
--> statement-breakpoint
UPDATE "recurring" SET "anchor_day" = EXTRACT(DAY FROM "next_date")::smallint;
--> statement-breakpoint
DROP INDEX "categories_user_name_parent_idx";
--> statement-breakpoint
-- Merge duplicate categories that the old index allowed (NULL parent_id values never conflicted).
-- Repeats because merging parents can make their children collide.
DO $$
BEGIN
	LOOP
		CREATE TEMP TABLE category_dupes AS
			SELECT id, keep_id FROM (
				SELECT id, first_value(id) OVER (PARTITION BY user_id, name, parent_id ORDER BY is_default DESC, created_at, id) AS keep_id
				FROM categories
			) ranked WHERE id <> keep_id;
		IF NOT EXISTS (SELECT 1 FROM category_dupes) THEN
			DROP TABLE category_dupes;
			EXIT;
		END IF;
		UPDATE transactions t SET category_id = d.keep_id FROM category_dupes d WHERE t.category_id = d.id;
		UPDATE budgets b SET category_id = d.keep_id FROM category_dupes d WHERE b.category_id = d.id;
		UPDATE categories c SET parent_id = d.keep_id FROM category_dupes d WHERE c.parent_id = d.id;
		DELETE FROM categories c USING category_dupes d WHERE c.id = d.id;
		DROP TABLE category_dupes;
	END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_parent_idx" ON "categories" USING btree ("user_id", "name", coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid));
