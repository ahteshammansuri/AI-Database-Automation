import json
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, Tuple
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models import (
    Automation, AutomationExecution, ContentVersion, ApprovalToken, AuditLog
)
from backend.app.rag.service import RAGService
from backend.app.ai.factory import get_ai_provider
from backend.app.executor.service import ExecutionService
from backend.app.automation.approval_service import ApprovalService
from backend.app.automation.email_service import EmailService


class AutomationEngine:
    """Core orchestration engine managing generation, approval, timeout, and publishing."""

    @classmethod
    def trigger_generation(
        cls,
        db: Session,
        automation_id: int,
        trigger_type: str = "SCHEDULED",
        rejection_feedback: Optional[str] = None,
        existing_execution_id: Optional[int] = None
    ) -> AutomationExecution:
        automation = db.query(Automation).filter(Automation.id == automation_id).first()
        if not automation:
            raise ValueError(f"Automation #{automation_id} not found")

        approval_policy = json.loads(automation.approval_policy_json)
        max_regens = approval_policy.get("max_regenerations", 3)

        # 1. Resolve or create execution record
        if existing_execution_id:
            execution = db.query(AutomationExecution).filter(AutomationExecution.id == existing_execution_id).first()
            if not execution:
                raise ValueError(f"Execution #{existing_execution_id} not found")
            execution.regeneration_count += 1
            if execution.regeneration_count > max_regens:
                execution.status = "NEEDS_REVIEW"
                execution.error_message = f"Maximum automatic regeneration limit ({max_regens}) reached. Manual review required."
                db.commit()
                return execution
        else:
            idempotency_key = f"exec_{automation.id}_{int(time.time())}_{uuid.uuid4().hex[:6]}"
            execution = AutomationExecution(
                automation_id=automation.id,
                status="GENERATING",
                mode=automation.mode,
                trigger_type=trigger_type,
                idempotency_key=idempotency_key,
                scheduled_generation_time=datetime.now(timezone.utc),
                scheduled_publication_time=datetime.now(timezone.utc) + timedelta(hours=1),
                started_at=datetime.now(timezone.utc),
                regeneration_count=0
            )
            db.add(execution)
            db.commit()
            db.refresh(execution)

        # 2. Perform AI generation
        ai_config = json.loads(automation.ai_config_json) if automation.ai_config_json else {}
        topic = ai_config.get("topic", "Modern Database Automation")
        tone = ai_config.get("tone", "Authoritative and educational")
        doc_ids = ai_config.get("document_ids", [])
        field_mappings = json.loads(automation.field_mappings_json)
        required_fields = [m["column"] for m in field_mappings if m.get("source") == "AI_GENERATED"]
        if not required_fields:
            required_fields = ["title", "slug", "excerpt", "content", "status"]

        # Retrieve RAG context chunks
        context_chunks = []
        if doc_ids:
            matches = RAGService.retrieve_context_for_prompt(query=topic, top_k=3, document_ids=doc_ids)
            context_chunks = [m["content"] for m in matches]

        prompt = f"Topic: {topic}\nTone: {tone}\nTarget Audience: Software engineers and website owners.\n"
        if context_chunks:
            prompt += "\nReference Guidelines and Context:\n" + "\n---\n".join(context_chunks)

        system_prompt = f"Generate a structured publishable record for table '{automation.target_table}'."

        provider_name = ai_config.get("provider", settings.DEFAULT_AI_PROVIDER)
        provider = get_ai_provider(provider_name)

        generated_payload = provider.generate_structured_data(
            prompt=prompt,
            system_prompt=system_prompt,
            target_table=automation.target_table,
            required_fields=required_fields,
            rejection_feedback=rejection_feedback
        )

        # 3. Create immutable ContentVersion
        version_num = execution.regeneration_count + 1
        content_version = ContentVersion(
            execution_id=execution.id,
            automation_id=automation.id,
            version_number=version_num,
            payload_json=json.dumps(generated_payload),
            status="PENDING_APPROVAL",
            retrieved_chunks_json=json.dumps(context_chunks)
        )
        db.add(content_version)
        db.commit()
        db.refresh(content_version)

        # 4. Issue single-use approval tokens
        tokens = ApprovalService.issue_tokens_for_version(
            db=db,
            execution_id=execution.id,
            version_id=content_version.id,
            expiry_hours=settings.TOKEN_EXPIRY_HOURS
        )

        # 5. Send approval email
        reviewer_email = approval_policy.get("reviewer_email", settings.SMTP_FROM_EMAIL)
        approve_url = f"{settings.FRONTEND_URL}/approvals/{tokens['approve_token']}"
        reject_url = f"{settings.FRONTEND_URL}/approvals/{tokens['reject_token']}"
        pub_time_str = execution.scheduled_publication_time.strftime("%Y-%m-%d %H:%M UTC") if execution.scheduled_publication_time else "Immediate"

        EmailService.send_approval_email(
            to_email=reviewer_email,
            automation_name=automation.name,
            title=generated_payload.get("title", f"Draft #{version_num}"),
            excerpt=generated_payload.get("excerpt", "Content summary"),
            content_preview=generated_payload.get("content", ""),
            approve_url=approve_url,
            reject_url=reject_url,
            publication_time_str=pub_time_str,
            version_number=version_num
        )

        execution.status = "PENDING_APPROVAL"
        db.commit()
        db.refresh(execution)
        return execution

    @classmethod
    def execute_publication(
        cls,
        db: Session,
        execution_id: int
    ) -> Tuple[bool, str]:
        execution = db.query(AutomationExecution).filter(AutomationExecution.id == execution_id).first()
        if not execution:
            return False, "Execution record not found"

        automation = execution.automation
        if not automation:
            return False, "Associated automation not found"

        # Check latest content version
        latest_version = db.query(ContentVersion).filter(
            ContentVersion.execution_id == execution.id
        ).order_by(ContentVersion.version_number.desc()).first()

        if not latest_version:
            execution.status = "FAILED"
            execution.error_message = "No content version ready for publication."
            db.commit()
            return False, execution.error_message

        # Rule check: A rejected version must NEVER publish
        if latest_version.status == "REJECTED":
            execution.status = "FAILED"
            execution.error_message = "Safety Policy: Rejected content version cannot be published."
            db.commit()
            return False, execution.error_message

        # Timeout policy check
        if latest_version.status == "PENDING_APPROVAL":
            approval_policy = json.loads(automation.approval_policy_json)
            timeout_action = approval_policy.get("timeout_action", "PUBLISH_PENDING")
            if timeout_action != "PUBLISH_PENDING":
                execution.status = "NEEDS_REVIEW"
                execution.error_message = f"Timeout reached with action {timeout_action}. Publication withheld."
                db.commit()
                return False, execution.error_message
            # Allowed to auto-publish pending version under explicit policy
            latest_version.status = "APPROVED"

        # Perform atomic database write
        execution.status = "EXECUTING"
        db.commit()

        payload = json.loads(latest_version.payload_json)
        success, msg, target_pk = ExecutionService.execute_publication(
            db=db,
            automation=automation,
            payload=payload,
            idempotency_key=execution.idempotency_key
        )

        now = datetime.now(timezone.utc)
        execution.completed_at = now

        if success:
            execution.status = "PUBLISHED"
            execution.target_record_id = target_pk
            latest_version.status = "PUBLISHED"
            db.commit()
            return True, msg
        else:
            execution.status = "FAILED"
            execution.error_message = msg
            db.commit()
            return False, msg

    @classmethod
    def schedule_manual_publication(
        cls,
        db: Session,
        automation_id: int,
        payload: Dict[str, Any],
        publication_time: Optional[datetime] = None
    ) -> AutomationExecution:
        """Schedule content provided directly by the user WITHOUT calling any AI provider."""
        automation = db.query(Automation).filter(Automation.id == automation_id).first()
        if not automation:
            raise ValueError(f"Automation #{automation_id} not found")

        idempotency_key = f"manual_{automation.id}_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        pub_time = publication_time or (datetime.now(timezone.utc) + timedelta(minutes=5))

        execution = AutomationExecution(
            automation_id=automation.id,
            status="APPROVED",  # User-supplied manual content is pre-approved
            mode="MANUAL",
            trigger_type="MANUAL",
            idempotency_key=idempotency_key,
            scheduled_publication_time=pub_time,
            started_at=datetime.now(timezone.utc),
            regeneration_count=0
        )
        db.add(execution)
        db.commit()
        db.refresh(execution)

        version = ContentVersion(
            execution_id=execution.id,
            automation_id=automation.id,
            version_number=1,
            payload_json=json.dumps(payload),
            status="APPROVED"
        )
        db.add(version)
        db.commit()

        return execution
