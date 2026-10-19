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


# ---------------------------------------------------------------------------
# Validated read gate for model-written SELECT (AGENTS.md: AST parse, single statement,
# allow-listed tables and functions, forced LIMIT; the caller runs it read-only with a timeout).
# ---------------------------------------------------------------------------

# sqlglot function keys that are safe in a read-only query (aggregates, conditionals, string,
# date and math). Anything else is refused.
ALLOWED_FUNCTIONS: Set[str] = {
    "and", "or", "not", "xor", "exists",
    "count", "sum", "avg", "min", "max", "groupconcat", "anyvalue", "stddev", "stddevpop", "stddevsamp",
    "variance", "variancepop", "countif",
    "case", "if", "coalesce", "nullif", "greatest", "least", "cast", "trycast",
    "concat", "concatws", "lower", "upper", "length", "substring", "trim", "replace", "left", "right", "pad",
    "strposition", "numbertostr", "initcap", "reverse", "repeat",
    "round", "abs", "ceil", "floor", "pow", "sqrt", "mod", "sign", "ln", "log", "exp",
    "currentdate", "currenttimestamp", "currenttime", "datesub", "dateadd", "datediff", "timestampdiff",
    "timestampadd", "timetostr", "strtodate", "strtotime", "tsordstotimestamp", "tsordstodate", "date",
    "day", "dayofweek", "dayofmonth", "dayofyear", "dayname", "week", "weekofyear", "month", "monthname",
    "quarter", "year", "hour", "minute", "second", "extract", "lastday", "datetrunc", "timestamptrunc",
    "unixtotime", "timetounix", "timestamp", "interval",
}
# Functions sqlglot does not model (kept by name).
ALLOWED_ANONYMOUS: Set[str] = {
    "now", "curdate", "curtime", "unix_timestamp", "from_unixtime", "yearweek", "monthname", "dayname",
    "date_format", "char_length", "character_length", "format", "ifnull", "instr", "locate", "weekday",
    "dayofmonth", "adddate", "subdate", "field", "to_char", "to_date", "date_part", "age", "string_agg",
}


def _guard_fan_out(tree: exp.Expression, relations: List[Dict[str, Any]], primary_keys: Dict[str, List[str]]):
    """
    Joining a child table repeats each parent row once per child, which silently inflates aggregates over
    the parent (the classic "count orders, but joined order_items" mistake). With the real foreign keys:
    COUNT(parent.pk) becomes COUNT(DISTINCT parent.pk) (always the true count); SUM/AVG/COUNT over other
    parent columns is refused with an explanation so the model can fix the query.
    """
    children: Dict[str, Set[str]] = {}
    for fk in relations or []:
        if fk.get("table") and fk.get("ref_table") and fk["table"] != fk["ref_table"]:
            children.setdefault(fk["ref_table"], set()).add(fk["table"])
    notes: List[str] = []
    errors: List[str] = []
    for select in tree.find_all(exp.Select):
        sources = []
        frm = select.args.get("from") or select.args.get("from_")  # key name differs across sqlglot versions
        if frm is not None and isinstance(frm.this, exp.Table):
            sources.append(frm.this)
        for j in select.args.get("joins") or []:
            if isinstance(j.this, exp.Table):
                sources.append(j.this)
        if len(sources) < 2:
            continue
        alias_to_table = {t.alias_or_name: t.name for t in sources}
        in_scope = set(alias_to_table.values())

        # A plain list that joins a child table without using it repeats each parent row.
        aggregated = bool(select.args.get("group")) or bool(select.args.get("distinct")) or any(
            a.find_ancestor(exp.Select) is select for a in select.find_all(exp.AggFunc))
        if not aggregated:
            for j in select.args.get("joins") or []:
                if not isinstance(j.this, exp.Table):
                    continue
                alias, child = j.this.alias_or_name, j.this.name
                on = j.args.get("on")
                used = [c for c in select.find_all(exp.Column) if c.table == alias and not (on is not None and c.find_ancestor(exp.Join) is j)]
                parents = [p for p in in_scope if child in children.get(p, set()) and p != child]
                if not used and parents:
                    errors.append(f"Joining {child} repeats each {parents[0]} row and none of its columns are used: remove that join "
                                  f"(use EXISTS if you only want {parents[0]} rows that have {child}).")
        for agg in list(select.find_all(exp.Count, exp.Sum, exp.Avg)):
            if agg.find_ancestor(exp.Select) is not select:
                continue
            col = agg.this
            if not isinstance(col, exp.Column):
                continue  # COUNT(*), COUNT(DISTINCT ...), expressions
            parent = alias_to_table.get(col.table)
            kids = sorted((children.get(parent, set()) & in_scope) - {parent}) if parent else []
            if not kids:
                continue
            if isinstance(agg, exp.Count) and col.name in primary_keys.get(parent, ["id"]):
                agg.set("this", exp.Distinct(expressions=[col.copy()]))
                notes.append(f"Counted distinct {parent}.{col.name}: the join to {', '.join(kids)} repeats each {parent} row.")
            else:
                errors.append(f"{agg.key.upper()}({parent}.{col.name}) would be inflated: joining {', '.join(kids)} repeats each "
                              f"{parent} row. Remove that join if it is not needed, or aggregate {parent} before joining.")
    return tree, notes, errors


