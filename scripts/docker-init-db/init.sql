-- ==============================================================================
-- AI-Powered Database Automation Platform — Synthetic Demo MySQL Schema
-- Automatically executed when the demo-mysql container initializes.
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS `demo_blog_cms` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `demo_blog_cms`;

-- 1. Users Table (CLASSIFIED: RESTRICTED by security policy)
CREATE TABLE IF NOT EXISTS `users` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(50) NOT NULL UNIQUE,
    `email` VARCHAR(100) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('admin', 'editor', 'author') DEFAULT 'author',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Payments Table (CLASSIFIED: RESTRICTED by security policy)
CREATE TABLE IF NOT EXISTS `payments` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL,
    `amount` DECIMAL(10,2) NOT NULL,
    `card_last_four` VARCHAR(4) NOT NULL,
    `status` VARCHAR(20) DEFAULT 'completed',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 3. Categories Table (CLASSIFIED: ELIGIBLE / REFERENCE)
CREATE TABLE IF NOT EXISTS `categories` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL UNIQUE,
    `slug` VARCHAR(100) NOT NULL UNIQUE,
    `description` TEXT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 4. Tags Table (CLASSIFIED: ELIGIBLE / REFERENCE)
CREATE TABLE IF NOT EXISTS `tags` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(50) NOT NULL UNIQUE,
    `slug` VARCHAR(50) NOT NULL UNIQUE,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 5. Posts Table (CLASSIFIED: RECOMMENDED PRIMARY AUTOMATION TARGET)
CREATE TABLE IF NOT EXISTS `posts` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `title` VARCHAR(255) NOT NULL,
    `slug` VARCHAR(255) NOT NULL UNIQUE,
    `excerpt` TEXT NULL,
    `content` LONGTEXT NOT NULL,
    `category_id` INT NULL,
    `author_id` INT NULL,
    `status` ENUM('draft', 'published', 'archived') DEFAULT 'draft',
    `published_at` DATETIME NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_posts_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_posts_author` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 6. Post Tags association table (CLASSIFIED: ELIGIBLE RELATIONSHIP)
CREATE TABLE IF NOT EXISTS `post_tags` (
    `post_id` INT NOT NULL,
    `tag_id` INT NOT NULL,
    PRIMARY KEY (`post_id`, `tag_id`),
    CONSTRAINT `fk_pt_post` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_pt_tag` FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Seed initial synthetic records
INSERT IGNORE INTO `users` (`id`, `username`, `email`, `password_hash`, `role`) VALUES
(1, 'demo_author', 'author@syntheticsite.com', '$2b$12$e8Y5Hqj2nL6M7SyntheticHashForDemoOnly', 'author'),
(2, 'admin_editor', 'editor@syntheticsite.com', '$2b$12$u7K3Lqj1nB8M9SyntheticHashForDemoOnly', 'admin');

INSERT IGNORE INTO `categories` (`id`, `name`, `slug`, `description`) VALUES
(1, 'Engineering & Tech', 'engineering-tech', 'Technical guides, architecture, and coding deep-dives.'),
(2, 'DevOps & Cloud', 'devops-cloud', 'CI/CD, containerization, and infrastructure automation.'),
(3, 'Database Management', 'database-management', 'Relational database scaling, security, and schema design.');

INSERT IGNORE INTO `tags` (`id`, `name`, `slug`) VALUES
(1, 'MySQL', 'mysql'),
(2, 'FastAPI', 'fastapi'),
(3, 'AI Automation', 'ai-automation'),
(4, 'DevOps', 'devops');

INSERT IGNORE INTO `posts` (`id`, `title`, `slug`, `excerpt`, `content`, `category_id`, `author_id`, `status`, `published_at`) VALUES
(1, 'Welcome to Automated Tech Blogging', 'welcome-to-automated-tech-blogging', 'Introduction to the platform and automated publication workflows.', 'This initial post represents the existing content structure of the blog.', 1, 1, 'published', NOW());
