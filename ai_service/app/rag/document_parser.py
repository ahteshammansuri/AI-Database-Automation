import os
import re
from typing import Tuple


class DocumentParser:
    """Extracts raw text from Markdown, TXT, and PDF files."""

    @staticmethod
    def parse_file(file_path: str) -> Tuple[str, str]:
        """
        Returns (extracted_text, detected_format).
        Supports .md, .txt, and .pdf using PyMuPDF.
        """
        ext = os.path.splitext(file_path)[1].lower()

        if ext in [".md", ".markdown"]:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return DocumentParser._normalize_text(content), "markdown"

        elif ext in [".txt"]:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return DocumentParser._normalize_text(content), "text"

        elif ext in [".pdf"]:
            import fitz  # PyMuPDF
            doc = fitz.open(file_path)
            pages = []
            for page in doc:
                pages.append(page.get_text("text"))
            full_text = "\n\n".join(pages)
            return DocumentParser._normalize_text(full_text), "pdf"

        else:
            raise ValueError(f"Unsupported file format '{ext}'. Allowed: .md, .txt, .pdf")

    @staticmethod
    def parse_string(content: str, file_type: str = "txt") -> Tuple[str, str]:
        return DocumentParser._normalize_text(content), file_type

    @staticmethod
    def _normalize_text(text: str) -> str:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()
