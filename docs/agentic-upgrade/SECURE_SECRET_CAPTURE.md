# SECURE_SECRET_CAPTURE.md
## Secure Credential Capture & Secret Boundary Specification

**Objective:** Zero-leakage policy for database passwords, API keys, and secret credentials across voice transcripts, LLM prompts, RAG indexes, logs, SSE events, and TTS speech.

---

### 1. Threat Model & Protected Boundaries

| Vector | Leakage Risk | Guardrail / Protection |
|---|---|---|
| **Voice Audio & Speech-to-Text** | Spoken passwords transcribed into plain text | Client-side redactor detects sensitive credential patterns and isolates them before LLM dispatch. User can opt for masked manual input. |
| **LLM Prompts** | Database password sent to model provider | Password slots are flagged as `is_secret: true`. They are omitted from LLM prompts and replaced with sentinel `<CREDENTIAL_CAPTURED>`. |
| **RAG Embeddings / Vector Store** | Passwords indexed in vector documents | Vector ingestion pipeline strictly validates and skips files or fields containing credentials. |
| **Server-Sent Events (SSE)** | Secrets broadcast to browser live stream | Event payloads contain only sanitized summaries and resource IDs; secrets are stripped before serialization. |
| **Application & Job Logs** | Passwords printed in Laravel/FastAPI logs | `Request::except(['password', 'api_key', 'token'])` applied; database passwords encrypted at rest via AES-256 (`Crypt::encryptString`). |
| **TTS Speech Audio** | Mascot reads aloud the user's password | Spoken synthesis templates strictly exclude credential values; only status (e.g. "Credentials securely received") is spoken. |

---

### 2. Secure Capture Flow

1. **Detection:** When the user initiates a connection or provider setup, the agent identifies that a password or key is required.
2. **Channel Isolation:**
   - If the user enters credentials via the masked UI card or form, the data is encrypted in transit and sent directly to the authenticated endpoint `POST /api/connections` or `POST /api/agent/conversations/{id}/messages` with `secure_input_data`.
   - If spoken via voice, the client-side redactor strips the password from the conversational text field and places it into `secureInputData: { password: ... }`.
3. **Storage at Rest:** Laravel encrypts the password using `Illuminate\Support\Facades\Crypt`.
4. **Clean Reset:** When the task completes or is cancelled, temporary secret references in memory are purged.
