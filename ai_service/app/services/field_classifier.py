"""
field_classifier.py
-------------------
Deterministic rule-based field role classifier with confidence scoring.

Given a list of column descriptors from live schema introspection (name, type,
nullable, is_pk, is_unique, fk_table, max_length, enum_values, sample_values),
returns a classification per column with:

    role       – canonical role string (see ROLES below)
    confidence – float 0.0–1.0
    evidence   – human-readable explanation of which signals matched

Signal priority (highest → lowest):
  1. is_pk  →  primary_key (always 1.0)
  2. fk_table name         →  *_ref roles
  3. column name patterns  →  specific roles
  4. data type             →  broad type roles
  5. constraints           →  tiebreakers

Low-confidence columns (< 0.70) are flagged for user confirmation in the
automation wizard.
"""

import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


# ---------------------------------------------------------------------------
# Role constants
# ---------------------------------------------------------------------------
ROLES = [
    "primary_key",
    "title",
    "slug",
    "summary",
    "body",
    "seo_title",
    "seo_description",
    "status",
    "published_at",
    "created_at",
    "updated_at",
    "author_ref",
    "category_ref",
    "tag_ref",
    "media_ref",
    "image_url",
    "image_path",
    "language",
    "url",
    "price",
    "boolean_flag",
    "json_meta",
    "unknown",
]

ROLE_DESCRIPTIONS = {
    "primary_key": "Auto-increment primary key — never written by automation",
    "title": "Human-readable content title",
    "slug": "URL-safe identifier derived from title",
    "summary": "Short (1–2 sentence) excerpt or teaser",
    "body": "Full rich-text or Markdown content body",
    "seo_title": "SEO/meta page title (≤ 60 chars)",
    "seo_description": "SEO meta description (≤ 160 chars)",
    "status": "Publication status (draft / published / archived / 0/1)",
    "published_at": "Scheduled or actual publication timestamp",
    "created_at": "Record creation timestamp (auto-set by DB)",
    "updated_at": "Record update timestamp (auto-set by DB)",
    "author_ref": "Foreign key to author / user table",
    "category_ref": "Foreign key to category table",
    "tag_ref": "Foreign key to tag / label table",
    "media_ref": "Foreign key to media / file / image table",
    "image_url": "Absolute URL to an image (stored as string)",
    "image_path": "Server-relative path to a stored image file",
    "language": "ISO language code (en, fr, …)",
    "url": "Canonical URL / permalink",
    "price": "Monetary price value",
    "boolean_flag": "Boolean flag (0/1 or true/false)",
    "json_meta": "Structured JSON metadata blob",
    "unknown": "Role could not be determined — requires user confirmation",
}


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ColumnDescriptor:
    """Normalised column information from live schema introspection."""
    name: str
    db_type: str                          # e.g. "varchar", "text", "int", "tinyint", "json", "datetime"
    is_pk: bool = False
    is_unique: bool = False
    nullable: bool = True
    max_length: Optional[int] = None
    enum_values: List[str] = field(default_factory=list)
    fk_table: Optional[str] = None       # referenced table name, if FK
    sample_values: List[Any] = field(default_factory=list)
    auto_increment: bool = False
    default_value: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ColumnDescriptor":
        return cls(
            name=d.get("name", ""),
            db_type=(d.get("db_type") or d.get("type") or "varchar").lower(),
            is_pk=bool(d.get("is_pk", False)),
            is_unique=bool(d.get("is_unique", False)),
            nullable=bool(d.get("nullable", True)),
            max_length=d.get("max_length"),
            enum_values=d.get("enum_values") or [],
            fk_table=d.get("fk_table") or d.get("references"),
            sample_values=d.get("sample_values") or [],
            auto_increment=bool(d.get("auto_increment", False)),
            default_value=d.get("default_value"),
        )


@dataclass
class FieldClassification:
    column_name: str
    role: str
    confidence: float
    evidence: str
    needs_user_confirmation: bool = False
    writable_by_automation: bool = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tokenize(s: str) -> List[str]:
    return [t for t in re.split(r"[_\-\s]+", s.lower()) if t]


