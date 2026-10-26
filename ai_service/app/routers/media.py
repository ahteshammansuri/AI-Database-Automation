import time
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ai_service.app import usage
from ai_service.app.services.image_generation import ImageGenerationError, generate_image

router = APIRouter(prefix="/v1/ai", tags=["Media"])


class GenerateImageRequest(BaseModel):
    provider: str = Field(default="local", description="openai, gemini or local")
    api_key: Optional[str] = Field(default=None, description="User's own provider key (never stored here)")
    model: Optional[str] = None
    prompt: str = Field(..., max_length=6000)
    width: int = Field(default=1600, ge=256, le=2048)
    height: int = Field(default=900, ge=256, le=2048)
    title: Optional[str] = Field(default=None, max_length=300, description="Text for the local designed cover")
    label: Optional[str] = Field(default=None, max_length=80, description="Category chip for the local cover")
    seed: Optional[str] = Field(default=None, max_length=300)


class GenerateImageResponse(BaseModel):
    success: bool
    provider_used: str
    model_used: Optional[str] = None
    mime_type: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    image_base64: Optional[str] = None
    revised_prompt: Optional[str] = None
    latency_seconds: float = 0.0
    error: Optional[str] = None


@router.post("/generate-image", response_model=GenerateImageResponse)
def generate_image_endpoint(req: GenerateImageRequest):
    start = time.time()
    try:
        result = generate_image(
            provider=req.provider,
            prompt=req.prompt,
            width=req.width,
            height=req.height,
            api_key=req.api_key,
            model=req.model,
            title=req.title,
            label=req.label,
            seed=req.seed,
        )
        if result["provider_used"] in ("openai", "gemini"):
            usage.record(result["provider_used"], result.get("model_used"), kind="image")
        return GenerateImageResponse(
            success=True,
            provider_used=result["provider_used"],
            model_used=result["model_used"],
            mime_type=result["mime_type"],
            width=result["width"],
            height=result["height"],
            image_base64=result["image_base64"],
            revised_prompt=result.get("revised_prompt"),
            latency_seconds=round(time.time() - start, 3),
        )
    except ImageGenerationError as e:
        return GenerateImageResponse(success=False, provider_used=req.provider, error=str(e), latency_seconds=round(time.time() - start, 3))
    except Exception as e:  # never leak a stack trace to the caller
        return GenerateImageResponse(
            success=False,
            provider_used=req.provider,
            error=f"Image generation failed: {type(e).__name__}: {str(e)[:200]}",
            latency_seconds=round(time.time() - start, 3),
        )
