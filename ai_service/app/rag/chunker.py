import re
from typing import List, Dict, Any


class TextChunker:
    """Splits normalized text into overlapping chunks for semantic retrieval."""

    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 100):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk_text(self, text: str, document_id: int) -> List[Dict[str, Any]]:
        if not text:
            return []

        # Split into logical paragraphs first
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        chunks = []
        current_chunk = ""
        chunk_idx = 0

        for para in paragraphs:
            if len(current_chunk) + len(para) + 2 <= self.chunk_size:
                current_chunk = f"{current_chunk}\n\n{para}".strip()
            else:
                if current_chunk:
                    chunks.append({
                        "chunk_id": f"doc_{document_id}_chk_{chunk_idx}",
                        "document_id": document_id,
                        "chunk_index": chunk_idx,
                        "text": current_chunk
                    })
                    chunk_idx += 1

                # If paragraph itself is larger than chunk_size, split by sentences
                if len(para) > self.chunk_size:
                    sentences = re.split(r"(?<=[.!?])\s+", para)
                    sub_chunk = ""
                    for sent in sentences:
                        if len(sub_chunk) + len(sent) + 1 <= self.chunk_size:
                            sub_chunk = f"{sub_chunk} {sent}".strip()
                        else:
                            if sub_chunk:
                                chunks.append({
                                    "chunk_id": f"doc_{document_id}_chk_{chunk_idx}",
                                    "document_id": document_id,
                                    "chunk_index": chunk_idx,
                                    "text": sub_chunk
                                })
                                chunk_idx += 1
                            sub_chunk = sent
                    current_chunk = sub_chunk
                else:
                    current_chunk = para

        if current_chunk:
            chunks.append({
                "chunk_id": f"doc_{document_id}_chk_{chunk_idx}",
                "document_id": document_id,
                "chunk_index": chunk_idx,
                "text": current_chunk
            })

        return chunks


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)


def chunk_markdown_by_heading(text: str, document_id: int, chunk_size: int = 900, overlap: int = 150) -> List[Dict[str, Any]]:
    """
    Split Markdown into chunks that never cross a heading boundary. Each chunk keeps the
    heading path (e.g. "6. Database connection behavior") so retrieved snippets stay
    attributable. Long sections are windowed with overlap.
    """
    if not text:
        return []
    matches = list(_HEADING_RE.finditer(text))
    sections = []
    if not matches or matches[0].start() > 0:
        end = matches[0].start() if matches else len(text)
        sections.append(("", text[:end]))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sections.append((m.group(2).strip(), text[m.end():end]))

    chunks: List[Dict[str, Any]] = []
    for heading, body in sections:
        body = body.strip()
        if not body:
            continue
        start = 0
        while start < len(body):
            window = body[start:start + chunk_size]
            if start + chunk_size < len(body):
                cut = window.rfind("\n")
                if cut > chunk_size // 2:
                    window = window[:cut]
            idx = len(chunks)
            chunks.append({
                "chunk_id": f"doc_{document_id}_chk_{idx}",
                "document_id": document_id,
                "chunk_index": idx,
                "heading": heading,
                "text": (f"{heading}\n{window.strip()}" if heading else window.strip()),
            })
            if start + len(window) >= len(body):
                break
            start += max(len(window) - overlap, 1)
    return chunks
