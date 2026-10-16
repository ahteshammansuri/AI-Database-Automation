"""
SQL Analyzer router: /v1/sql/analyze endpoint for the Laravel read gate.
"""
from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field
from ai_service.app.services.sql_analyzer import analyze_sql

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
