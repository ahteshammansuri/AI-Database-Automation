"""
Image generation for content automations.

Providers:
  - "openai": OpenAI Images API (gpt-image-1 by default) with the user's own key.
  - "gemini": Gemini native image generation (gemini-2.5-flash-image by default) with the user's key.
  - "local":  a designed cover rendered on this machine with Pillow. It is not an AI painting: it is a
              typographic cover (title, category, palette derived from the topic). Free, offline, no key.

Every result is re-encoded and cropped to the exact pixel size the target column needs, so what is
stored is always a valid image of a known type and size. Nothing here touches customer databases.
"""
import base64
import hashlib
import io
import os
import random
from typing import Any, Dict, List, Optional, Tuple

import httpx
import numpy as np

try:  # Pillow is required for the local renderer and for normalising provider output.
    from PIL import Image, ImageDraw, ImageFont, ImageOps
except Exception:  # pragma: no cover - surfaced as a clear error at call time
    Image = None  # type: ignore

OPENAI_DEFAULT_MODEL = "gpt-image-1"
GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-image"
LOCAL_MODEL = "designed-cover-v1"

_PALETTES: List[Tuple[str, str, str]] = [
    ("#1e1b4b", "#4f46e5", "#c7d2fe"),  # indigo
    ("#042f2e", "#0f766e", "#99f6e4"),  # teal
    ("#2e1065", "#7c3aed", "#ddd6fe"),  # violet
    ("#431407", "#c2410c", "#fed7aa"),  # orange
    ("#082f49", "#0369a1", "#bae6fd"),  # sky
    ("#052e16", "#15803d", "#bbf7d0"),  # green
    ("#4c0519", "#be123c", "#fecdd3"),  # rose
    ("#1c1917", "#44403c", "#e7e5e4"),  # stone
]

_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/opentype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


class ImageGenerationError(Exception):
    pass


# ----------------------------------------------------------------------------
# Public entry point
# ----------------------------------------------------------------------------

def generate_image(
    provider: str,
    prompt: str,
    width: int,
    height: int,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    title: Optional[str] = None,
    label: Optional[str] = None,
    seed: Optional[str] = None,
) -> Dict[str, Any]:
    if Image is None:
        raise ImageGenerationError("Pillow is not installed in the AI service (pip install Pillow).")

    width = max(256, min(2048, int(width)))
    height = max(256, min(2048, int(height)))
    provider = (provider or "local").lower()

    if provider == "openai":
        raw, model_used, revised = _openai_image(api_key or "", model or OPENAI_DEFAULT_MODEL, prompt, width, height)
        img_bytes, mime = _fit(raw, width, height, "JPEG")
        return _result("openai", model_used, img_bytes, mime, width, height, revised)

    if provider == "gemini":
        raw, model_used = _gemini_image(api_key or "", model or GEMINI_DEFAULT_MODEL, prompt, width, height)
        img_bytes, mime = _fit(raw, width, height, "JPEG")
        return _result("gemini", model_used, img_bytes, mime, width, height, None)

    if provider in ("local", "mock"):
        img_bytes = render_cover(title or prompt[:120], label, width, height, seed or (title or prompt))
        return _result("local", LOCAL_MODEL, img_bytes, "image/png", width, height, None)

    raise ImageGenerationError(f"Unknown image provider '{provider}'. Use openai, gemini or local.")


def _result(provider: str, model: str, data: bytes, mime: str, w: int, h: int, revised: Optional[str]) -> Dict[str, Any]:
    return {
        "provider_used": provider,
        "model_used": model,
        "mime_type": mime,
        "width": w,
        "height": h,
        "image_base64": base64.b64encode(data).decode("ascii"),
        "revised_prompt": revised,
        "bytes": len(data),
    }


# ----------------------------------------------------------------------------
# Remote providers
# ----------------------------------------------------------------------------

