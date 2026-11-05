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
    document_ids: Optional[List[int]] = Field(default=None, description="Optional list of document IDs to restrict search to")
    min_score: Optional[float] = Field(default=None, description="Optional minimum similarity score cutoff")
    hybrid: bool = Field(default=True, description="Enable hybrid dense-semantic and lexical keyword scoring")


class RetrievedChunk(BaseModel):
    chunk_id: str
    document_id: int
    text: str
    score: float
    embedding_backend: Optional[str] = None


class QueryResponse(BaseModel):
    query: str
    user_id: int
    chunks: List[RetrievedChunk]


class RagStatusResponse(BaseModel):
    user_id: int
    total_vectors: int
    dimension: int
    backend: str
    document_ids: List[int]
    chunk_counts: dict = Field(default_factory=dict)
    healthy: bool
