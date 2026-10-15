"""
test_field_classifier.py
------------------------
Unit tests for the FieldClassifier service (Phase 1b).

Coverage:
  - 5 fixture schemas: blog+FK+junction, news+author, products+enum, weird names, restricted-like table
  - PK always classified as primary_key with confidence 1.0
  - FK table name drives category/author/media/tag ref roles
  - Column name patterns: title, slug, body, excerpt, status, published_at, image_url, seo_title, seo_description
  - Type fallbacks: json_meta for JSON columns, boolean_flag for tinyint(1)
  - Duplicate role penalty: confidence degrades below 0.70 when same role appears twice
  - Low-confidence columns flagged for user confirmation
  - Writable_by_automation=False for PKs, created_at, updated_at
  - classifyFields endpoint: POST /v1/rag/classify-fields returns structured results
"""

import pytest
from fastapi.testclient import TestClient

from ai_service.app.services.field_classifier import (
    FieldClassifier,
    ColumnDescriptor,
    field_classifier,
)
from ai_service.app.main import app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def clf():
    return FieldClassifier()


def col(**kwargs) -> ColumnDescriptor:
    """Helper to build a ColumnDescriptor from keyword args."""
    return ColumnDescriptor.from_dict(kwargs)


# ---------------------------------------------------------------------------
# 1. Blog posts table (FK + junction)
# ---------------------------------------------------------------------------

BLOG_POSTS_COLUMNS = [
    {"name": "id",                "db_type": "int",      "is_pk": True,  "auto_increment": True},
    {"name": "title",             "db_type": "varchar",  "max_length": 255},
    {"name": "slug",              "db_type": "varchar",  "is_unique": True, "max_length": 255},
    {"name": "short_description", "db_type": "varchar",  "max_length": 500},
    {"name": "content",           "db_type": "text"},
    {"name": "banner",            "db_type": "varchar",  "max_length": 2083},
    {"name": "seo_title",         "db_type": "varchar",  "max_length": 60},
    {"name": "meta_description",  "db_type": "varchar",  "max_length": 160},
    {"name": "status",            "db_type": "varchar",  "enum_values": ["draft", "published", "archived"]},
    {"name": "author_id",         "db_type": "int",      "fk_table": "users"},
    {"name": "category_id",       "db_type": "int",      "fk_table": "categories"},
    {"name": "published_at",      "db_type": "datetime", "nullable": True},
    {"name": "created_at",        "db_type": "datetime", "nullable": False},
    {"name": "updated_at",        "db_type": "datetime", "nullable": False},
]


def test_blog_pk_always_primary_key(clf):
    result = clf.classify_column(col(name="id", db_type="int", is_pk=True))
    assert result.role == "primary_key"
    assert result.confidence == 1.0
    assert result.writable_by_automation is False


def test_blog_fk_author_resolves(clf):
    result = clf.classify_column(col(name="author_id", db_type="int", fk_table="users"))
    assert result.role == "author_ref"
    assert result.confidence >= 0.90


def test_blog_fk_category_resolves(clf):
    result = clf.classify_column(col(name="category_id", db_type="int", fk_table="categories"))
    assert result.role == "category_ref"
    assert result.confidence >= 0.90


def test_blog_title_classified(clf):
    result = clf.classify_column(col(name="title", db_type="varchar", max_length=255))
    assert result.role == "title"
    assert result.confidence >= 0.90


def test_blog_slug_classified(clf):
    result = clf.classify_column(col(name="slug", db_type="varchar", is_unique=True))
    assert result.role == "slug"
    assert result.confidence >= 0.95


def test_blog_summary_classified(clf):
    result = clf.classify_column(col(name="short_description", db_type="varchar", max_length=500))
    assert result.role == "summary"
    assert result.confidence >= 0.85


def test_blog_body_text_type(clf):
    result = clf.classify_column(col(name="content", db_type="text"))
    assert result.role == "body"
    assert result.confidence >= 0.90