_RANKING_WORDS = {"top", "most", "least", "highest", "lowest", "largest", "smallest", "best", "worst", "biggest", "maximum", "minimum"}


def _words(text: str) -> List[str]:
    return [w for w in re.split(r"[^\w]+", (text or "").lower()) if w]


def _asked(condition: exp.Expression, words: List[str], numbers: Set[str]) -> bool:
    """Is a WHERE condition grounded in the question's own words (column, value, number or abbreviation)?"""
    for col in condition.find_all(exp.Column):
        tokens = [t for t in col.name.lower().split("_") if len(t) >= 3]
        if any(w == t or w.rstrip("s") == t.rstrip("s") for t in tokens for w in words):
            return True
    literals = [lit for lit in condition.find_all(exp.Literal)]
    if not literals:
        return True  # functions only (e.g. dates relative to now): cannot judge, keep it
    for lit in literals:
        v = str(lit.this).lower().strip()
        if not v:
            continue
        if lit.is_number and v.rstrip("0").rstrip(".") in numbers | {n.rstrip("0").rstrip(".") for n in numbers}:
            return True
        if any(w == v or (len(w) >= 4 and len(v) >= 4 and (w.startswith(v) or v.startswith(w))) for w in words):
            return True
        if 2 <= len(v) <= 4 and v.isalpha():  # an abbreviation of a question word, e.g. 'RJ' for Rajasthan
            for w in words:
                if w[0] == v[0] and len(w) > len(v):
                    it = iter(w)
                    if all(ch in it for ch in v):
                        return True
    return False


