#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "=========================================================="
echo " Starting AI-Powered Database Automation Platform"
echo " 1. Python AI Service (Port 8001)"
echo " 2. Laravel Control Plane (Port 8000)"
echo " 3. Laravel Queue Worker (Database Queue)"
echo " 4. React + TypeScript Frontend (Port 5173)"
echo "=========================================================="

cleanup() {
    echo ""
    echo "[*] Shutting down all services..."
    trap - SIGINT SIGTERM EXIT
    kill $(jobs -p) 2>/dev/null || true
    # Kill process group if running in a separate group
    kill -- -$$ 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Pre-flight: cleanly free ports 8000, 8001, 5173, 8080 and kill stale workers
echo "[*] Ensuring ports 8000, 8001, 5173, 8080 and stale background workers are stopped..."
fuser -k 8000/tcp 8001/tcp 5173/tcp 8080/tcp 2>/dev/null || true
pkill -f "artisan (queue:work|schedule:work|reverb:start)" 2>/dev/null || true
sleep 0.5

# Generated images are stored on the platform and must be reachable at a public URL.
export MEDIA_PUBLIC_URL="${MEDIA_PUBLIC_URL:-http://127.0.0.1:8000}"
(cd "$DIR/laravel" && { [ -e public/storage ] || php artisan storage:link >/dev/null 2>&1; }) || true

# 1. Start Python AI Microservice
echo "[+] Starting Python AI Microservice on http://127.0.0.1:8001..."
"$DIR/.venv/bin/python" -m uvicorn ai_service.app.main:app --host 127.0.0.1 --port 8001 --reload &

# Wait for AI service
sleep 1.5

# 2. Start Laravel API Server
echo "[+] Starting Laravel 11 Backend on http://127.0.0.1:8000 with 8 workers..."
(cd "$DIR/laravel" && PHP_CLI_SERVER_WORKERS=8 php artisan serve --host=127.0.0.1 --port=8000) &

# 2b. Start Laravel Reverb WebSocket Server
echo "[+] Starting Laravel Reverb WebSocket Server on ws://127.0.0.1:8080..."
(cd "$DIR/laravel" && php artisan reverb:start --host=0.0.0.0 --port=8080) &

# 3. Start Laravel Queue Worker (Supervised auto-restart loop)
echo "[+] Starting Laravel Queue Worker (Supervised)..."
(
    cd "$DIR/laravel"
    while true; do
        php artisan queue:work --queue=default --sleep=2 --tries=3 --timeout=120
        sleep 2
    done
) &

# 3b. Orbit agent worker: one turn may take several model calls, so it runs on its
# own queue with a longer timeout (job timeout 660s < worker 700s < retry_after 720s).
# Two workers, so one long turn (slow CPU-only model) never leaves everyone else stuck in "Queued".
echo "[+] Starting Orbit Agent Workers x2 (queue: agent)..."
for n in 1 2; do
(
    cd "$DIR/laravel"
    while true; do
        php artisan queue:work --queue=agent --sleep=1 --tries=1 --timeout=700
        sleep 2
    done
) &
done

# 4. Start Laravel Scheduler (background cron for durable schedules)
echo "[+] Starting Laravel Scheduler (php artisan schedule:work)..."
(cd "$DIR/laravel" && php artisan schedule:work) &

# 5. Start React Frontend
echo "[+] Starting React Frontend on http://localhost:5173..."
(cd "$DIR/frontend" && npm run dev) &

echo ""
echo "=========================================================="
echo " All services running!"
echo " - Public Landing & Portal:     http://localhost:5173"
echo " - Laravel API Backend:         http://localhost:8000"
echo " - Laravel Reverb WebSockets:   ws://localhost:8080"
echo " - Python AI Service:           http://localhost:8001"
echo " Press Ctrl+C to stop all services."
echo "=========================================================="

wait