def _name_matches(col_name: str, *patterns: str) -> bool:
    """Case-insensitive token-aware match against column name."""
    name = col_name.lower().strip()
    name_tokens = _tokenize(name)
    for p in patterns:
        p_clean = p.lower().strip()
        if name == p_clean:
            return True
        p_tokens = _tokenize(p_clean)
        if len(p_tokens) > 1:
            if len(p_tokens) <= len(name_tokens):
                for i in range(len(name_tokens) - len(p_tokens) + 1):
                    if name_tokens[i:i + len(p_tokens)] == p_tokens:
                        return True
        else:
            if p_clean in name_tokens:
                return True
    return False


def _table_matches(fk_table: Optional[str], *keywords: str) -> bool:
    if not fk_table:
        return False
    tbl = fk_table.lower()
    return any(k in tbl for k in keywords)


def _type_is(db_type: str, *types: str) -> bool:
    return any(db_type.startswith(t) for t in types)


# ---------------------------------------------------------------------------
# Non-writable column detection
# ---------------------------------------------------------------------------

_NON_WRITABLE_PATTERNS = [
    "created_at", "updated_at", "deleted_at", "modified_at",
    "created_on", "updated_on", "timestamp",
]


def _is_auto_timestamp(col: ColumnDescriptor) -> bool:
    lower = col.name.lower()
    return any(p in lower for p in _NON_WRITABLE_PATTERNS) and _type_is(col.db_type, "datetime", "timestamp")


# ---------------------------------------------------------------------------
# Core classifier
# ---------------------------------------------------------------------------

