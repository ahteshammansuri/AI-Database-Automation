import re
from typing import List, Tuple, Optional, Set

# Non-negotiable forbidden SQL operations
FORBIDDEN_SQL_KEYWORDS = {
    "DELETE", "DROP", "TRUNCATE", "ALTER", "CREATE", "RENAME",
    "GRANT", "REVOKE", "ATTACH", "DETACH", "PRAGMA", "VACUUM"
}

# Regex to detect forbidden operations in raw statements or subqueries
FORBIDDEN_SQL_REGEX = re.compile(
    r"\b(" + "|".join(FORBIDDEN_SQL_KEYWORDS) + r")\b",
    re.IGNORECASE
)

# Table names and patterns that must be RESTRICTED by default
RESTRICTED_TABLE_PATTERNS = [
    re.compile(r"^(user|users|auth|auth_.*|oauth_.*|account|accounts)$", re.IGNORECASE),
    re.compile(r".*(password|credential|secret|token|session|jwt).*", re.IGNORECASE),
    re.compile(r".*(payment|billing|invoice|transaction|card|wallet|subscription|order|orders).*", re.IGNORECASE),
    re.compile(r".*(audit|audit_log|access_log|security_log|permission|role|roles).*", re.IGNORECASE),
]

# Sensitive column names that must NEVER be written to
RESTRICTED_COLUMN_PATTERNS = [
    re.compile(r".*(password|hash|salt|secret|token|api_key|credit_card|cvv|pin).*", re.IGNORECASE),
    re.compile(r"^(is_admin|is_superuser|role|permissions)$", re.IGNORECASE),
]


class DatabaseSecurityViolation(Exception):
    """Raised when an operation violates target database safety rules."""
    def __init__(self, message: str, code: str = "SECURITY_VIOLATION"):
        super().__init__(message)
        self.message = message
        self.code = code


def validate_no_forbidden_sql(statement_or_fragment: str) -> None:
    """Verify that a SQL string contains NO forbidden DDL/DML keywords."""
    if not statement_or_fragment:
        return
    match = FORBIDDEN_SQL_REGEX.search(statement_or_fragment)
    if match:
        forbidden_word = match.group(1).upper()
        raise DatabaseSecurityViolation(
            f"Operation rejected: Forbidden SQL keyword '{forbidden_word}' is strictly prohibited on customer databases.",
            code="FORBIDDEN_SQL_OPERATION"
        )


def classify_table_sensitivity(table_name: str) -> Tuple[str, Optional[str]]:
    """
    Classify table as ALLOWLISTED, REVIEW_NEEDED, or RESTRICTED based on security policy.
    Returns: (category, reason)
    """
    clean_name = table_name.strip().lower()

    for pattern in RESTRICTED_TABLE_PATTERNS:
        if pattern.search(clean_name):
            return (
                "RESTRICTED",
                f"Table '{table_name}' contains sensitive credentials, financial, or security data and is restricted by default."
            )

    # Check for content-friendly tables
    content_friendly = {"post", "posts", "blog_post", "blog_posts", "article", "articles", "news",
                        "page", "pages", "faq", "faqs", "comment", "comments", "category", "categories",
                        "tag", "tags", "post_tags", "post_categories", "meta", "metadata"}
    if clean_name in content_friendly or any(cf in clean_name for cf in ["post", "article", "blog", "faq"]):
        return ("ALLOWLISTED", None)

    return ("REVIEW_NEEDED", f"Table '{table_name}' requires manual review before enabling automations.")


def validate_table_allowlist(table_name: str, allowlisted_tables: Set[str]) -> None:
    """Ensure the target table is explicitly allowlisted by the user."""
    if table_name not in allowlisted_tables:
        raise DatabaseSecurityViolation(
            f"Table '{table_name}' is not in the allowlisted tables for this automation.",
            code="TABLE_NOT_ALLOWLISTED"
        )
    category, reason = classify_table_sensitivity(table_name)
    if category == "RESTRICTED":
        raise DatabaseSecurityViolation(
            f"Cannot target restricted table '{table_name}': {reason}",
            code="RESTRICTED_TABLE_DENIED"
        )


def validate_columns_allowlist(columns: List[str], allowlisted_columns: Set[str]) -> None:
    """Ensure all target columns are explicitly allowlisted and not sensitive."""
    for col in columns:
        if col not in allowlisted_columns:
            raise DatabaseSecurityViolation(
                f"Column '{col}' is not allowlisted for writing.",
                code="COLUMN_NOT_ALLOWLISTED"
            )
        for pattern in RESTRICTED_COLUMN_PATTERNS:
            if pattern.search(col):
                raise DatabaseSecurityViolation(
                    f"Column '{col}' is classified as sensitive and cannot be written by automations.",
                    code="RESTRICTED_COLUMN_DENIED"
                )
