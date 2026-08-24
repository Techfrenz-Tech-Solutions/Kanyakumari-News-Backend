-- DropIndex
DROP INDEX `articles_fulltext` ON `articles`;

-- AlterTable
ALTER TABLE `site_settings` ADD COLUMN `district_info` JSON NULL;
