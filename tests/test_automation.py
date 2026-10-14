import json
import pytest
from backend.app.automation.engine import AutomationEngine
from backend.app.automation.approval_service import ApprovalService
from backend.app.models import Automation, ConnectionProfile, ContentVersion, AutomationExecution
from backend.app.database import SessionLocal


def test_aut_01_full_blog_publishing_journey(client):
    # 1. Seed demo connection & automation
    conn_res = client.post("/api/v1/connections/seed-demo")
    assert conn_res.status_code == 200
    conn_id = conn_res.json()["id"]

    auto_res = client.post("/api/v1/automations/seed-demo")
    assert auto_res.status_code == 200
    auto_id = auto_res.json()["id"]

    # 2. Trigger generation
    trig_res = client.post(f"/api/v1/automations/{auto_id}/trigger")
    assert trig_res.status_code == 200
    exec_id = trig_res.json()["execution_id"]

    # 3. Verify execution status is PENDING_APPROVAL
    exec_res = client.get(f"/api/v1/executions/{exec_id}")
    assert exec_res.status_code == 200
    exec_data = exec_res.json()
    assert exec_data["status"] == "PENDING_APPROVAL"
    assert exec_data["current_version"] is not None
    assert "title" in exec_data["current_version"]["payload"]

    # 4. Lookup approval token from database to simulate user clicking email link
    db = SessionLocal()
    try:
        from backend.app.models import ApprovalToken
        tokens = db.query(ApprovalToken).filter(
            ApprovalToken.execution_id == exec_id,
            ApprovalToken.action == "APPROVE",
            ApprovalToken.used_at == None
        ).all()
        assert len(tokens) >= 1

        # Check preview GET endpoint (safe read-only)
        # Note: tokens in DB are hashed; we test approval via ApprovalService or approval endpoint
        # Let's generate a fresh test token to test the approval API endpoint
        raw_tokens = ApprovalService.issue_tokens_for_version(
            db=db,
            execution_id=exec_id,
            version_id=exec_data["current_version"]["id"]
        )
        approve_token = raw_tokens["approve_token"]

        # GET /api/v1/approvals/{token} (Read-only preview)
        prev_res = client.get(f"/api/v1/approvals/{approve_token}")
        assert prev_res.status_code == 200
        assert prev_res.json()["valid"] is True
        assert prev_res.json()["action"] == "APPROVE"

        # POST /api/v1/approvals/{token}/action
        action_res = client.post(
            f"/api/v1/approvals/{approve_token}/action",
            json={"action": "APPROVE"}
        )
        assert action_res.status_code == 200
        assert action_res.json()["status"] == "APPROVED"

        # 5. Execute publication to synthetic MySQL database
        pub_res = client.post(f"/api/v1/executions/{exec_id}/publish-now")
        assert pub_res.status_code == 200
        assert pub_res.json()["success"] is True

        # Verify status is now PUBLISHED
        exec_after = client.get(f"/api/v1/executions/{exec_id}").json()
        assert exec_after["status"] == "PUBLISHED"
        assert exec_after["target_record_id"] is not None

    finally:
        db.close()


def test_aut_02_rejection_and_regeneration(client):
    auto_res = client.post("/api/v1/automations/seed-demo")
    auto_id = auto_res.json()["id"]

    trig_res = client.post(f"/api/v1/automations/{auto_id}/trigger")
    exec_id = trig_res.json()["execution_id"]

    db = SessionLocal()
    try:
        exec_data = client.get(f"/api/v1/executions/{exec_id}").json()
        raw_tokens = ApprovalService.issue_tokens_for_version(
            db=db,
            execution_id=exec_id,
            version_id=exec_data["current_version"]["id"]
        )
        reject_token = raw_tokens["reject_token"]

        # Reject with feedback
        reject_res = client.post(
            f"/api/v1/approvals/{reject_token}/action",
            json={
                "action": "REJECT",
                "feedback": "Make the title more punchy and emphasize ACID transactions."
            }
        )
        assert reject_res.status_code == 200
        data = reject_res.json()
        assert data["success"] is True

        # Verify new regenerated version exists
        exec_updated = client.get(f"/api/v1/executions/{exec_id}").json()
        assert exec_updated["regeneration_count"] >= 1
        assert "(Revised Edition)" in exec_updated["current_version"]["payload"]["title"]

    finally:
        db.close()


def test_aut_03_manual_content_scheduling_without_ai(client):
    auto_res = client.post("/api/v1/automations/seed-demo")
    auto_id = auto_res.json()["id"]

    # Schedule manual post directly
    manual_payload = {
        "title": "Pure Manual Editorial Publication",
        "slug": f"pure-manual-editorial-{id(auto_id)}",
        "excerpt": "This content was authored manually without calling any AI models.",
        "content": "# Pure Manual Article\n\nAuthored completely by human editor.",
        "status": "published",
        "category_id": 1,
        "author_id": 1
    }

    sched_res = client.post(
        "/api/v1/executions/manual",
        json={
            "automation_id": auto_id,
            "payload": manual_payload
        }
    )
    assert sched_res.status_code == 200
    manual_exec = sched_res.json()
    assert manual_exec["mode"] == "MANUAL"
    assert manual_exec["status"] == "APPROVED"

    # Publish to MySQL
    pub_res = client.post(f"/api/v1/executions/{manual_exec['id']}/publish-now")
    assert pub_res.status_code == 200
    assert pub_res.json()["success"] is True