def _openai_size(model: str, w: int, h: int) -> str:
    ratio = w / h
    if model.startswith("dall-e-3"):
        return "1792x1024" if ratio > 1.2 else ("1024x1792" if ratio < 0.83 else "1024x1024")
    if model.startswith("dall-e-2"):
        return "1024x1024"
    return "1536x1024" if ratio > 1.2 else ("1024x1536" if ratio < 0.83 else "1024x1024")


def _openai_image(api_key: str, model: str, prompt: str, w: int, h: int) -> Tuple[bytes, str, Optional[str]]:
    if not api_key.strip():
        raise ImageGenerationError("OpenAI image generation needs your OpenAI API key (AI Providers page).")
    body: Dict[str, Any] = {"model": model, "prompt": prompt[:3900], "n": 1, "size": _openai_size(model, w, h)}
    if model.startswith("dall-e"):
        body["response_format"] = "b64_json"
    else:
        body["quality"] = "medium"
    try:
        with httpx.Client(timeout=180.0) as client:
            res = client.post(
                "https://api.openai.com/v1/images/generations",
                headers={"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"},
                json=body,
            )
    except httpx.HTTPError as e:
        raise ImageGenerationError(f"OpenAI images API is not reachable ({type(e).__name__}).")
    if res.status_code != 200:
        raise ImageGenerationError(f"OpenAI images API returned HTTP {res.status_code}: {_error_detail(res)}")
    data = (res.json().get("data") or [{}])[0]
    b64 = data.get("b64_json")
    if not b64:
        raise ImageGenerationError("OpenAI returned no image data.")
    return base64.b64decode(b64), model, data.get("revised_prompt")


def _gemini_image(api_key: str, model: str, prompt: str, w: int, h: int) -> Tuple[bytes, str]:
    if not api_key.strip():
        raise ImageGenerationError("Gemini image generation needs your Gemini API key (AI Providers page).")
    ratio = w / h
    aspect = "16:9" if ratio > 1.5 else ("3:2" if ratio > 1.2 else ("1:1" if ratio > 0.83 else "2:3"))
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key.strip()}
    attempts = [
        {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect}},
        {"responseModalities": ["TEXT", "IMAGE"]},
    ]
    last_error = "no response"
    for gen_cfg in attempts:
        payload = {"contents": [{"parts": [{"text": prompt[:3900]}]}], "generationConfig": gen_cfg}
        try:
            with httpx.Client(timeout=180.0) as client:
                res = client.post(url, headers=headers, json=payload)
        except httpx.HTTPError as e:
            raise ImageGenerationError(f"Gemini API is not reachable ({type(e).__name__}).")
        if res.status_code == 400:
            last_error = _error_detail(res)
            continue  # older models reject imageConfig; retry with the minimal config
        if res.status_code != 200:
            raise ImageGenerationError(f"Gemini returned HTTP {res.status_code}: {_error_detail(res)}")
        for cand in res.json().get("candidates", []) or []:
            for part in (cand.get("content") or {}).get("parts", []) or []:
                inline = part.get("inlineData") or part.get("inline_data")
                if inline and inline.get("data"):
                    return base64.b64decode(inline["data"]), model
        last_error = "the model returned text but no image"
    raise ImageGenerationError(f"Gemini did not produce an image ({last_error}).")


def _error_detail(res: httpx.Response) -> str:
    try:
        err = res.json().get("error", {})
        return str(err.get("message") or err)[:240]
    except Exception:
        return res.text[:240]


def _fit(raw: bytes, w: int, h: int, fmt: str) -> Tuple[bytes, str]:
    """Decode provider output, centre-crop to exactly w x h, re-encode (strips metadata)."""
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise ImageGenerationError("The provider returned data that is not a valid image.")
    img = img.convert("RGB")
    img = ImageOps.fit(img, (w, h), Image.LANCZOS, centering=(0.5, 0.5))
    out = io.BytesIO()
    img.save(out, format=fmt, quality=88, optimize=True)
    return out.getvalue(), "image/jpeg" if fmt == "JPEG" else "image/png"


# ----------------------------------------------------------------------------
# Local designed cover
# ----------------------------------------------------------------------------

