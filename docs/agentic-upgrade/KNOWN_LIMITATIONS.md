# KNOWN_LIMITATIONS.md
## Known Limitations & Boundaries

1. **Local Model Inference Speed:**
   - Inference latency depends on local CPU/GPU hardware. `llama3.2:1b` is prioritized for lightweight, fast responses (~1-2 seconds), whereas `llama3:latest` (8B) may require 4-8 seconds on CPU.
2. **First Target Engine:**
   - MySQL is the production-ready target engine. PostgreSQL, MSSQL, and MongoDB connectors are staged for future releases and flagged as `coming_soon`.
3. **Web Speech API Browser Support:**
   - The primary voice recognition and speech synthesis rely on standard browser Web Speech APIs (`webkitSpeechRecognition` / `SpeechRecognition` and `speechSynthesis`). In headless or unsupported browsers, the HUD automatically renders the accessible text command input.
4. **Customer Database Safety:**
   - The platform strictly enforces zero destructive customer SQL (`DELETE`, `DROP`, `TRUNCATE`, `ALTER`). Automated workflows cannot execute destructive DDL/DML under any circumstance.
