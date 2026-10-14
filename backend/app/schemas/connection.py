from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict


class ConnectionCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    db_type: str = Field(default="mysql")
    host: str = Field(..., min_length=1)
    port: int = Field(default=3306, ge=1, le=65535)
    database: str = Field(..., min_length=1)
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    use_ssl: bool = Field(default=False)


class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    use_ssl: Optional[bool] = None
    is_active: Optional[bool] = None


class ConnectionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    db_type: str
    host: str
    port: int
    database: str
    username: str
    is_active: bool
    last_tested_at: Optional[datetime] = None
    last_status: str
    created_at: datetime
    updated_at: datetime



class ConnectionTestRequest(BaseModel):
    host: str
    port: int = 3306
    database: str
    username: str
    password: str
    use_ssl: bool = False


class ConnectionTestResponse(BaseModel):
    success: bool
    message: str
    latency_ms: Optional[float] = None
    server_version: Optional[str] = None


class SchemaColumn(BaseModel):
    name: str
    data_type: str
    nullable: bool
    is_primary_key: bool
    is_foreign_key: bool
    default_value: Optional[str] = None
    max_length: Optional[int] = None
    enum_values: Optional[List[str]] = None
    is_unique: bool = False


class SchemaRelationship(BaseModel):
    constrained_column: str
    referenced_table: str
    referenced_column: str


class SchemaTable(BaseModel):
    name: str
    category: str  # "ALLOWLISTED", "REVIEW_NEEDED", "RESTRICTED"
    restriction_reason: Optional[str] = None
    row_count_estimate: Optional[int] = None
    columns: List[SchemaColumn] = []
    relationships: List[SchemaRelationship] = []


class SchemaResponse(BaseModel):
    connection_id: int
    database_name: str
    tables: List[SchemaTable] = []
    scanned_at: datetime
