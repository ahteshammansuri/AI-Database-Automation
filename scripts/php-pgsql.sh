#!/usr/bin/env bash
# Runs PHP with pdo_pgsql extension loaded from lib/php/
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec php -d extension="$DIR/lib/php/pdo_pgsql.so" "$@"
