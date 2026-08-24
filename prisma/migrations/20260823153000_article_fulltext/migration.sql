-- MySQL FULLTEXT index for article search (Prisma does not manage FULLTEXT)
ALTER TABLE `articles` ADD FULLTEXT INDEX `articles_fulltext` (`title`, `excerpt`, `content`);
