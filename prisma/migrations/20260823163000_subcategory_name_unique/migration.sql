-- Subcategory name is globally unique; slug is no longer a unique key
-- (subcategories may share slugs across different parent categories).
ALTER TABLE `subcategories` DROP INDEX `subcategories_slug_key`;
CREATE UNIQUE INDEX `subcategories_name_key` ON `subcategories`(`name`);