def _question_checks(tree: exp.Expression, question: str, dialect: str = "mysql",
                     relations: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    words = _words(question)
    numbers = {w for w in words if w.replace(".", "", 1).isdigit()}
    unasked: List[str] = []
    if isinstance(tree, exp.Select) and tree.args.get("where") is not None:
        cond = tree.args["where"].this
        parts = list(cond.flatten()) if isinstance(cond, exp.And) else [cond]
        for p in parts:
            if not _asked(p, words, numbers):
                unasked.append(p.sql(dialect=dialect))
    wants_ranking = bool(_RANKING_WORDS & set(words))
    sorted_query = isinstance(tree, exp.Select) and tree.args.get("order") is not None
    aggregate_only = isinstance(tree, exp.Select) and not tree.args.get("group") and any(
        isinstance(e.unalias(), (exp.Max, exp.Min)) for e in tree.expressions)
    # "Top N <entities> by <child value>" must aggregate per entity: sorting raw child rows without GROUP BY
    # ranks order lines, not products.
    ranks_child_rows = None
    if wants_ranking and sorted_query and isinstance(tree, exp.Select) and not tree.args.get("group") \
            and not any(a.find_ancestor(exp.Select) is tree for a in tree.find_all(exp.AggFunc)):
        frm = tree.args.get("from") or tree.args.get("from_")
        base = frm.this if frm is not None and isinstance(frm.this, exp.Table) else None
        aliases = {t.alias_or_name: t.name for t in tree.find_all(exp.Table)}
        children = {fk.get("table") for fk in relations or [] if base is not None and fk.get("ref_table") == base.name}
        for o in tree.args["order"].expressions:
            for col in o.find_all(exp.Column):
                if aliases.get(col.table) in children:
                    ranks_child_rows = {"entity": base.name, "child": aliases[col.table], "column": col.name}
    return {"unasked_filters": unasked, "missing_order": wants_ranking and not sorted_query and not aggregate_only,
            "ranks_child_rows": ranks_child_rows}


def validate_select(
    raw_sql: str,
    dialect: str = "mysql",
    schema: Optional[Dict[str, List[str]]] = None,
    max_limit: int = 200,
    relations: Optional[List[Dict[str, Any]]] = None,
    primary_keys: Optional[Dict[str, List[str]]] = None,
    force_limit: Optional[int] = None,
    question: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Validate one model-written SELECT against the live schema the caller allows.

    `schema` maps every readable table to its readable columns (secret columns are simply absent, so
    referencing one fails and `SELECT *` expands only to readable columns). Returns the executable SQL
    (fully qualified, LIMIT forced to at most `max_limit`) or precise errors the model can fix.
    """
    base = analyze_sql(raw_sql, dialect=dialect, max_limit=10 ** 9)
    d = base.dialect
    errors = list(base.errors)
    result: Dict[str, Any] = {"valid": False, "dialect": d, "tables": base.tables, "errors": errors, "sql": None}
    if errors:
        return result

    schema = schema or {}
    exact = {t: cols for t, cols in schema.items()}
    by_lower = {t.lower(): t for t in schema}
    for t in base.tables:
        if t not in exact:
            hint = f" Did you mean '{by_lower[t.lower()]}'?" if t.lower() in by_lower else ""
            errors.append(f"Table '{t}' is not available.{hint} Available tables: {', '.join(sorted(schema)[:60])}.")

    tree = sqlglot.parse_one(raw_sql.strip().rstrip(";"), read=d)
    for f in tree.find_all(exp.Func):
        if isinstance(f, exp.Anonymous):
            if f.name.lower() not in ALLOWED_ANONYMOUS:
                errors.append(f"Function {f.name}() is not allowed in read queries.")
        elif f.key not in ALLOWED_FUNCTIONS:
            errors.append(f"Function {f.key.upper()}() is not allowed in read queries.")
    if errors:
        result["errors"] = sorted(set(errors), key=errors.index)
        return result

    from sqlglot.optimizer.qualify import qualify
    mapping = {t: {c: "TEXT" for c in cols} for t, cols in exact.items()}
    try:
        qualified = qualify(tree, schema=mapping, dialect=d, validate_qualify_columns=True,
                            quote_identifiers=True, expand_stars=True)
    except Exception as e:  # unknown or ambiguous columns, bad references
        msg = str(e).split(" Line:")[0].rstrip(". ")
        used = [t for t in base.tables if t in exact]
        cols = "; ".join(f"{t}: {', '.join(exact[t][:80])}" for t in used)
        result["errors"] = [f"{msg}. Columns you can use — {cols}." if cols else msg]
        return result

    qualified, notes, fan_errors = _guard_fan_out(qualified, relations or [], primary_keys or {})
    if fan_errors:
        result["errors"] = fan_errors
        return result

    # Force a LIMIT (cap any larger one).
    if force_limit:
        limit = min(max_limit, force_limit)  # e.g. widen a top-N that ended inside a tie
    else:
        limit = min(max_limit, base.limit_value) if base.limit_value else max_limit
    if isinstance(qualified, exp.Select):
        qualified = qualified.limit(limit)
    else:
        qualified = exp.select("*").from_(qualified.subquery("q")).limit(limit)

    # What the query really filters and sorts on, so the answer can state it (transparency, not trust).
    where = qualified.args.get("where") if isinstance(qualified, exp.Select) else None
    order = qualified.args.get("order") if isinstance(qualified, exp.Select) else None
    result.update({
        "valid": True, "errors": [], "sql": qualified.sql(dialect=d), "limit": limit, "notes": notes,
        "where": where.this.sql(dialect=d) if where is not None else None,
        "order_by": [o.this.alias_or_name for o in order.expressions] if order is not None else [],
    })
    if question:
        result.update(_question_checks(qualified, question, d, relations))
    return result
