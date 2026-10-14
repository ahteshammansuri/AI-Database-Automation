# Queue Fairness, Worker Supervision & Scheduling

**Processing Engine:** Laravel 11 Database Queue + Horizon/Fair Queue Interleaver  
**Scheduler:** Supervised Cron Loop (`php artisan schedule:work`)  

---

## 1. Multi-Tenant Fair Dispatch

In a multi-user database automation platform, no single high-volume user should starve other tenants by flooding an unbounded global FIFO queue.

The platform implements fair round-robin dispatch across tenants via `QueueFairnessService`:
- When worker processes pull eligible jobs, executions are grouped and interleaved by `user_id`.
- Tenant A with 100 queued jobs and Tenant B with 1 queued job receive equal priority: the worker executes Tenant A job #1, then Tenant B job #1, then Tenant A job #2, rather than forcing Tenant B to wait behind Tenant A's entire backlog.
- Global and per-tenant concurrency ceilings prevent resource exhaustion.

---

## 2. Worker Supervision & Local Self-Healing

In local and staging environments without systemd or Kubernetes pod restarts:
- In `run_all.sh`, the queue worker is launched inside a supervised bash loop:
  ```bash
  (
      cd "$DIR/laravel"
      while true; do
          php artisan queue:work --sleep=2 --tries=3 --timeout=120
          sleep 2
      done
  ) &
  ```
- If a worker terminates due to a memory limit, job timeout, or unhandled signal, the supervisor automatically restarts the worker within 2 seconds.
- Enqueued jobs in the `jobs` database table are never orphaned.

---

## 3. Scheduling & 30-Minute Lead Time Rule

### Durable Schedules
- Scheduled automations do not depend on open browser tabs, client timers, or in-memory state.
- `php artisan schedule:work` runs every minute and evaluates all active automations via the `automations:check-schedule` command.
- When an automation's generation time matches the current minute in its configured timezone, an execution record is created and dispatched to the background queue.

### Enforced 30-Minute Generation Lead Time
- Content generation, RAG retrieval, structured validation, and optional editorial review take time.
- The platform enforces a minimum gap of **30 minutes** between generation time and target publication time:
  - If a user sets publication time to `09:00`, generation time defaults to `08:30` (or earlier).
  - Both client-side validation in `AutomationBuilderPage.tsx` and server-side validation in `AutomationController.php` reject configurations with less than a 30-minute buffer.
- This buffer guarantees that editorial approval emails have adequate lead time before publication deadlines.
