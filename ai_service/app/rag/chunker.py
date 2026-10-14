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
