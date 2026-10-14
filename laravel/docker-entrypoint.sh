#!/bin/sh
set -e

# Copy .env from .env.example if missing
if [ ! -f .env ]; then
    echo "[*] Initializing .env from .env.example..."
    cp .env.example .env
fi

# Ensure composer dependencies are installed
if [ ! -f vendor/autoload.php ]; then
    echo "[*] Installing Composer dependencies..."
    composer install --no-interaction --prefer-dist --optimize-autoloader
fi

# Ensure storage and bootstrap/cache directories exist with proper write permissions
mkdir -p storage/framework/cache/data \
         storage/framework/sessions \
         storage/framework/views \
         storage/logs \
         bootstrap/cache \
         database
chmod -R 777 storage bootstrap/cache database 2>/dev/null || true

# If running the primary web server, run one-time setup tasks
if [ "$1" = "php" ] && [ "$2" = "artisan" ] && [ "$3" = "serve" ]; then
    # Generate app key if missing
    if ! grep -q "^APP_KEY=base64:" .env 2>/dev/null; then
        echo "[*] Generating application key..."
        php artisan key:generate --force
    fi

    # Initialize SQLite database file if configured for sqlite
    if [ "${DB_CONNECTION:-sqlite}" = "sqlite" ]; then
        if [ ! -f database/database.sqlite ]; then
            echo "[*] Creating database/database.sqlite..."
            touch database/database.sqlite
            chmod 666 database/database.sqlite
        fi
    fi

    # Run database migrations
    echo "[*] Running database migrations..."
    php artisan migrate --force --graceful
fi

echo "[+] Executing: $@"
exec "$@"
