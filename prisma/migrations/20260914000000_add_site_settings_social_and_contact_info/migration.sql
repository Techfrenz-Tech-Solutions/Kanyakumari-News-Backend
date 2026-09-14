-- AlterTable
ALTER TABLE `site_settings` ADD COLUMN `social_telegram` VARCHAR(300) NULL,
    ADD COLUMN `social_whatsapp` VARCHAR(300) NULL,
    ADD COLUMN `social_googlenews` VARCHAR(300) NULL,
    ADD COLUMN `contact_info` JSON NULL;
