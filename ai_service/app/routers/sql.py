"""
SQL Analyzer router: /v1/sql/analyze endpoint for the Laravel read gate.
"""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field
from ai_service.app.services.sql_analyzer import analyze_sql, validate_select

router = APIRouter(prefix="/v1/sql", tags=["SQL Analyzer"])


class SqlAnalyzeRequest(BaseModel):
    sql: str = Field(..., description="Raw SQL statement to parse and validate")
    dialect: str = Field("mysql", description="SQL dialect: 'mysql' or 'postgres'")
    max_limit: int = Field(500, description="Maximum allowed LIMIT value")


class SqlAnalyzeResponse(BaseModel):
    valid: bool
    dialect: str
    statement_type: str
    tables: List[str]
    columns: List[str]
    functions: List[str]
    has_limit: bool
    limit_value: Optional[int] = None
    errors: List[str] = []
    normalized_sql: Optional[str] = None


@router.post("/analyze", response_model=SqlAnalyzeResponse)
def analyze_endpoint(req: SqlAnalyzeRequest):
    result = analyze_sql(req.sql, dialect=req.dialect, max_limit=req.max_limit)
    return SqlAnalyzeResponse(**result.to_dict())


class ValidateSelectRequest(BaseModel):
    sql: str = Field(..., description="One model-written SELECT")
    dialect: str = Field("mysql", description="'mysql' or 'postgres'")
    schema_: Dict[str, List[str]] = Field(default_factory=dict, alias="schema",
                                          description="Readable tables -> readable columns (secret columns omitted)")
    max_limit: int = Field(200, ge=1, le=1000)
    relations: List[Dict[str, Any]] = Field(default_factory=list, description="Foreign keys {table, columns, ref_table, ref_columns}")
    primary_keys: Dict[str, List[str]] = Field(default_factory=dict)
    force_limit: Optional[int] = Field(None, ge=1, le=1000)
    question: Optional[str] = Field(None, description="The question, to flag filters it does not ask for")


@router.post("/validate-select")
def validate_select_endpoint(req: ValidateSelectRequest):
    """Read gate: AST parse, single SELECT, allow-listed tables/functions, live columns, fan-out guard, forced LIMIT."""
    return validate_select(req.sql, dialect=req.dialect, schema=req.schema_, max_limit=req.max_limit,
                           relations=req.relations, primary_keys=req.primary_keys, force_limit=req.force_limit,
                           question=req.question)
