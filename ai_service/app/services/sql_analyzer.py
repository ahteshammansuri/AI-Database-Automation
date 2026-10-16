"""
SqlAnalyzer: AST parser gate for read-only SQL execution (ADR-010).
Uses sqlglot to strictly validate AST, enforce single-statement SELECT, block
dangerous functions, detect locking clauses, extract table/column lineage,
and verify LIMIT constraints.
"""
import re
from typing import Any, Dict, List, Optional, Set
import sqlglot
from sqlglot import exp


DANGEROUS_FUNCTIONS: Dict[str, Set[str]] = {
    "mysql": {
        "sleep", "benchmark", "load_file", "sys_eval", "sys_exec", "export_set",
        "into_outfile", "into_dumpfile"
    },
    "postgres": {
        "pg_sleep", "pg_read_file", "pg_write_file", "pg_ls_dir", "lo_import",
        "lo_export", "dblink", "dblink_exec", "query_to_xml", "query_to_xml_and_xmlschema",
        "copy"
    },
}

FORBIDDEN_EXPRESSION_TYPES = (
    exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Drop, exp.Alter,
    exp.TruncateTable, exp.Command
)


class SqlAnalysisResult:
    def __init__(
        self,
        is_valid: bool,
        dialect: str,
        statement_type: str,
        tables: List[str],
        columns: List[str],
        functions: List[str],
        has_limit: bool,
        limit_value: Optional[int],
        errors: List[str],
        normalized_sql: Optional[str] = None
    ):
        self.is_valid = is_valid
        self.dialect = dialect
        self.statement_type = statement_type
        self.tables = tables
        self.columns = columns
        self.functions = functions
        self.has_limit = has_limit
        self.limit_value = limit_value
        self.errors = errors
        self.normalized_sql = normalized_sql

    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.is_valid,
            "dialect": self.dialect,
            "statement_type": self.statement_type,
            "tables": self.tables,
            "columns": self.columns,
            "functions": self.functions,
            "has_limit": self.has_limit,
            "limit_value": self.limit_value,
            "errors": self.errors,
            "normalized_sql": self.normalized_sql,
        }


def analyze_sql(raw_sql: str, dialect: str = "mysql", max_limit: int = 500) -> SqlAnalysisResult:
    errors: List[str] = []
    d = "postgres" if dialect in ("postgres", "postgresql", "pgsql") else "mysql"

    cleaned = raw_sql.strip().rstrip(";")
    if not cleaned:
        return SqlAnalysisResult(False, d, "empty", [], [], [], False, None, ["Empty SQL statement."])

    # 1. Parse all statements to detect multi-statement SQL
    try:
        statements = sqlglot.parse(cleaned, read=d)
    except Exception as e:
        return SqlAnalysisResult(False, d, "parse_error", [], [], [], False, None, [f"SQL syntax error: {str(e)}"])

    if len(statements) != 1:
        return SqlAnalysisResult(
            False, d, "multi_statement", [], [], [], False, None,
            [f"Multi-statement SQL is strictly prohibited (found {len(statements)} statements)."]
        )

    tree = statements[0]
    if not tree:
        return SqlAnalysisResult(False, d, "empty", [], [], [], False, None, ["No valid AST produced."])

    # 2. Check for forbidden expression types
    for node in tree.walk():
        if isinstance(node, FORBIDDEN_EXPRESSION_TYPES):
            errors.append(f"Forbidden operation: {type(node).__name__}. Only SELECT queries are permitted.")
            break

    # 3. Must be a Select or Union
    is_select = isinstance(tree, (exp.Select, exp.Union))
    if not is_select:
        errors.append(f"Statement must be a SELECT query (got {type(tree).__name__}).")

    # 4. Check for SELECT ... INTO (table creation via select)
    if tree.find(exp.Into):
        errors.append("SELECT INTO is prohibited.")

    # 5. Check for locking clauses (FOR UPDATE, LOCK IN SHARE MODE)
    if tree.find(exp.Lock):
        errors.append("Locking clauses (FOR UPDATE / SHARE) are prohibited.")

    # 6. Extract CTE names to exclude them from real table references
    cte_names: Set[str] = set()
    with_exp = tree.args.get("with")
    if with_exp:
        for cte in with_exp.expressions:
            if hasattr(cte, "alias") and cte.alias:
                cte_names.add(cte.alias.lower())

    # 7. Extract real table names
    tables: List[str] = []
    for t in tree.find_all(exp.Table):
        t_name = t.name
        if t_name and t_name.lower() not in cte_names and t_name not in tables:
            tables.append(t_name)

    # 8. Extract column names
    columns: List[str] = []
    for c in tree.find_all(exp.Column):
        c_name = c.name
        if c_name and c_name != "*" and c_name not in columns:
            columns.append(c_name)

    # 9. Extract and check functions
    functions: List[str] = []
    dangerous = DANGEROUS_FUNCTIONS.get(d, set())
    for f in tree.find_all(exp.Func):
        fname = getattr(f, "name", None) or type(f).__name__
        fname_lower = fname.lower()
        if fname_lower not in functions:
            functions.append(fname_lower)
        if fname_lower in dangerous:
            errors.append(f"Dangerous function prohibited by security policy: {fname}()")

    # 10. Check LIMIT clause
    limit_exp = tree.args.get("limit")
    has_limit = limit_exp is not None
    limit_val: Optional[int] = None

    if limit_exp and hasattr(limit_exp, "expression"):
        try:
            limit_val = int(limit_exp.expression.name)
            if limit_val > max_limit:
                errors.append(f"LIMIT value {limit_val} exceeds maximum allowed ({max_limit}).")
        except (ValueError, AttributeError):
            errors.append("Non-constant or complex LIMIT clause detected.")

    normalized: Optional[str] = None
    if not errors:
        try:
            normalized = tree.sql(dialect=d)
        except Exception:
            normalized = cleaned

    is_valid = len(errors) == 0
    return SqlAnalysisResult(
        is_valid=is_valid,
        dialect=d,
        statement_type="select" if is_select else type(tree).__name__.lower(),
        tables=tables,
        columns=columns,
        functions=functions,
        has_limit=has_limit,
        limit_value=limit_val,
        errors=errors,
        normalized_sql=normalized
    )