def _hex(c: str) -> Tuple[int, int, int]:
    c = c.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def _font(size: int):
    for path in _FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    try:
        return ImageFont.load_default(size=size)  # Pillow >= 10.1 ships a scalable default font
    except TypeError:
        return ImageFont.load_default()


def _wrap(draw, text: str, font, max_width: int) -> List[str]:
    words = text.split()
    lines: List[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def render_cover(title: str, label: Optional[str], width: int, height: int, seed: str) -> bytes:
    """Typographic cover: palette and shapes derived from the topic, title set large and wrapped."""
    digest = hashlib.sha256((seed or title or "cover").encode("utf-8")).hexdigest()
    rng = random.Random(int(digest[:12], 16))
    dark, mid, light = (_hex(c) for c in _PALETTES[int(digest[12:14], 16) % len(_PALETTES)])

    # Smooth diagonal gradient background (dark top-left to mid bottom-right)
    xs = np.linspace(0.0, 1.0, width, dtype=np.float32)[None, :]
    ys = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]
    t = np.clip(xs * 0.62 + ys * 0.38, 0.0, 1.0) ** 1.35
    d = np.array(dark, dtype=np.float32)
    m = np.array(mid, dtype=np.float32)
    arr = d[None, None, :] * (1.0 - t[..., None]) + m[None, None, :] * t[..., None]
    base = Image.fromarray(arr.astype(np.uint8), "RGB")

    # Soft circles and a dot grid for depth
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for _ in range(4):
        r = rng.randint(int(min(width, height) * 0.25), int(min(width, height) * 0.7))
        cx = rng.randint(int(width * 0.45), width + r // 3)
        cy = rng.randint(-r // 3, height)
        od.ellipse((cx - r, cy - r, cx + r, cy + r), fill=light + (rng.randint(14, 34),))
    step = max(18, width // 48)
    for gx in range(int(width * 0.62), width - step, step):
        for gy in range(step, int(height * 0.38), step):
            od.ellipse((gx - 1.5, gy - 1.5, gx + 1.5, gy + 1.5), fill=light + (60,))
    img = Image.alpha_composite(base.convert("RGBA"), overlay)
    draw = ImageDraw.Draw(img)

    margin = int(width * 0.07)
    max_text_w = int(width * (0.80 if width >= height else 0.86))

    # Title: largest size that fits in 4 lines
    title = " ".join((title or "Untitled").split())
    size = int(height * (0.11 if width >= height else 0.085))
    min_size = max(14, int(height * 0.045))
    font = _font(size)
    lines = _wrap(draw, title, font, max_text_w)
    while (len(lines) > 4) and size > min_size:
        size -= 2
        font = _font(size)
        lines = _wrap(draw, title, font, max_text_w)
    if len(lines) > 4:
        lines = lines[:4]
        lines[-1] = lines[-1].rstrip(" ,.;:") + "…"
    line_h = int(size * 1.18)
    block_h = line_h * len(lines)
    top = int(height * 0.56) - block_h // 2

    # Category chip
    if label:
        chip_font = _font(max(12, int(size * 0.32)))
        chip_text = label.upper()[:40]
        tw = draw.textlength(chip_text, font=chip_font)
        pad_x, pad_y = int(size * 0.28), int(size * 0.14)
        chip_h = int(size * 0.32) + 2 * pad_y
        chip_y = max(margin // 2, top - chip_h - int(size * 0.45))
        draw.rounded_rectangle(
            (margin, chip_y, margin + tw + 2 * pad_x, chip_y + chip_h),
            radius=chip_h // 2,
            fill=light + (235,),
        )
        draw.text((margin + pad_x, chip_y + pad_y - 1), chip_text, font=chip_font, fill=dark + (255,))

    for i, line in enumerate(lines):
        draw.text((margin, top + i * line_h), line, font=font, fill=(255, 255, 255, 255))

    bar_y = top + block_h + int(size * 0.35)
    draw.rounded_rectangle((margin, bar_y, margin + int(width * 0.12), bar_y + max(4, size // 9)), radius=4, fill=light + (255,))

    out = io.BytesIO()
    img.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()
