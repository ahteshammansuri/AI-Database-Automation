from datetime import datetime, timezone, timedelta
from typing import Tuple, Optional, Dict, Any
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models import ApprovalToken, AutomationExecution, ContentVersion, Automation, AuditLog
from backend.app.security.encryption import generate_secure_token, hash_token


class ApprovalService:
    """Manages single-use, cryptographically secure approval tokens and reviewer action transitions."""

    @classmethod
    def issue_tokens_for_version(
        cls,
        db: Session,
        execution_id: int,
        version_id: int,
        expiry_hours: int = 24
    ) -> Dict[str, str]:
        """
        Creates single-use tokens for APPROVE and REJECT.
        Returns dict with unhashed tokens: {'approve_token': str, 'reject_token': str}
        """
        expires_at = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)

        raw_approve = generate_secure_token()
        approve_record = ApprovalToken(
            token_hash=hash_token(raw_approve),
            execution_id=execution_id,
            version_id=version_id,
            action="APPROVE",
            expires_at=expires_at
        )

        raw_reject = generate_secure_token()
        reject_record = ApprovalToken(
            token_hash=hash_token(raw_reject),
            execution_id=execution_id,
            version_id=version_id,
            action="REJECT",
            expires_at=expires_at
        )

        db.add(approve_record)
        db.add(reject_record)
        db.commit()

        return {
            "approve_token": raw_approve,
            "reject_token": raw_reject
        }

    @classmethod
    def get_token_details(cls, db: Session, raw_token: str) -> Tuple[bool, Optional[ApprovalToken], str]:
        """Validate token without consuming it (for preview confirmation screens)."""
        hashed = hash_token(raw_token)
        token_obj = db.query(ApprovalToken).filter(ApprovalToken.token_hash == hashed).first()
        if not token_obj:
            return False, None, "Invalid or unrecognized approval token."

        if token_obj.used_at is not None:
            return False, token_obj, "This token has already been used and cannot be reused."

        now = datetime.now(timezone.utc)
        token_expires = token_obj.expires_at.replace(tzinfo=timezone.utc) if token_obj.expires_at.tzinfo is None else token_obj.expires_at
        if token_expires < now:
            return False, token_obj, "This approval token has expired."

        return True, token_obj, "Token is valid."

    @classmethod
    def consume_token_action(
        cls,
        db: Session,
        raw_token: str,
        action: str,
        feedback: Optional[str] = None
    ) -> Tuple[bool, str, Optional[AutomationExecution]]:
        """
        Consumes token and executes state transition (APPROVE or REJECT).
        """
        valid, token_obj, msg = cls.get_token_details(db, raw_token)
        if not valid or not token_obj:
            return False, msg, None

        if token_obj.action != action:
            return False, f"Token action mismatch: expected {token_obj.action}, received {action}", None

        # Mark token as used
        now = datetime.now(timezone.utc)
        token_obj.used_at = now

        execution = db.query(AutomationExecution).filter(AutomationExecution.id == token_obj.execution_id).first()
        version = db.query(ContentVersion).filter(ContentVersion.id == token_obj.version_id).first()

        if not execution or not version:
            return False, "Execution or ContentVersion not found for token.", None

        if action == "APPROVE":
            version.status = "APPROVED"
            execution.status = "APPROVED"
            db.commit()

            # Record audit
            audit = AuditLog(
                action="VERSION_APPROVED",
                entity_type="content_version",
                entity_id=str(version.id),
                actor="reviewer",
                details_json=f'{{"execution_id": {execution.id}, "version_number": {version.version_number}}}'
            )
            db.add(audit)
            db.commit()
            return True, f"Version #{version.version_number} has been approved.", execution

        elif action == "REJECT":
            version.status = "REJECTED"
            version.rejection_feedback = feedback
            execution.status = "REJECTED"
            db.commit()

            # Record audit
            audit = AuditLog(
                action="VERSION_REJECTED",
                entity_type="content_version",
                entity_id=str(version.id),
                actor="reviewer",
                details_json=f'{{"execution_id": {execution.id}, "version_number": {version.version_number}, "feedback": "{feedback}"}}'
            )
            db.add(audit)
            db.commit()
            return True, f"Version #{version.version_number} was rejected with feedback.", execution

        return False, "Unknown action", None
