import time
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.schemas.ai import (
    AIProviderInfo, AITestRequest, AITestResponse, AIPreviewRequest, AIPreviewResponse
)
from backend.app.ai.factory import get_all_providers_info, get_ai_provider
from backend.app.rag.service import RAGService

router = APIRouter(prefix="/ai", tags=["AI Providers & Structured Generation"])


@router.get("/providers", response_model=List[AIProviderInfo])
def list_providers():
    return get_all_providers_info()


@router.post("/test", response_model=AITestResponse)
def test_provider(payload: AITestRequest):
    provider = get_ai_provider(payload.provider_id)
    check = provider.test_connection()
    models = provider.list_models()
    selected_model = payload.model or (models[0] if models else "default")

    return AITestResponse(
        success=check.get("available", False),
        provider_id=payload.provider_id,
        model=selected_model,
        message=check.get("message", ""),
        latency_ms=check.get("latency_ms")
    )


@router.post("/preview-generate", response_model=AIPreviewResponse)
def preview_generation(payload: AIPreviewRequest, db: Session = Depends(get_db)):
    start_time = time.time()
    # 1. Retrieve RAG context if document IDs provided
    context_chunks = []
    if payload.context_document_ids:
        matches = RAGService.retrieve_context_for_prompt(
            query=payload.topic,
            top_k=3,
            document_ids=payload.context_document_ids
        )
        context_chunks = [m["content"] for m in matches]

    # 2. Build prompt
    prompt = f"Topic: {payload.topic}\nTone: {payload.tone}\nTarget Audience: Technical audience and developers.\n"
    if context_chunks:
        prompt += "\nRelevant Business Context / Guidelines:\n" + "\n---\n".join(context_chunks)

    system_prompt = f"You are a professional technical content generator for an automated database publishing platform. You generate high quality records for the '{payload.target_table}' table."

    provider = get_ai_provider()
    try:
        structured_data = provider.generate_structured_data(
            prompt=prompt,
            system_prompt=system_prompt,
            target_table=payload.target_table,
            required_fields=payload.fields
        )
        duration_ms = round((time.time() - start_time) * 1000, 2)
        return AIPreviewResponse(
            success=True,
            generated_data=structured_data,
            retrieved_chunks=context_chunks,
            generation_duration_ms=duration_ms
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")
