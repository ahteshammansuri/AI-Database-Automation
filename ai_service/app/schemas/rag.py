from typing import List, Optional
from pydantic import BaseModel, Field


class DocumentIndexRequest(BaseModel):
    user_id: int = Field(..., description="Workspace / tenant owner ID")
    document_id: int = Field(..., description="Document identifier")
    title: str = Field(..., description="Document title")
    text_content: str = Field(..., description="Extracted raw text content")
    file_type: str = Field(default="txt", description="File type: md, txt, pdf")


class DocumentIndexResponse(BaseModel):
    success: bool
    document_id: int
    user_id: int
    chunks_created: int
    total_vectors: int


class QueryRequest(BaseModel):
    user_id: int = Field(..., description="Workspace / tenant owner ID")
    query_text: str = Field(..., description="Search query")
    top_k: int = Field(default=3, description="Number of results to retrieve")


class RetrievedChunk(BaseModel):
    chunk_id: str
    document_id: int
    text: str
    score: float


class QueryResponse(BaseModel):
    query: str
    user_id: int
    chunks: List[RetrievedChunk]
