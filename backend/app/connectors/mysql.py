import time
import re
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Set
from sqlalchemy import (
    create_engine, text, MetaData, Table, insert, update, select
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from backend.app.connectors.base import BaseDatabaseConnector
from backend.app.schemas.connection import (
    SchemaResponse, SchemaTable, SchemaColumn, SchemaRelationship, ConnectionTestResponse
)
from backend.app.security.guardrails import (
    validate_no_forbidden_sql, classify_table_sensitivity,
    validate_table_allowlist, validate_columns_allowlist, DatabaseSecurityViolation
)


class MySQLConnector(BaseDatabaseConnector):
    """MySQL 8.0 target connector with read-only introspection and bounded execution."""

    def __init__(self, host: str, port: int, database: str, username: str, password: str, use_ssl: bool = False):
        self.host = host
        self.port = port
        self.database = database
        self.username = username
        self.password = password
        self.use_ssl = use_ssl

        # Construct SQLAlchemy engine
        connect_args = {
            "charset": "utf8mb4",
            "connect_timeout": 5
        }
        if use_ssl:
            connect_args["ssl"] = {"check_hostname": False}

        # Safe URL encoding
        import urllib.parse
        encoded_user = urllib.parse.quote_plus(self.username)
        encoded_password = urllib.parse.quote_plus(self.password)
        self.connection_url = f"mysql+pymysql://{encoded_user}:{encoded_password}@{self.host}:{self.port}/{self.database}"

        self.engine: Engine = create_engine(
            self.connection_url,
            connect_args=connect_args,
            pool_pre_ping=True,
            pool_recycle=3600
        )

    def test_connection(self) -> ConnectionTestResponse:
        start_time = time.time()
        try:
            with self.engine.connect() as conn:
                result = conn.execute(text("SELECT VERSION()")).scalar()
                latency_ms = round((time.time() - start_time) * 1000, 2)
                return ConnectionTestResponse(
                    success=True,
                    message=f"Connected successfully to MySQL server.",
                    latency_ms=latency_ms,
                    server_version=str(result)
                )
        except Exception as e:
            latency_ms = round((time.time() - start_time) * 1000, 2)
            # Sanitize error to prevent password leakage
            clean_error = str(e)
            if self.password and self.password in clean_error:
                clean_error = clean_error.replace(self.password, "********")
            return ConnectionTestResponse(
                success=False,
                message=f"Connection failed: {clean_error}",
                latency_ms=latency_ms
            )

    def introspect_schema(self, connection_id: int = 1) -> SchemaResponse:
        """Read-only schema metadata discovery using MySQL information_schema."""
        tables_map: Dict[str, SchemaTable] = {}

        try:
            with self.engine.connect() as conn:
                # 1. Fetch tables
                tables_query = text("""
                    SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = :db_name AND TABLE_TYPE = 'BASE TABLE'
                    ORDER BY TABLE_NAME
                """)
                for row in conn.execute(tables_query, {"db_name": self.database}):
                    tbl_name = row[0]
                    category, reason = classify_table_sensitivity(tbl_name)
                    tables_map[tbl_name] = SchemaTable(
                        name=tbl_name,
                        category=category,
                        restriction_reason=reason,
                        row_count_estimate=row[1] if row[1] is not None else 0,
                        columns=[],
                        relationships=[]
                    )

                # 2. Fetch columns
                cols_query = text("""
                    SELECT 
                        TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, 
                        COLUMN_KEY, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH, 
                        COLUMN_TYPE
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = :db_name
                    ORDER BY TABLE_NAME, ORDINAL_POSITION
                """)
                for row in conn.execute(cols_query, {"db_name": self.database}):
                    tbl_name = row[0]
                    col_name = row[1]
                    data_type = row[2]
                    is_nullable = (row[3] == "YES")
                    col_key = row[4]
                    default_val = str(row[5]) if row[5] is not None else None
                    max_len = row[6]
                    col_type = row[7]

                    # Parse enums if present
                    enum_vals = None
                    if data_type.lower() == "enum" and col_type:
                        enum_match = re.findall(r"'([^']*)'", col_type)
                        if enum_match:
                            enum_vals = enum_match

                    if tbl_name in tables_map:
                        tables_map[tbl_name].columns.append(
                            SchemaColumn(
                                name=col_name,
                                data_type=data_type,
                                nullable=is_nullable,
                                is_primary_key=(col_key == "PRI"),
                                is_foreign_key=False,  # Will be updated in relationships step
                                default_value=default_val,
                                max_length=max_len,
                                enum_values=enum_vals,
                                is_unique=(col_key == "UNI" or col_key == "PRI")
                            )
                        )

                # 3. Fetch foreign keys & relationships
                fk_query = text("""
                    SELECT 
                        TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                    FROM information_schema.KEY_COLUMN_USAGE
                    WHERE TABLE_SCHEMA = :db_name 
                      AND REFERENCED_TABLE_NAME IS NOT NULL
                """)
                for row in conn.execute(fk_query, {"db_name": self.database}):
                    tbl_name = row[0]
                    col_name = row[1]
                    ref_tbl = row[2]
                    ref_col = row[3]

                    if tbl_name in tables_map:
                        tables_map[tbl_name].relationships.append(
                            SchemaRelationship(
                                constrained_column=col_name,
                                referenced_table=ref_tbl,
                                referenced_column=ref_col
                            )
                        )
                        # Mark column as FK
                        for col in tables_map[tbl_name].columns:
                            if col.name == col_name:
                                col.is_foreign_key = True

            return SchemaResponse(
                connection_id=connection_id,
                database_name=self.database,
                tables=list(tables_map.values()),
                scanned_at=datetime.now(timezone.utc)
            )
        except Exception as e:
            raise DatabaseSecurityViolation(f"Schema introspection failed: {str(e)}")

    def resolve_foreign_key(
        self,
        lookup_table: str,
        lookup_column: str,
        lookup_value: Any,
        target_column: str = "id"
    ) -> Optional[Any]:
        # Validate table and column names to prevent SQL injection in metadata identifiers
        validate_no_forbidden_sql(lookup_table)
        validate_no_forbidden_sql(lookup_column)
        validate_no_forbidden_sql(target_column)

        if not re.match(r"^[a-zA-Z0-9_]+$", lookup_table) or not re.match(r"^[a-zA-Z0-9_]+$", lookup_column):
            raise DatabaseSecurityViolation("Invalid identifier in foreign key lookup.")

        query = text(f"SELECT `{target_column}` FROM `{lookup_table}` WHERE `{lookup_column}` = :val LIMIT 1")
        with self.engine.connect() as conn:
            result = conn.execute(query, {"val": lookup_value}).scalar()
            return result

    def execute_insert(
        self,
        table_name: str,
        column_values: Dict[str, Any],
        allowlisted_columns: List[str]
    ) -> Any:
        """Safely execute parameterized INSERT into allowlisted table."""
        validate_table_allowlist(table_name, {table_name})
        validate_columns_allowlist(list(column_values.keys()), set(allowlisted_columns))

        metadata = MetaData()
        table = Table(table_name, metadata, autoload_with=self.engine)
        stmt = insert(table).values(**column_values)

        with self.engine.begin() as conn:
            result = conn.execute(stmt)
            return result.inserted_primary_key[0] if result.inserted_primary_key else None

    def execute_update(
        self,
        table_name: str,
        primary_key_column: str,
        primary_key_value: Any,
        column_values: Dict[str, Any],
        allowlisted_columns: List[str]
    ) -> int:
        """Safely execute parameterized UPDATE on identified record."""
        if primary_key_value is None:
            raise DatabaseSecurityViolation("Accidental mass update prevented: Primary key value is required.")

        validate_table_allowlist(table_name, {table_name})
        validate_columns_allowlist(list(column_values.keys()), set(allowlisted_columns))

        metadata = MetaData()
        table = Table(table_name, metadata, autoload_with=self.engine)
        pk_col = getattr(table.c, primary_key_column)
        stmt = update(table).where(pk_col == primary_key_value).values(**column_values)

        with self.engine.begin() as conn:
            result = conn.execute(stmt)
            if result.rowcount == 0:
                raise DatabaseSecurityViolation(f"Update targeted 0 rows for {primary_key_column}={primary_key_value}")
            return result.rowcount
