<?php

namespace Tests\Concerns;

use App\Models\DbConnection;
use App\Models\User;
use PDO;

/**
 * Creates a disposable, synthetic blog database inside the fixture MySQL container
 * (docker-compose.fixtures.yml, 127.0.0.1:3317) for each test, and drops it afterwards.
 * Tests are skipped with a clear message when the fixture container is not running.
 *
 * Schema (deliberately awkward to exercise the relation logic):
 *   users(id, name, email, password)                      protected parent, never created
 *   categories(id, name UNIQUE, slug UNIQUE, description, status ENUM NOT NULL, sort_order INT NOT NULL, timestamps)
 *   posts(id, title VARCHAR(120), slug UNIQUE, excerpt, content LONGTEXT NOT NULL, banner, meta_img,
 *         category_id NOT NULL FK, author_id NULL FK users, status ENUM, published_at, timestamps)
 */
trait UsesAutomationFixtureDatabase
{
    protected ?string $fixtureDb = null;

    protected function fixturePdo(?string $db = null): PDO
    {
        $dsn = 'mysql:host=127.0.0.1;port=3317;charset=utf8mb4' . ($db ? ";dbname={$db}" : '');
        return new PDO($dsn, 'root', 'fxroot', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 3,
        ]);
    }

    protected function createFixtureBlogDatabase(): string
    {
        try {
            $pdo = $this->fixturePdo();
        } catch (\Throwable $e) {
            $this->markTestSkipped('Fixture MySQL (127.0.0.1:3317) is not running. Start it with: docker compose -f docker-compose.fixtures.yml up -d');
        }

        $db = 'autofx_' . bin2hex(random_bytes(4));
        $pdo->exec("CREATE DATABASE `{$db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
        $pdo->exec("USE `{$db}`");
        $pdo->exec("CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, email VARCHAR(120) NOT NULL, password VARCHAR(255) NOT NULL)");
        $pdo->exec("INSERT INTO users (name, email, password) VALUES ('Asha Editor', 'asha@example.test', 'x')");
        $pdo->exec("CREATE TABLE categories (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(80) NOT NULL UNIQUE,
            slug VARCHAR(80) NOT NULL UNIQUE,
            description VARCHAR(255) NULL,
            status ENUM('inactive','active') NOT NULL,
            sort_order INT NOT NULL,
            created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL)");
        $pdo->exec("INSERT INTO categories (name, slug, status, sort_order) VALUES ('Databases', 'databases', 'active', 1), ('Cloud', 'cloud', 'active', 2)");
        $pdo->exec("CREATE TABLE posts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(120) NOT NULL,
            slug VARCHAR(140) NOT NULL UNIQUE,
            excerpt VARCHAR(300) NULL,
            content LONGTEXT NOT NULL,
            banner VARCHAR(500) NULL,
            meta_img VARCHAR(500) NULL,
            category_id INT NOT NULL,
            author_id INT NULL,
            status ENUM('draft','published') NOT NULL DEFAULT 'draft',
            published_at DATETIME NULL,
            created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL,
            CONSTRAINT fk_posts_category FOREIGN KEY (category_id) REFERENCES categories(id),
            CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users(id))");
        $pdo->exec("INSERT INTO posts (title, slug, content, category_id) VALUES ('Existing post', 'existing-post', 'Body', 1)");

        $this->fixtureDb = $db;
        return $db;
    }

    protected function fixtureConnection(User $user, string $db): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Fixture Blog',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3317,
            'database_name' => $db,
            'username' => 'root',
            'encrypted_password' => 'fxroot',
            'ssl_mode' => 'disabled',
            'data_timezone' => 'UTC',
            'is_active' => true,
        ]);
    }

    protected function fixtureCount(string $table, string $where = '1=1', array $params = []): int
    {
        $stmt = $this->fixturePdo($this->fixtureDb)->prepare("SELECT COUNT(*) FROM `{$table}` WHERE {$where}");
        $stmt->execute($params);
        return (int) $stmt->fetchColumn();
    }

    protected function fixtureRow(string $table, string $where, array $params = []): ?array
    {
        $stmt = $this->fixturePdo($this->fixtureDb)->prepare("SELECT * FROM `{$table}` WHERE {$where} LIMIT 1");
        $stmt->execute($params);
        return $stmt->fetch() ?: null;
    }

    protected function dropFixtureBlogDatabase(): void
    {
        if ($this->fixtureDb) {
            try {
                $this->fixturePdo()->exec("DROP DATABASE IF EXISTS `{$this->fixtureDb}`");
            } catch (\Throwable) {
            }
            $this->fixtureDb = null;
        }
    }
}