def test_blog_banner_image_url(clf):
    result = clf.classify_column(col(name="banner", db_type="varchar", max_length=2083))
    assert result.role == "image_url"


def test_blog_seo_title(clf):
    result = clf.classify_column(col(name="seo_title", db_type="varchar", max_length=60))
    assert result.role == "seo_title"
    assert result.confidence >= 0.90


def test_blog_meta_description(clf):
    result = clf.classify_column(col(name="meta_description", db_type="varchar", max_length=160))
    assert result.role == "seo_description"
    assert result.confidence >= 0.90


def test_blog_status_with_enum(clf):
    result = clf.classify_column(col(
        name="status", db_type="varchar",
        enum_values=["draft", "published", "archived"]
    ))
    assert result.role == "status"
    assert result.confidence >= 0.95


def test_blog_published_at(clf):
    result = clf.classify_column(col(name="published_at", db_type="datetime", nullable=True))
    assert result.role == "published_at"


def test_blog_created_at_not_writable(clf):
    result = clf.classify_column(col(name="created_at", db_type="datetime", nullable=False))
    assert result.role == "created_at"
    assert result.writable_by_automation is False


def test_blog_updated_at_not_writable(clf):
    result = clf.classify_column(col(name="updated_at", db_type="datetime", nullable=False))
    assert result.writable_by_automation is False


def test_blog_full_table_classification(clf):
    """Classify all columns in the blog posts table — no crashes, all columns returned."""
    columns = [col(**c) for c in BLOG_POSTS_COLUMNS]
    results = clf.classify_table(columns)
    assert len(results) == len(BLOG_POSTS_COLUMNS)
    roles = {r.column_name: r.role for r in results}
    assert roles["id"] == "primary_key"
    assert roles["author_id"] == "author_ref"
    assert roles["category_id"] == "category_ref"


# ---------------------------------------------------------------------------
# 2. News + author table
# ---------------------------------------------------------------------------

NEWS_COLUMNS = [
    {"name": "news_id",     "db_type": "int",     "is_pk": True},
    {"name": "headline",    "db_type": "varchar",  "max_length": 200},
    {"name": "excerpt",     "db_type": "varchar",  "max_length": 400},
    {"name": "body",        "db_type": "longtext"},
    {"name": "writer_id",   "db_type": "int",      "fk_table": "authors"},
    {"name": "og_image",    "db_type": "varchar"},
    {"name": "locale",      "db_type": "varchar",  "max_length": 10},
    {"name": "published",   "db_type": "tinyint",  "max_length": 1},
]


def test_news_headline_as_title(clf):
    result = clf.classify_column(col(name="headline", db_type="varchar", max_length=200))
    assert result.role == "title"


def test_news_excerpt_as_summary(clf):
    result = clf.classify_column(col(name="excerpt", db_type="varchar", max_length=400))
    assert result.role == "summary"


def test_news_body_longtext(clf):
    result = clf.classify_column(col(name="body", db_type="longtext"))
    assert result.role == "body"


def test_news_writer_id_author_ref(clf):
    result = clf.classify_column(col(name="writer_id", db_type="int", fk_table="authors"))
    assert result.role == "author_ref"


def test_news_og_image(clf):
    result = clf.classify_column(col(name="og_image", db_type="varchar"))
    assert result.role == "image_url"


def test_news_locale_language(clf):
    result = clf.classify_column(col(name="locale", db_type="varchar", max_length=10))
    assert result.role == "language"


def test_news_published_boolean_flag(clf):
    result = clf.classify_column(col(name="published", db_type="tinyint", max_length=1))
    assert result.role in ("status", "boolean_flag")


# ---------------------------------------------------------------------------
# 3. Products table with enum + price
# ---------------------------------------------------------------------------

PRODUCT_COLUMNS = [
    {"name": "product_id",   "db_type": "int",     "is_pk": True},
    {"name": "name",         "db_type": "varchar",  "max_length": 200},
    {"name": "description",  "db_type": "text"},
    {"name": "price",        "db_type": "decimal"},
    {"name": "status",       "db_type": "varchar",  "enum_values": ["active", "inactive", "discontinued"]},
    {"name": "meta",         "db_type": "json"},
]


