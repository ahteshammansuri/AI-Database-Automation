import os
import re
from typing import Tuple
import pymupdf  # fitz


class DocumentParseError(Exception):
    pass


def parse_document(file_path: str, file_type: str) -> str:
    """
    Extracts text from Markdown (.md), plain text (.txt), and PDF (.pdf).
    Returns normalized extracted text string.
    """
    if not os.path.exists(file_path):
        raise DocumentParseError(f"File not found: {file_path}")

    ext = file_type.lower().strip().replace(".", "")

    if ext in ["md", "markdown", "txt"]:
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return normalize_text(content)
        except Exception as e:
            raise DocumentParseError(f"Failed to read text file: {str(e)}")

    elif ext == "pdf":
        try:
            doc = pymupdf.open(file_path)
            extracted_pages = []
            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text("text")
                if text.strip():
                    extracted_pages.append(f"--- Page {page_num + 1} ---\n{text}")
            doc.close()
            full_text = "\n\n".join(extracted_pages)
            return normalize_text(full_text)
        except Exception as e:
            raise DocumentParseError(f"Failed to parse PDF file with PyMuPDF: {str(e)}")

    else:
        raise DocumentParseError(f"Unsupported document format: .{ext}. Allowed formats: .md, .txt, .pdf")


def normalize_text(text: str) -> str:
    """Normalize excess whitespace while preserving paragraph structure."""
    # Replace carriage returns
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Normalize excessive vertical spaces to max 2 newlines
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Strip trailing whitespace on each line
    lines = [line.strip() for line in text.split("\n")]
    return "\n".join(lines).strip()
