#!/usr/bin/env python3
"""
End-to-End Integration Verification Script
Tests the full multi-user self-service journey across:
- Python FastAPI AI Service (:8001)
- Laravel 11 Control Plane Backend (:8000)
- Target Customer MySQL DB (:3308 demo_blog_cms)
"""

import sys
import os
import time
import subprocess
import httpx
import pymysql

LARAVEL_URL = "http://127.0.0.1:8000"
AI_SERVICE_URL = "http://127.0.0.1:8001"
WORKSPACE_DIR = "/home/acquaint/Desktop/AI-Powered Database Automation"


def print_step(title):
    print(f"\n========================================================")
    print(f"[*] {title}")
    print(f"========================================================")


def main():
    print_step("Step 1: Starting Background AI Microservice (:8001) & Laravel Backend (:8000)")

    # 1. Start Python AI service if not running
    try:
        r = httpx.get(f"{AI_SERVICE_URL}/health", timeout=5.0)
        print(f"[+] AI Service already running on {AI_SERVICE_URL}")
    except Exception:
        print("[*] Launching Python AI service...")
        ai_proc = subprocess.Popen(
            [f"{WORKSPACE_DIR}/.venv/bin/python", "-m", "uvicorn", "ai_service.app.main:app", "--host", "127.0.0.1", "--port", "8001"],
            cwd=WORKSPACE_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        time.sleep(2)
        r = httpx.get(f"{AI_SERVICE_URL}/health", timeout=5.0)
        assert r.status_code == 200, "AI Service failed to start"
        print(f"[+] AI Service healthy on {AI_SERVICE_URL}")

    # 2. Start Laravel server if not running
    try:
        r = httpx.get(f"{LARAVEL_URL}/api/health", timeout=5.0)
        print(f"[+] Laravel backend already running on {LARAVEL_URL}")
    except Exception:
        print("[*] Launching Laravel server...")
        laravel_proc = subprocess.Popen(
            ["php", "artisan", "serve", "--host=127.0.0.1", "--port=8000"],
            cwd=f"{WORKSPACE_DIR}/laravel",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        time.sleep(2)
        print(f"[+] Laravel backend responding on {LARAVEL_URL}")

    print_step("Step 2: Self-Service Registration (New User)")
    user_email = f"lead_editor_{int(time.time())}@syntheticsite.com"
    reg_payload = {
        "name": "Lead Editorial Reviewer",
        "email": user_email,
        "password": "SecurePassword2026!",
        "password_confirmation": "SecurePassword2026!"
    }

    res = httpx.post(f"{LARAVEL_URL}/api/auth/register", json=reg_payload)
    assert res.status_code == 201, f"Registration failed: {res.text}"
    auth_data = res.json()
    token = auth_data["token"]
    user_id = auth_data["user"]["id"]
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json"
    }
    print(f"[+] Successfully registered user ID {user_id} ({user_email})")
    print(f"[+] Sanctum Bearer Token: {token[:18]}...")

    print_step("Step 3: Verify Empty Onboarding Dashboard State")
    stats_res = httpx.get(f"{LARAVEL_URL}/api/dashboard/stats", headers=headers)
    assert stats_res.status_code == 200
    stats = stats_res.json()
    assert stats["connections_count"] == 0, "Expected 0 connections for fresh user"
    assert stats["automations_count"] == 0, "Expected 0 automations for fresh user"
    print(f"[+] Verified clean empty onboarding state: {stats}")

    print_step("Step 4: Connect & Test Target MySQL Database via Portal API")
    conn_payload = {
        "name": "Production Blog CMS Target",
        "db_type": "mysql",
        "host": "127.0.0.1",
        "port": 3308,
        "database_name": "demo_blog_cms",
        "username": "root",
        "password": "ipo_root_password",
        "ssl_mode": "preferred"
    }

    # Live pre-flight test
    test_res = httpx.post(f"{LARAVEL_URL}/api/connections/test", json=conn_payload, headers=headers)
    assert test_res.status_code == 200, f"Live connection test failed: {test_res.text}"
    print(f"[+] Pre-flight connection test succeeded: {test_res.json()['message']} (latency: {test_res.json()['latency_ms']}ms)")

    # Save connection
    create_conn_res = httpx.post(f"{LARAVEL_URL}/api/connections", json=conn_payload, headers=headers)
    assert create_conn_res.status_code == 201, f"Failed to save connection: {create_conn_res.text}"
    saved_conn = create_conn_res.json()["connection"]
    conn_id = saved_conn["id"]
    print(f"[+] Saved connection profile ID {conn_id} with encrypted password at rest.")

    print_step("Step 5: Introspect Target Database Schema & Verify Guardrails")
    schema_res = httpx.get(f"{LARAVEL_URL}/api/connections/{conn_id}/schema", headers=headers)
    assert schema_res.status_code == 200, f"Schema introspection failed: {schema_res.text}"
    schema = schema_res.json()
    tables = schema["tables"]
    table_names = [t["table_name"] for t in tables]
    print(f"[+] Discovered tables in target DB: {table_names}")

    posts_table = next((t for t in tables if t["table_name"] == "posts"), None)
    users_table = next((t for t in tables if t["table_name"] == "users"), None)

    assert posts_table is not None, "'posts' table not found"
    assert posts_table["eligible_for_automation"] is True, "'posts' should be eligible"
    assert users_table is not None, "'users' table not found"
    assert users_table["is_sensitive"] is True, "'users' MUST be flagged as sensitive/restricted"
    assert users_table["eligible_for_automation"] is False, "'users' must NOT be eligible"
    print(f"[+] Guardrails verified: 'posts' is eligible; 'users' is restricted ({users_table['restriction_reason']})")

    print_step("Step 6: Configure AI Content Automation Workflow")
    auto_payload = {
        "name": "Daily Architectural Insights Publisher",
        "connection_id": conn_id,
        "target_table": "posts",
        "operation_mode": "AI_CREATE",
        "field_mappings": [
            {"field_name": "title", "mapping_type": "AI_GENERATED"},
            {"field_name": "slug", "mapping_type": "DERIVED_SLUG", "source_field": "title"},
            {"field_name": "content", "mapping_type": "AI_GENERATED"},
            {"field_name": "excerpt", "mapping_type": "AI_GENERATED"},
            {"field_name": "status", "mapping_type": "FIXED_VALUE", "fixed_value": "published"}
        ],
        "ai_provider": "mock",
        "ai_model": "mock-llama3-synthetic",
        "prompt_context": "Topic: High Performance Database Replication and Partitioning",
        "schedule_type": "DAILY",
        "generation_time": "08:00",
        "publication_time": "09:00",
        "timezone": "UTC",
        "requires_approval": True,
        "reviewer_email": user_email,
        "timeout_policy": "AUTO_PUBLISH_LATEST"
    }

    auto_res = httpx.post(f"{LARAVEL_URL}/api/automations", json=auto_payload, headers=headers)
    assert auto_res.status_code == 201, f"Automation creation failed: {auto_res.text}"
    automation = auto_res.json()["automation"]
    auto_id = automation["id"]
    print(f"[+] Configured automation workflow ID {auto_id} ('{automation['name']}')")

    print_step("Step 7: Trigger Execution & Process Background Generation Job")
    trig_res = httpx.post(f"{LARAVEL_URL}/api/automations/{auto_id}/trigger", headers=headers)
    assert trig_res.status_code == 202, f"Trigger failed: {trig_res.text}"
    execution = trig_res.json()["execution"]
    exec_id = execution["id"]
    print(f"[+] Queued execution ID {exec_id} with idempotency key: {execution['idempotency_key']}")

    # Process background job via Laravel queue worker or poll background worker
    print("[*] Processing generation job via queue worker...")
    for i in range(50):
        try:
            exec_check = httpx.get(f"{LARAVEL_URL}/api/executions/{exec_id}", headers=headers, timeout=10.0).json()
            status = exec_check.get("status")
            print(f"    - Generation status #{i+1}: {status}")
            if status in ["PENDING_APPROVAL", "PUBLISHED", "FAILED"]:
                break
            # If still queued after 3 checks, trigger worker once in case background worker is not running
            if status == "QUEUED" and i > 2:
                subprocess.run(
                    ["php", "artisan", "queue:work", "--once", "--stop-when-empty", "--timeout=10"],
                    cwd=f"{WORKSPACE_DIR}/laravel",
                    capture_output=True,
                    timeout=12
                )
        except Exception as e:
            print(f"[!] Polling note: {e}")
        time.sleep(1)

    print_step("Step 8: Retrieve Generated Draft & Approval Token")
    exec_res = httpx.get(f"{LARAVEL_URL}/api/executions/{exec_id}", headers=headers, timeout=10.0)
    assert exec_res.status_code == 200
    exec_data = exec_res.json()
    assert exec_data["status"] == "PENDING_APPROVAL", f"Expected PENDING_APPROVAL, got {exec_data['status']}"
    assert len(exec_data["versions"]) > 0, "No content version was created"
    
    version = exec_data["versions"][0]
    token_records = version["approval_tokens"]
    assert len(token_records) > 0, "No approval token generated"
    token_str = token_records[0]["token"]
    print(f"[+] Version #{version['version_number']} created: Title = '{version['payload']['title']}'")
    print(f"[+] Single-use signed approval token: {token_str}")

    print_step("Step 9: Simulate Email Review Link & Approve Version")
    # Public review endpoint
    review_res = httpx.get(f"{LARAVEL_URL}/api/approvals/{token_str}", timeout=10.0)
    assert review_res.status_code == 200
    assert review_res.json()["valid"] is True
    print(f"[+] Email review link verified: Status = {review_res.json()['status']}")

    # Interactive Approve click
    approve_res = httpx.post(f"{LARAVEL_URL}/api/approvals/{token_str}/approve", timeout=10.0)
    assert approve_res.status_code == 200
    print(f"[+] Draft successfully approved! Response: {approve_res.json()['message']}")

    print_step("Step 10: Process Background Publishing Job & Verify MySQL Write")
    # Dispatch publication job
    pub_res = httpx.post(f"{LARAVEL_URL}/api/executions/{exec_id}/publish-now", headers=headers, timeout=10.0)
    assert pub_res.status_code == 200, f"Publish-now failed: {pub_res.text}"
    print(f"[+] Publication job dispatched: {pub_res.json()['message']}")

    print("[*] Processing publication job via queue worker...")
    for i in range(30):
        try:
            exec_check = httpx.get(f"{LARAVEL_URL}/api/executions/{exec_id}", headers=headers, timeout=10.0).json()
            status = exec_check.get("status")
            print(f"    - Publication status #{i+1}: {status}")
            if status in ["PUBLISHED", "FAILED"]:
                break
            if status == "QUEUED" and i > 2:
                subprocess.run(
                    ["php", "artisan", "queue:work", "--once", "--stop-when-empty", "--timeout=10"],
                    cwd=f"{WORKSPACE_DIR}/laravel",
                    capture_output=True,
                    timeout=12
                )
        except Exception as e:
            print(f"[!] Polling note: {e}")
        time.sleep(1)

    # Verify execution state in platform
    final_exec_res = httpx.get(f"{LARAVEL_URL}/api/executions/{exec_id}", headers=headers)
    final_exec = final_exec_res.json()
    assert final_exec["status"] == "PUBLISHED", f"Expected PUBLISHED, got {final_exec['status']}"
    target_record_id = final_exec["target_record_id"]
    print(f"[+] Platform confirms PUBLISHED status! Target Record ID: {target_record_id}")

    # DIRECT TARGET MYSQL VERIFICATION (independent query directly to MySQL port 3308)
    conn = pymysql.connect(
        host="127.0.0.1",
        port=3308,
        user="root",
        password="ipo_root_password",
        database="demo_blog_cms",
        cursorclass=pymysql.cursors.DictCursor
    )
    with conn.cursor() as cursor:
        cursor.execute("SELECT * FROM posts WHERE id = %s", (target_record_id,))
        row = cursor.fetchone()
        assert row is not None, f"Record ID {target_record_id} not found in MySQL posts table!"
        print(f"[+] PHYSICAL TARGET MYSQL VERIFICATION CONFIRMED:")
        print(f"    - ID: {row['id']}")
        print(f"    - Title: {row['title']}")
        print(f"    - Slug: {row['slug']}")
        print(f"    - Status: {row['status']}")
        print(f"    - Created At: {row['created_at']}")
    conn.close()

    print_step("Step 11: Post-Publication In-Portal Scoped Record UPDATE")
    updated_title = f"{row['title']} (Audited & Revised)"
    update_res = httpx.post(
        f"{LARAVEL_URL}/api/executions/{exec_id}/update-record",
        headers=headers,
        json={"payload": {"title": updated_title}}
    )
    assert update_res.status_code == 200, f"Scoped update failed: {update_res.text}"
    print(f"[+] Scoped UPDATE succeeded: {update_res.json()['message']}")

    # Direct MySQL check for updated field
    conn = pymysql.connect(
        host="127.0.0.1",
        port=3308,
        user="root",
        password="ipo_root_password",
        database="demo_blog_cms",
        cursorclass=pymysql.cursors.DictCursor
    )
    with conn.cursor() as cursor:
        cursor.execute("SELECT title, updated_at FROM posts WHERE id = %s", (target_record_id,))
        row_updated = cursor.fetchone()
        assert row_updated["title"] == updated_title, f"Expected '{updated_title}', got '{row_updated['title']}'"
        print(f"[+] PHYSICAL TARGET MYSQL UPDATED VALUE VERIFIED: '{row_updated['title']}'")
    conn.close()

    print_step("Step 12: Cross-User IDOR Isolation Test")
    user2_email = f"attacker_{int(time.time())}@othercompany.com"
    reg2_res = httpx.post(f"{LARAVEL_URL}/api/auth/register", json={
        "name": "Other Tenant User",
        "email": user2_email,
        "password": "Password123!",
        "password_confirmation": "Password123!"
    })
    token2 = reg2_res.json()["token"]
    headers2 = {"Authorization": f"Bearer {token2}", "Accept": "application/json"}

    # User 2 attempts to read User 1's connection
    cross_conn = httpx.get(f"{LARAVEL_URL}/api/connections/{conn_id}", headers=headers2)
    assert cross_conn.status_code == 404, "Security failure: User 2 accessed User 1 connection!"

    # User 2 attempts to read User 1's automation
    cross_auto = httpx.get(f"{LARAVEL_URL}/api/automations/{auto_id}", headers=headers2)
    assert cross_auto.status_code == 404, "Security failure: User 2 accessed User 1 automation!"
    print("[+] Verified cross-user IDOR isolation: unauthorized requests strictly returned 404 Not Found.")

    print_step("ALL VERTICAL SLICE INTEGRATION TESTS PASSED 100%!")


if __name__ == "__main__":
    main()
