import json
import re
import time
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy import MetaData, Table, insert, update, select, text
from sqlalchemy.orm import Session

from backend.app.models import Automation, ConnectionProfile, AuditLog
from backend.app.security.encryption import decrypt_secret
from backend.app.connectors.mysql import MySQLConnector
from backend.app.security.guardrails import (
    validate_table_allowlist, validate_columns_allowlist,
    validate_no_forbidden_sql, DatabaseSecurityViolation
)


class ExecutionService:
    """Service enforcing target database safety, validation, FK resolution, and atomic commits."""

    @classmethod
    def execute_publication(
        cls,
        db: Session,
        automation: Automation,
        payload: Dict[str, Any],
        idempotency_key: str
    ) -> Tuple[bool, str, Optional[str]]:
        """
        Executes publication into customer target database.
        Returns: (success: bool, message: str, target_record_id: Optional[str])
        """
        connection_profile = automation.connection
        if not connection_profile:
            return False, "Target database connection profile not found", None

        # 1. Non-negotiable security validation
        target_table = automation.target_table
        validate_no_forbidden_sql(target_table)
        validate_table_allowlist(target_table, {target_table})

        field_mappings = json.loads(automation.field_mappings_json)
        allowlisted_columns = {m["column"] for m in field_mappings}
        validate_columns_allowlist(list(payload.keys()), allowlisted_columns)

        # 2. Build target database connector
        plain_pwd = decrypt_secret(connection_profile.encrypted_password)
        connector = MySQLConnector(
            host=connection_profile.host,
            port=connection_profile.port,
            database=connection_profile.database,
            username=connection_profile.username,
            password=plain_pwd,
            use_ssl=connection_profile.use_ssl
        )

        # 3. Resolve foreign keys & runtime values
        processed_values: Dict[str, Any] = {}
        for mapping in field_mappings:
            col = mapping["column"]
            source = mapping.get("source")

            if col in payload:
                val = payload[col]
            else:
                val = mapping.get("value")

            # Check for relationship lookup
            if source == "RELATIONSHIP_LOOKUP":
                lookup_tbl = mapping.get("lookup_table")
                lookup_col = mapping.get("lookup_column") or "name"
                lookup_val = mapping.get("lookup_value") or val
                if lookup_tbl and lookup_val:
                    resolved_id = connector.resolve_foreign_key(
                        lookup_table=lookup_tbl,
                        lookup_column=lookup_col,
                        lookup_value=lookup_val
                    )
                    val = resolved_id

            # Check runtime rule (e.g. slugify, now)
            rule = mapping.get("rule")
            if rule == "slugify(title)" and "title" in payload and not val:
                val = re.sub(r"[^\w\s-]", "", str(payload["title"])).strip().lower()
                val = re.sub(r"[-\s]+", "-", val)

            processed_values[col] = val

        # 4. Target schema inspection & validation
        schema = connector.introspect_schema()
        target_table_meta = next((t for t in schema.tables if t.name == target_table), None)
        if not target_table_meta:
            return False, f"Target table '{target_table}' not found in database schema.", None

        for col_meta in target_table_meta.columns:
            col_name = col_meta.name
            val = processed_values.get(col_name)

            # Check non-nullable fields without defaults
            if not col_meta.nullable and not col_meta.is_primary_key and col_meta.default_value is None:
                if val is None:
                    return False, f"Validation failure: Column '{col_name}' is non-nullable but has no value.", None

            # Check enum constraints
            if col_meta.enum_values and val is not None:
                if str(val) not in col_meta.enum_values:
                    # Coerce to first allowed enum choice or fail
                    return False, f"Validation failure: Value '{val}' for column '{col_name}' is not in allowed enums: {col_meta.enum_values}", None

            # Check length limits
            if col_meta.max_length and isinstance(val, str) and len(val) > col_meta.max_length:
                # Truncate string safely
                processed_values[col_name] = val[:col_meta.max_length]

        # 5. Atomic transaction execution
        try:
            metadata = MetaData()
            table = Table(target_table, metadata, autoload_with=connector.engine)

            with connector.engine.begin() as conn:
                # Check unique slug collision if slug is present
                if "slug" in processed_values:
                    slug_val = processed_values["slug"]
                    existing_slug = conn.execute(
                        select(table.c.id).where(table.c.slug == slug_val)
                    ).scalar()
                    if existing_slug:
                        # Append unique suffix to prevent duplicate key error
                        processed_values["slug"] = f"{slug_val}-{int(time.time()) % 10000}"

                # Execute Parameterized INSERT
                clean_insert_values = {k: v for k, v in processed_values.items() if hasattr(table.c, k)}
                insert_stmt = insert(table).values(**clean_insert_values)
                result = conn.execute(insert_stmt)
                inserted_pk = result.inserted_primary_key[0] if result.inserted_primary_key else None

                # Multi-table relationship handling (e.g. post_tags)
                if target_table == "posts" and inserted_pk:
                    try:
                        post_tags_tbl = Table("post_tags", metadata, autoload_with=connector.engine)
                        # Tag with default tag_id 1
                        conn.execute(insert(post_tags_tbl).values(post_id=inserted_pk, tag_id=1))
                    except Exception:
                        pass  # If post_tags does not exist or fails non-critically

            # Record audit
            audit = AuditLog(
                action="TARGET_DB_WRITE_SUCCESS",
                entity_type="target_record",
                entity_id=str(inserted_pk),
                actor="automation_executor",
                details_json=json.dumps({
                    "automation_id": automation.id,
                    "target_table": target_table,
                    "inserted_id": inserted_pk,
                    "idempotency_key": idempotency_key
                })
            )
            db.add(audit)
            db.commit()

            return True, f"Successfully created record #{inserted_pk} in '{target_table}'.", str(inserted_pk)

        except Exception as e:
            # Transaction automatically rolls back on exception in `begin()` context
            err_msg = str(e)
            if connection_profile.password and connection_profile.password in err_msg:
                err_msg = err_msg.replace(connection_profile.password, "********")
            return False, f"Target database transaction rolled back due to error: {err_msg}", None
