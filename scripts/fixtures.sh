#!/usr/bin/env bash
# Start / stop / reset the fixture customer databases used by the data-agent tests.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "$DIR/docker-compose.fixtures.yml")
case "${1:-up}" in
  up)
    "${COMPOSE[@]}" up -d
    echo "[*] waiting for fixture databases to report healthy..."
    for svc in dataauto-fx-mysql dataauto-fx-postgres; do
      for _ in $(seq 1 90); do
        state="$(docker inspect -f '{{.State.Health.Status}}' "$svc" 2>/dev/null || echo missing)"
        [ "$state" = "healthy" ] && break
        sleep 2
      done
      echo "    $svc: $state"
    done ;;
  down)  "${COMPOSE[@]}" down ;;
  reset) "${COMPOSE[@]}" down -v && "$0" up ;;
  *) echo "usage: $0 [up|down|reset]"; exit 1 ;;
esac
