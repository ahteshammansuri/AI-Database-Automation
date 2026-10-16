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

## 3. Scheduling model (updated 2026-10-16)

All schedule arithmetic lives in `App\Services\Automation\ScheduleCalculator` and is shared by the scheduler, the API, the calendar and the builder preview.

### Frequencies
| Type | Runs | Ends |
|---|---|---|
| `ONE_TIME` | Once, on `start_date` | Automatically after that run finishes (state **Done**) |
| `DAILY` | Every day from `start_date` | On `end_date` (optional, "run until") |
| `WEEKLY` | On the ISO weekdays in `weekly_days` (1 = Mon … 7 = Sun) | On `end_date` (optional) |

Every run generates at `generation_time` and publishes at `publication_time` on the same local date, or the next day when publication is earlier on the clock (e.g. 23:50 → 00:10). Dates and times are wall-clock values in the automation's IANA `timezone`, so DST changes never move a run; stored instants are UTC.

### Minimum gap: 15 minutes
Publication must be **at least 15 minutes after generation**, and never equal to it. The builder, the API (`ScheduleCalculator::validate`), Orbit's tool registry and the calendar reschedule all enforce the same rule. A one-time run in the past, an end date before the start date, or a range with no future run is rejected with a field-level message.

### What the scheduler does each minute (`automations:check-schedule`)
1. Recovers executions whose worker lease expired. A stuck *publish* is retried as a publish (idempotent), never re-generated.
2. Lists every occurrence whose generation time has arrived since `schedule_anchor_at` (at most 7 days back) and creates exactly one execution per occurrence (`auto_{id}_{local date}_gen`).
   - If the publication time of that occurrence has already passed (scheduler was down), the run is recorded as **MISSED** with an explanation. Nothing is generated or written.
   - `schedule_anchor_at` is set on create, on any schedule change and on resume, so changing or resuming never back-fills old runs.
3. Dispatches runs that were held back by the per-tenant concurrency cap (previously they were never picked up).
4. Applies publication deadlines: approved/ready runs publish; pending ones follow the no-response policy (`AUTO_PUBLISH_LATEST`, `KEEP_DRAFT` → **SKIPPED**, `CANCEL` → **CANCELLED**). A draft that finished *after* its publication time is never auto-published; it waits for a human.
5. Marks the automation **completed** once the schedule has no future run and nothing is in flight.

Manual-publishing containers (`schedule_type = NONE`) are never scheduled.

### Jobs
- `GenerateAutomationContentJob` claims its execution atomically (`QUEUED|PENDING_GENERATION|REGENERATING → GENERATING`), so a duplicate job is a no-op. `timeout = 690s` (below the queue's `retry_after = 720s`), `tries = 1` (retries are owned by lease recovery).
- `PublishAutomationContentJob` uses the idempotency key `publish_exec_{id}`, never acts on a finished run, takes relation policies from the reviewed version, and fills "publication time" columns at the moment of writing.
