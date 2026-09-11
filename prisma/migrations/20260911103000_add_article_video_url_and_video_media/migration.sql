-- Add uploaded video media support and article featured-video URLs.
-- Additive/non-destructive: existing media rows keep their current kind.
ALTER TABLE `media` MODIFY `kind` ENUM('image', 'pdf', 'video') NOT NULL DEFAULT 'image';

ALTER TABLE `articles` ADD COLUMN `video_url` VARCHAR(500) NULL AFTER `featured_image_id`;
