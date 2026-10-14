from typing import List, Dict, Any


def chunk_text(
    text: str,
    chunk_size: int = 600,
    chunk_overlap: int = 120
) -> List[Dict[str, Any]]:
    """
    Split text into overlapping chunks respecting paragraph or sentence boundaries where practical.
    Returns list of dicts with chunk_index and content.
    """
    if not text.strip():
        return []

    # If text is smaller than chunk size, return single chunk
    if len(text) <= chunk_size:
        return [{"chunk_index": 0, "content": text.strip()}]

    paragraphs = text.split("\n\n")
    chunks: List[Dict[str, Any]] = []
    current_chunk = ""
    chunk_idx = 0

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # If adding this paragraph exceeds chunk size and current_chunk is not empty
        if len(current_chunk) + len(para) + 2 > chunk_size and len(current_chunk) > 0:
            chunks.append({
                "chunk_index": chunk_idx,
                "content": current_chunk.strip()
            })
            chunk_idx += 1

            # Prepare overlap from end of current chunk
            overlap_text = current_chunk[-chunk_overlap:] if len(current_chunk) >= chunk_overlap else current_chunk
            # Find nearest space in overlap to avoid word break
            space_pos = overlap_text.find(" ")
            if space_pos != -1:
                overlap_text = overlap_text[space_pos:].strip()
            current_chunk = overlap_text + "\n\n" + para
        else:
            if current_chunk:
                current_chunk += "\n\n" + para
            else:
                current_chunk = para

    # Append any remaining chunk
    if current_chunk.strip():
        chunks.append({
            "chunk_index": chunk_idx,
            "content": current_chunk.strip()
        })

    return chunks