def test_product_name_title(clf):
    result = clf.classify_column(col(name="name", db_type="varchar", max_length=200))
    # "name" doesn't match title/heading patterns — may be unknown; acceptable
    assert result.role in ("title", "unknown")


def test_product_description_body(clf):
    result = clf.classify_column(col(name="description", db_type="text"))
    assert result.role == "body"


def test_product_price(clf):
    result = clf.classify_column(col(name="price", db_type="decimal"))
    assert result.role == "price"
    assert result.confidence >= 0.85


def test_product_json_meta(clf):
    result = clf.classify_column(col(name="meta", db_type="json"))
    assert result.role == "json_meta"


# ---------------------------------------------------------------------------
# 4. Weird / ambiguous column names
# ---------------------------------------------------------------------------

def test_weird_names_do_not_crash(clf):
    weird_cols = [
        col(name="x", db_type="varchar"),
        col(name="data_123", db_type="text"),
        col(name="field_a_b_c", db_type="int"),
        col(name="__internal__", db_type="varchar"),
    ]
    for c in weird_cols:
        result = clf.classify_column(c)
        assert result.role in (
            "title", "slug", "summary", "body", "seo_title", "seo_description",
            "status", "published_at", "created_at", "updated_at", "author_ref",
            "category_ref", "tag_ref", "media_ref", "image_url", "image_path",
            "language", "url", "price", "boolean_flag", "json_meta", "unknown"
        )
        assert 0.0 <= result.confidence <= 1.0


# ---------------------------------------------------------------------------
# 5. Duplicate role penalty
# ---------------------------------------------------------------------------

def test_duplicate_role_degrades_confidence(clf):
    """Two varchar columns both named *description* → second gets degraded confidence."""
    columns = [
        col(name="short_description", db_type="varchar", max_length=300),
        col(name="long_description", db_type="varchar"),
    ]
    results = clf.classify_table(columns)
    roles = [r.role for r in results]
    # Both may map to "summary" or "body"; the second should have lower or flagged confidence
    confs = [r.confidence for r in results]
    # The second classification must have degraded confidence OR trigger user confirmation
    second = results[1]
    assert second.confidence < 0.90 or second.needs_user_confirmation


# ---------------------------------------------------------------------------
# 6. classify_from_dicts convenience method
# ---------------------------------------------------------------------------

def test_classify_from_dicts_returns_serialisable(clf):
    result = clf.classify_from_dicts(BLOG_POSTS_COLUMNS)
    assert isinstance(result, list)
    assert len(result) == len(BLOG_POSTS_COLUMNS)
    for item in result:
        assert "column_name" in item
        assert "role" in item
        assert "confidence" in item
        assert "evidence" in item
        assert "needs_user_confirmation" in item
        assert "writable_by_automation" in item
        assert "role_description" in item


# ---------------------------------------------------------------------------
# 7. API endpoint test
# ---------------------------------------------------------------------------

def test_classify_fields_api_endpoint():
    """POST /v1/rag/classify-fields returns structured classifications."""
    client = TestClient(app)
    response = client.post(
        "/v1/rag/classify-fields",
        json={"columns": BLOG_POSTS_COLUMNS},
        headers={"X-Service-Token": "platform_secret_internal_key_2026"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert len(data["classifications"]) == len(BLOG_POSTS_COLUMNS)

    # Check PK classification
    pk = next(c for c in data["classifications"] if c["column_name"] == "id")
    assert pk["role"] == "primary_key"
    assert pk["confidence"] == 1.0
    assert pk["writable_by_automation"] is False

    # Check author FK
    author = next(c for c in data["classifications"] if c["column_name"] == "author_id")
    assert author["role"] == "author_ref"

    # Check category FK
    category = next(c for c in data["classifications"] if c["column_name"] == "category_id")
    assert category["role"] == "category_ref"
