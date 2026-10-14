import pytest
from datetime import datetime, timezone, timedelta
from backend.app.security.guardrails import (
    validate_no_forbidden_sql, validate_table_allowlist,
    validate_columns_allowlist, DatabaseSecurityViolation
)
from backend.app.automation.approval_service import ApprovalService
from backend.app.models import ApprovalToken, AutomationExecution, ContentVersion
from backend.app.database import SessionLocal


def test_sec_01_forbidden_sql_verbs():
    forbidden_samples = [
        "DELETE FROM posts",
        "DROP TABLE users",
        "TRUNCATE posts",
        "ALTER TABLE posts ADD COLUMN evil VARCHAR(100)",
        "CREATE TABLE backdoor (id INT)",
        "GRANT ALL PRIVILEGES ON *.* TO evil@'%'",
        "REVOKE SELECT ON posts FROM user"
    ]
    for sample in forbidden_samples:
        with pytest.raises(DatabaseSecurityViolation) as exc_info:
            validate_no_forbidden_sql(sample)
        assert exc_info.value.code == "FORBIDDEN_SQL_OPERATION"


def test_sec_02_restricted_table_write_denied():
    restricted_tables = ["users", "payments", "auth_tokens", "user_passwords", "audit_logs"]
    for tbl in restricted_tables:
        with pytest.raises(DatabaseSecurityViolation) as exc_info:
            validate_table_allowlist(tbl, {tbl})
        assert exc_info.value.code == "RESTRICTED_TABLE_DENIED"


def test_sec_03_non_allowlisted_table_denied():
    with pytest.raises(DatabaseSecurityViolation) as exc_info:
        validate_table_allowlist("random_table", {"posts", "categories"})
    assert exc_info.value.code == "TABLE_NOT_ALLOWLISTED"


def test_sec_04_non_allowlisted_column_denied():
    allowlisted_cols = {"title", "content", "slug"}
    with pytest.raises(DatabaseSecurityViolation) as exc_info:
        validate_columns_allowlist(["title", "secret_column"], allowlisted_cols)
    assert exc_info.value.code == "COLUMN_NOT_ALLOWLISTED"


def test_sec_05_restricted_column_denied():
    allowlisted_cols = {"title", "password", "is_admin"}
    with pytest.raises(DatabaseSecurityViolation) as exc_info:
        validate_columns_allowlist(["password"], allowlisted_cols)
    assert exc_info.value.code == "RESTRICTED_COLUMN_DENIED"


def test_sec_06_approval_token_replay_protection():
    import uuid
    db = SessionLocal()
    try:
        # Create execution and version
        execution = AutomationExecution(
            automation_id=1,
            status="PENDING_APPROVAL",
            idempotency_key=f"test_replay_key_{uuid.uuid4().hex}"
        )
        db.add(execution)
        db.commit()
        db.refresh(execution)

        version = ContentVersion(
            execution_id=execution.id,
            automation_id=1,
            version_number=1,
            payload_json='{"title": "Test Post"}',
            status="PENDING_APPROVAL"
        )
        db.add(version)
        db.commit()
        db.refresh(version)

        # Issue tokens
        tokens = ApprovalService.issue_tokens_for_version(
            db=db,
            execution_id=execution.id,
            version_id=version.id
        )
        approve_token = tokens["approve_token"]

        # First consumption must succeed
        success, msg, exec_res = ApprovalService.consume_token_action(
            db=db,
            raw_token=approve_token,
            action="APPROVE"
        )
        assert success is True
        assert exec_res.status == "APPROVED"

        # Second consumption must FAIL (Single-use replay protection!)
        success_2, msg_2, _ = ApprovalService.consume_token_action(
            db=db,
            raw_token=approve_token,
            action="APPROVE"
        )
        assert success_2 is False
        assert "already been used" in msg_2

    finally:
        db.close()


def test_sec_07_expired_token_rejected():
    import uuid
    db = SessionLocal()
    try:
        execution = AutomationExecution(
            automation_id=1,
            status="PENDING_APPROVAL",
            idempotency_key=f"test_expired_key_{uuid.uuid4().hex}"
        )
        db.add(execution)
        db.commit()
        db.refresh(execution)

        version = ContentVersion(
            execution_id=execution.id,
            automation_id=1,
            version_number=1,
            payload_json='{"title": "Test Post"}',
            status="PENDING_APPROVAL"
        )
        db.add(version)
        db.commit()
        db.refresh(version)

        # Issue token that expired 1 hour ago
        from backend.app.security.encryption import generate_secure_token, hash_token
        raw_token = generate_secure_token()
        expired_token = ApprovalToken(
            token_hash=hash_token(raw_token),
            execution_id=execution.id,
            version_id=version.id,
            action="APPROVE",
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1)
        )
        db.add(expired_token)
        db.commit()

        success, msg, _ = ApprovalService.consume_token_action(
            db=db,
            raw_token=raw_token,
            action="APPROVE"
        )
        assert success is False
        assert "expired" in msg

    finally:
        db.close()

