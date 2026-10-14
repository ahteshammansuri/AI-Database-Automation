import json
import logging
from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from backend.app.database import SessionLocal
from backend.app.models import Automation, AutomationExecution
from backend.app.automation.engine import AutomationEngine

logger = logging.getLogger("app.scheduler")


class JobSchedulerManager:
    """Manages scheduled background execution for generation lead times and publication deadlines."""

    def __init__(self):
        self.scheduler = BackgroundScheduler(daemon=True)
        self.is_running = False

    def start(self):
        if not self.is_running:
            # Poll every 30 seconds for scheduled jobs and publication deadlines
            self.scheduler.add_job(
                self._check_and_run_schedules,
                trigger=IntervalTrigger(seconds=30),
                id="schedule_poller",
                replace_existing=True
            )
            self.scheduler.start()
            self.is_running = True
            logger.info("Background job scheduler started successfully.")

    def stop(self):
        if self.is_running:
            self.scheduler.shutdown(wait=False)
            self.is_running = False
            logger.info("Background job scheduler stopped.")

    def _check_and_run_schedules(self):
        """Worker loop checking for due generation and publication jobs."""
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)

            # 1. Check pending executions due for publication
            due_executions = db.query(AutomationExecution).filter(
                AutomationExecution.status.in_(["APPROVED", "PENDING_APPROVAL"]),
                AutomationExecution.scheduled_publication_time <= now
            ).all()

            for exec_item in due_executions:
                try:
                    logger.info(f"Triggering scheduled publication for execution #{exec_item.id}")
                    AutomationEngine.execute_publication(db=db, execution_id=exec_item.id)
                except Exception as e:
                    logger.error(f"Error publishing execution #{exec_item.id}: {e}")

        except Exception as e:
            logger.error(f"Error in scheduler loop: {e}")
        finally:
            db.close()


scheduler_manager = JobSchedulerManager()
