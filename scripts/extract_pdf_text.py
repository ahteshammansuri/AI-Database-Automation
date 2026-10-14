#!/usr/bin/env python3
import sys
import os

if len(sys.argv) < 2:
    sys.stderr.write("Usage: extract_pdf_text.py <path_to_pdf>\n")
    sys.exit(1)

file_path = sys.argv[1]
if not os.path.exists(file_path):
    sys.stderr.write(f"File not found: {file_path}\n")
    sys.exit(1)

try:
    try:
        import pymupdf as fitz
    except ImportError:
        import fitz

    doc = fitz.open(file_path)
    pages = []
    for page in doc:
        text = page.get_text("text")
        if text:
            pages.append(text.strip())
    
    extracted = "\n\n".join(pages)
    sys.stdout.write(extracted)
    sys.exit(0)
except Exception as e:
    sys.stderr.write(f"PDF extraction error: {str(e)}\n")
    sys.exit(1)
