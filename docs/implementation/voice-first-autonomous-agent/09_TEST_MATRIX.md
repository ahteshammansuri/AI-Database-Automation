# Test Matrix: Verification & Acceptance Scenarios

## 1. Automated Test Suites

| Suite | Category | Scope & Expected Outcome |
|---|---|---|
| `laravel/tests/Feature/AgentAutonomousActionTest.php` | Backend Unit & Feature | Zero destructive tools in registry, conversation lifecycle, masked credential handling, automation creation, instant stop interrupts, tenant isolation & IDOR blocks. |
| `tests/test_security_guardrails.py` | Python Security | Guardrail interceptor blocks DROP, TRUNCATE, ALTER, raw SQL console requests. |
| `tests/test_connectors.py` | Connector Safety | MySQL connection handshake, SSRF validation, metadata queries only. |
| `scripts/verify_autonomous_agent.py` | End-to-End Orchestration | 10 phases validating real user sessions, masked secret inputs, schema introspection, mid-task correction, and safety checks. |
| `scripts/verify_end_to_end.py` | Full Vertical Slice | 12 phases validating registration, connection, schema inspection, content generation, signed email approval, MySQL port 3308 writes, and post-publish updates. |

## 2. Frontend & UX Verification Scenarios

| Scenario ID | Test Name | Expected Visual & Behavioral Result |
|---|---|---|
| **UX-01** | Mascot Idle & Footprint | 60px floating core at bottom-right, gentle breathing glow, blinking eyes, unobtrusive. |
| **UX-02** | Zero Chatbot Interface | No text textarea, no send button, no canned preset chips, no large chat drawer. |
| **UX-03** | Push-and-Hold Voice | Pressing mascot triggers `activation` -> `listening`, visualizer pulses, release stops and transcribes. |
| **UX-04** | Spoken Summary & TTS | Browser speaks concise summary; transient caption appears; mute button silences audio. |
| **UX-05** | Mascot Travel to Connections | Requesting DB connection routes to `/connections`, mascot glides to form anchor, highlights card. |
| **UX-06** | Masked Credential Card | Missing credentials prompts focused `SecureCredentialCard`; password masked on entry. |
| **UX-07** | Mascot Travel to Schema | Asking schema question routes to `/explorer`, mascot glides to table anchor, displays results. |
| **UX-08** | Interruption & Stop | Clicking Stop or speaking "Stop" halts active step, mascot transitions to `cancelled`/`idle`. |
| **UX-09** | Reduced Motion Mode | When system reduced motion is enabled, orbital spin stops and travel becomes instant fade. |
| **UX-10** | Mobile Responsive | Layout adjusts safely on mobile viewports; touch toggle works smoothly. |
