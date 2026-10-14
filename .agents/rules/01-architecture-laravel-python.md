---
trigger: always_on
description: Required stack boundaries and responsibilities across Laravel, React, and Python AI services.
---
# Architecture Rules: Laravel + React + Python AI Service

## Required responsibility split
- **Laravel** owns user authentication, authorization, resource ownership, platform-domain models, encrypted user settings, customer DB connection records, schema discovery orchestration, automation configuration, job dispatch, scheduling, approval decisions, mail delivery, safe target-database writes, and audit logs.
- **React + TypeScript** owns public landing/service page and authenticated product UI. All protected data/actions go through authenticated backend APIs; never place secrets or database credentials in frontend code.
- **Python + FastAPI** owns AI-specific capabilities: provider adapters, prompt/context assembly, local Ollama integration, optional LLM provider adapters where appropriate, embeddings, chunking, RAG retrieval, structured-output normalization, and AI service health/diagnostics.
- Keep the AI service private to the application environment. Authenticate service-to-service requests. Do not expose provider keys in Python logs or responses.
- The Python AI service must not connect directly to customer databases or independently execute SQL. Laravel calls it for validated AI capabilities and then applies its own policy before a write.

## Stack choices
- Use a currently supported Laravel version and verify compatibility with the installed PHP environment before selecting dependencies.
- React + TypeScript + Vite is the default frontend unless the existing repo has a justified working equivalent.
- Use MySQL for the first target/customer database. Use a platform-owned database for app persistence; platform and target connection configurations must be distinct even if both happen to use MySQL locally.
- Use Laravel's persisted queue/scheduler for app jobs. A database queue may be used for a simpler local demo; Redis can be optional. Configure worker and scheduler startup explicitly.
- Python AI service uses FastAPI, Pydantic, suitable local embedding packages, and FAISS where useful. Keep interfaces small and testable.

## Integration standards
- Define versioned and documented request/response schemas between Laravel and Python.
- Set service timeouts, bounded retries, structured errors, request correlation IDs and health checks.
- Never retry unsafe database writes without checking idempotency.
- Keep configuration centralized and typed; validate at startup.
- Do not duplicate automation business rules in React and Python.
- Avoid microservices beyond the Laravel application and the AI service in the 80-hour MVP unless strongly justified.

## Decision protocol
Inspect the existing workspace before choosing versions, libraries or folder structure. Record material decisions and alternatives in `docs/DECISIONS.md`. If an implementation requirement seems easier in Python, keep that code in the AI service unless it is strictly AI-related and requires control-plane authorization, scheduling, credentials, user tenancy or database execution; those remain in Laravel.
