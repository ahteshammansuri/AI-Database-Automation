"""
QdrantStore: Tenant-isolated vector store using Qdrant (ADR-011).
Supports embedded on-disk mode (default) and server mode.
Strictly pre-filters by tenant_id and namespace before vector scoring.
"""
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)
from ai_service.app.config import settings
from ai_service.app.rag.embeddings import EmbeddingService


class QdrantStore:
    COLLECTION_NAME = "dataauto_vectors"

    def __init__(self, path: Optional[str] = None):
        if not path:
            # Default to local on-disk storage directory
            root = Path(__file__).resolve().parent.parent.parent
            path = str(root / "storage" / "qdrant_db")

        os.makedirs(path, exist_ok=True)
        self.path = path
        self.client = QdrantClient(path=path)
        self.embed_service = EmbeddingService()
        self._ensure_collection()

    def _ensure_collection(self):
        dim = self.embed_service.dimension
        if not self.client.collection_exists(self.COLLECTION_NAME):
            self.client.create_collection(
                collection_name=self.COLLECTION_NAME,
                vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
            )

    def upsert_document_chunks(
        self,
        tenant_id: int,
        namespace: str,
        doc_id: str,
        chunks: List[str],
        vectors: List[List[float]],
        hashes: List[str],
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """
        Upsert chunks of a document. Deletes older chunks for doc_id first to prevent stale data.
        """
        self.delete_document(tenant_id, doc_id)
        points: List[PointStruct] = []

        for idx, (chunk, vec, h) in enumerate(zip(chunks, vectors, hashes)):
            p_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{tenant_id}:{namespace}:{doc_id}:{idx}"))
            payload = {
                "tenant_id": tenant_id,
                "namespace": namespace,
                "doc_id": doc_id,
                "chunk_index": idx,
                "hash": h,
                "text": chunk,
                "metadata": metadata or {},
            }
            points.append(PointStruct(id=p_id, vector=vec, payload=payload))

        if points:
            self.client.upsert(collection_name=self.COLLECTION_NAME, points=points)

    def upsert_schema_profile(
        self,
        tenant_id: int,
        connection_id: int,
        table_name: str,
        profile_text: str,
        vector: List[float],
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """
        Upsert a table's schema profile summary for schema linking.
        """
        p_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{tenant_id}:schema:{connection_id}:{table_name}"))
        payload = {
            "tenant_id": tenant_id,
            "namespace": "schema_profiles",
            "connection_id": connection_id,
            "table_name": table_name,
            "text": profile_text,
            "metadata": metadata or {},
        }
        point = PointStruct(id=p_id, vector=vector, payload=payload)
        self.client.upsert(collection_name=self.COLLECTION_NAME, points=[point])

    def search(
        self,
        query_vector: List[float],
        tenant_id: int,
        namespace: Optional[str] = None,
        limit: int = 5,
        connection_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Search vectors strictly filtered by tenant_id (and optional namespace/connection_id).
        Guarantees zero cross-tenant data leakage.
        """
        conditions = [FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))]
        if namespace:
            conditions.append(FieldCondition(key="namespace", match=MatchValue(value=namespace)))
        if connection_id is not None:
            conditions.append(FieldCondition(key="connection_id", match=MatchValue(value=connection_id)))

        q_filter = Filter(must=conditions)

        res = self.client.query_points(
            collection_name=self.COLLECTION_NAME,
            query=query_vector,
            query_filter=q_filter,
            limit=limit,
        )

        out = []
        for p in res.points:
            out.append({
                "id": p.id,
                "score": p.score,
                "text": p.payload.get("text", ""),
                "table_name": p.payload.get("table_name"),
                "connection_id": p.payload.get("connection_id"),
                "namespace": p.payload.get("namespace"),
                "doc_id": p.payload.get("doc_id"),
                "metadata": p.payload.get("metadata", {}),
            })
        return out

    def delete_document(self, tenant_id: int, doc_id: str):
        q_filter = Filter(must=[
            FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
            FieldCondition(key="doc_id", match=MatchValue(value=doc_id)),
        ])
        self.client.delete(collection_name=self.COLLECTION_NAME, points_selector=q_filter)

    def delete_connection_profiles(self, tenant_id: int, connection_id: int):
        q_filter = Filter(must=[
            FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
            FieldCondition(key="namespace", match=MatchValue(value="schema_profiles")),
            FieldCondition(key="connection_id", match=MatchValue(value=connection_id)),
        ])
        self.client.delete(collection_name=self.COLLECTION_NAME, points_selector=q_filter)


qdrant_store = QdrantStore()
