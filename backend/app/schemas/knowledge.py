from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict


class KnowledgeDocResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    filename: str
    file_type: str
    file_size_bytes: int
    chunk_count: int
    status: str
    error_message: Optional[str] = None
    created_at: datetime


class KnowledgeChunkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    document_id: int
    chunk_index: int
    content: str
    created_at: datetime



class RagQueryRequest(BaseModel):
    query: str = Field(..., min_length=2)
    top_k: int = Field(default=3, ge=1, le=10)


class RagChunkMatch(BaseModel):
    chunk_id: int
    document_id: int
    document_title: str
    content: str
    similarity_score: float


class RagQueryResponse(BaseModel):
    query: str
    matches: List[RagChunkMatch]
