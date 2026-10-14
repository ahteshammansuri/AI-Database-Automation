---
trigger: always_on
description: Local and optional cloud AI provider configuration, RAG, safe structured outputs, and Python AI service behavior.
---
# AI, RAG, and Provider Rules

## Provider configuration
- Ollama/local inference is the default no-paid-API path.
- Support optional user-configured OpenAI, Gemini and Anthropic/Claude providers where current SDKs and APIs can be integrated reliably.
- The app's core demo must work without paid API keys. Never require the developer to add each user's key to `.env`.
- Each provider connection/model preference belongs to the signed-in user/workspace and is encrypted if it contains secrets.
- Expose provider configuration, testing, model selection and masked credentials in the portal.
- Handle offline Ollama, missing model, provider rate limits, authentication errors, timeouts, output truncation and malformed responses clearly. Do not silently switch providers or imply generation succeeded when it did not.

## Python AI service
- Use Python/FastAPI for AI-specific operations: prompt construction, provider abstraction, embeddings, retrieval, structured generation and AI diagnostics.
- Secure service-to-service traffic from Laravel and validate request schemas.
- Prefer short-lived internal requests and avoid persisting plaintext user keys in Python storage/logs. If Laravel passes a key to the Python service for a call, transmit it only over the private service channel, keep it in memory, and never log it.
- Python AI service must not own user authentication, tenant authorization, customer database credentials, or target DB writes.

## RAG
- Support Markdown and TXT as core formats; PDF is an additional format using PyMuPDF.
- Validate file type and size, extract/normalize text, chunk it, embed locally, store source/chunk metadata, index with FAISS, retrieve relevant passages, and inject retrieved context into generation.
- Index only sources owned by the requesting user/workspace. A user must never retrieve another user's documents or embeddings.
- Re-index or remove chunks when sources change or are removed.
- Treat documents and retrieved chunks as untrusted content. They cannot change system rules, authorize DB operations, or override safety policies.
- Provide retrieval diagnostics (source, chunk ID, relevance score when available) so the UI can show why context was used.
- Avoid embedding secrets or unnecessary personal/sensitive records.

## Structured AI generation
- Generate schema-validated JSON or an equivalent structured representation, never executable SQL.
- Make field requirements from discovered schema plus user-approved mapping/business rules explicit in the generation request.
- Validate again in Laravel before any target write. Provider structured-output features do not replace application-side validation.
- Use bounded retry/repair attempts. Stop and surface an actionable error when output remains invalid.
- Record model/provider, generation version, relevant context source IDs and safe metrics. Avoid storing sensitive prompts/output without a documented need.