class FieldClassifier:
    """
    Classifies each column in a table into a semantic role for automation.

    Usage:
        clf = FieldClassifier()
        results = clf.classify_table(columns)  # List[ColumnDescriptor]
    """

    def classify_column(self, col: ColumnDescriptor) -> FieldClassification:
        name = col.name.lower()
        evidence_parts: List[str] = []

        # ------------------------------------------------------------------ #
        # P1: Primary key                                                      #
        # ------------------------------------------------------------------ #
        if col.is_pk:
            return FieldClassification(
                column_name=col.name,
                role="primary_key",
                confidence=1.0,
                evidence="Column is primary key",
                writable_by_automation=False,
            )

        # ------------------------------------------------------------------ #
        # P2: Foreign keys — derive role from referenced table name            #
        # ------------------------------------------------------------------ #
        if col.fk_table:
            fk = col.fk_table.lower()
            if any(k in fk for k in ["author", "user", "writer", "member", "contributor"]):
                return FieldClassification(
                    column_name=col.name,
                    role="author_ref",
                    confidence=0.95,
                    evidence=f"FK → {col.fk_table} (author/user table)",
                )
            if any(k in fk for k in ["categor", "category", "cat", "section", "topic", "genre"]):
                return FieldClassification(
                    column_name=col.name,
                    role="category_ref",
                    confidence=0.95,
                    evidence=f"FK → {col.fk_table} (category table)",
                )
            if any(k in fk for k in ["tag", "label", "keyword"]):
                return FieldClassification(
                    column_name=col.name,
                    role="tag_ref",
                    confidence=0.92,
                    evidence=f"FK → {col.fk_table} (tag/label table)",
                )
            if any(k in fk for k in ["media", "image", "photo", "file", "attachment", "asset"]):
                return FieldClassification(
                    column_name=col.name,
                    role="media_ref",
                    confidence=0.92,
                    evidence=f"FK → {col.fk_table} (media table)",
                )
            # Generic FK — unknown role
            return FieldClassification(
                column_name=col.name,
                role="unknown",
                confidence=0.40,
                evidence=f"FK → {col.fk_table} — role unknown, needs user confirmation",
                needs_user_confirmation=True,
            )

        # ------------------------------------------------------------------ #
        # P3: Auto-managed timestamps                                          #
        # ------------------------------------------------------------------ #
        if _is_auto_timestamp(col):
            if "publish" in name or "pub_" in name:
                return FieldClassification(
                    column_name=col.name,
                    role="published_at",
                    confidence=0.90,
                    evidence="Datetime column named *publish*",
                )
            if "creat" in name:
                return FieldClassification(
                    column_name=col.name,
                    role="created_at",
                    confidence=0.97,
                    evidence="Datetime column named *creat*",
                    writable_by_automation=False,
                )
            return FieldClassification(
                column_name=col.name,
                role="updated_at",
                confidence=0.92,
                evidence="Datetime column named *update*/*modif*",
                writable_by_automation=False,
            )

        # ------------------------------------------------------------------ #
        # P4: Column name patterns (Specific patterns BEFORE general patterns)  #
        # ------------------------------------------------------------------ #

        # --- SEO title (MUST be before title) ---
        if _name_matches(name, "seo_title", "meta_title", "og_title", "page_title"):
            return FieldClassification(
                column_name=col.name,
                role="seo_title",
                confidence=0.95,
                evidence="Name matches seo_title/meta_title",
            )

        # --- SEO description (MUST be before body and summary) ---
        if _name_matches(name, "seo_description", "meta_description", "og_description", "meta_desc"):
            return FieldClassification(
                column_name=col.name,
                role="seo_description",
                confidence=0.95,
                evidence="Name matches seo_description/meta_description",
            )

        # --- summary/excerpt (MUST be before generic body/description) ---
        if _name_matches(name, "short_description", "brief_description", "excerpt", "summary", "teaser", "brief", "abstract", "intro"):
            return FieldClassification(
                column_name=col.name,
                role="summary",
                confidence=0.93,
                evidence="Name matches excerpt/summary/short_description",
            )

        # --- published_at (MUST be before status / published flag) ---
        if _name_matches(name, "published_at", "publish_at", "pub_date", "publish_date", "go_live", "scheduled_at", "post_date") or (
            ("publish" in name or "pub_" in name) and _type_is(col.db_type, "datetime", "timestamp", "date")
        ):
            return FieldClassification(
                column_name=col.name,
                role="published_at",
                confidence=0.93,
                evidence="Name matches published_at/publish_date",
            )

        # --- title ---
        if _name_matches(name, "title", "heading", "headline", "post_title", "article_title"):
            conf = 0.95
            if col.max_length and col.max_length <= 500:
                conf = 0.97
                evidence_parts.append(f"max_length={col.max_length}")
            return FieldClassification(
                column_name=col.name,
                role="title",
                confidence=conf,
                evidence="Name matches 'title/heading/headline'" + (f"; {', '.join(evidence_parts)}" if evidence_parts else ""),
            )

        # --- slug ---
        if _name_matches(name, "slug", "permalink", "url_key", "url_slug"):
            return FieldClassification(
                column_name=col.name,
                role="slug",
                confidence=0.97,
                evidence="Name matches 'slug/permalink/url_key'",
            )

        # --- body/content ---
        if _name_matches(name, "content", "body", "text", "description", "article", "post_content", "full_text", "long_description"):
            if _type_is(col.db_type, "text", "longtext", "mediumtext"):
                return FieldClassification(
                    column_name=col.name,
                    role="body",
                    confidence=0.95,
                    evidence="Name matches content/body/text; TEXT type",
                )
            return FieldClassification(
                column_name=col.name,
                role="body",
                confidence=0.82,
                evidence="Name matches content/body/text",
            )

        # --- status ---
        if _name_matches(name, "status", "state", "published", "is_published", "is_active", "active", "post_status"):
            if col.enum_values:
                return FieldClassification(
                    column_name=col.name,
                    role="status",
                    confidence=0.97,
                    evidence=f"Name matches status/state; enum values={col.enum_values}",
                )
            if _type_is(col.db_type, "tinyint", "boolean", "bool", "bit"):
                return FieldClassification(
                    column_name=col.name,
                    role="boolean_flag",
                    confidence=0.88,
                    evidence="Name matches is_*/active; tinyint/bool type",
                )
            return FieldClassification(
                column_name=col.name,
                role="status",
                confidence=0.82,
                evidence="Name matches status/state",
            )

        # --- image URL ---
        if _name_matches(name, "banner", "thumbnail", "cover", "featured_image", "hero_image",
                         "og_image", "meta_img", "image_url", "photo_url"):
            if _type_is(col.db_type, "varchar", "text"):
                return FieldClassification(
                    column_name=col.name,
                    role="image_url",
                    confidence=0.90,
                    evidence="Name matches image/banner/thumbnail/cover",
                )

        # --- image path ---
        if _name_matches(name, "image_path", "img_path", "photo_path", "file_path"):
            return FieldClassification(
                column_name=col.name,
                role="image_path",
                confidence=0.88,
                evidence="Name matches *_path image pattern",
            )

        # --- language ---
        if _name_matches(name, "language", "locale", "lang", "lang_code"):
            return FieldClassification(
                column_name=col.name,
                role="language",
                confidence=0.92,
                evidence="Name matches language/locale/lang",
            )

        # --- url ---
        if name in ("url", "canonical_url", "link", "href", "source_url"):
            return FieldClassification(
                column_name=col.name,
                role="url",
                confidence=0.88,
                evidence="Name matches url/canonical_url/link",
            )

        # --- price ---
        if _name_matches(name, "price", "cost", "amount", "fee", "rate"):
            if _type_is(col.db_type, "decimal", "numeric", "float", "double"):
                return FieldClassification(
                    column_name=col.name,
                    role="price",
                    confidence=0.90,
                    evidence="Name matches price/cost; decimal type",
                )

        # --- author_ref by column name alone (no FK) ---
        if _name_matches(name, "author_id", "user_id", "writer_id", "created_by", "posted_by"):
            return FieldClassification(
                column_name=col.name,
                role="author_ref",
                confidence=0.80,
                evidence="Name matches author_id/user_id (no FK metadata)",
                needs_user_confirmation=True,
            )

        # --- category_ref by column name alone ---
        if _name_matches(name, "category_id", "cat_id", "section_id", "topic_id", "genre_id"):
            return FieldClassification(
                column_name=col.name,
                role="category_ref",
                confidence=0.80,
                evidence="Name matches category_id (no FK metadata)",
                needs_user_confirmation=True,
            )

        # ------------------------------------------------------------------ #
        # P5: Type-based fallbacks                                             #
        # ------------------------------------------------------------------ #

        if _type_is(col.db_type, "json"):
            return FieldClassification(
                column_name=col.name,
                role="json_meta",
                confidence=0.75,
                evidence="JSON type",
            )

        if _type_is(col.db_type, "tinyint", "bit") and not _type_is(col.db_type, "tinyint unsigned"):
            # Could be boolean flag
            if col.max_length in (None, 1):
                return FieldClassification(
                    column_name=col.name,
                    role="boolean_flag",
                    confidence=0.70,
                    evidence="tinyint(1) — likely boolean",
                )

        # ------------------------------------------------------------------ #
        # Default: unknown                                                     #
        # ------------------------------------------------------------------ #
        return FieldClassification(
            column_name=col.name,
            role="unknown",
            confidence=0.30,
            evidence="No pattern matched — requires user confirmation",
            needs_user_confirmation=True,
        )

    def classify_table(self, columns: List[ColumnDescriptor]) -> List[FieldClassification]:
        """Classify all columns in a table. Returns one classification per column."""
        results = []
        seen_roles: Dict[str, int] = {}

        for col in columns:
            classification = self.classify_column(col)
            role = classification.role

            # Degrade confidence when the same high-level role appears twice
            # (e.g., two text columns both classified as 'body')
            if role not in ("unknown", "primary_key", "boolean_flag", "json_meta", "created_at", "updated_at"):
                if role in seen_roles:
                    classification.confidence = max(0.30, classification.confidence - 0.25)
                    classification.evidence += " [confidence reduced: duplicate role in table]"
                    if classification.confidence < 0.70:
                        classification.needs_user_confirmation = True
                seen_roles[role] = seen_roles.get(role, 0) + 1

            results.append(classification)

        return results

    def classify_from_dicts(self, column_dicts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Convenience wrapper: accepts raw dicts from Laravel schema introspection
        and returns serialisable dicts.
        """
        columns = [ColumnDescriptor.from_dict(d) for d in column_dicts]
        classifications = self.classify_table(columns)
        return [
            {
                "column_name": c.column_name,
                "role": c.role,
                "confidence": round(c.confidence, 3),
                "evidence": c.evidence,
                "needs_user_confirmation": c.needs_user_confirmation,
                "writable_by_automation": c.writable_by_automation,
                "role_description": ROLE_DESCRIPTIONS.get(c.role, ""),
            }
            for c in classifications
        ]


# Module-level singleton
field_classifier = FieldClassifier()
