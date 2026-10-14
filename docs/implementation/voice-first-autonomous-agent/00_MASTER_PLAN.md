# Master Plan: Voice-First Autonomous Mascot AI Agent

## 1. Executive Summary & Mission
This project upgrades the AI Database Automation Platform by replacing the conventional right-side chat-panel assistant ("Orbital AI Assistant" with text input, send button, canned suggestion chips, and large conversation history) with an original, polished, animated, voice-first AI mascot character ("Aura Core").

Aura Core floats at the bottom-right of the portal, listens to natural spoken language via microphone, speaks back with natural speech synthesis, and physically travels across the portal to relevant sections, pages, and forms while executing verified operations on the user's behalf.

## 2. Core Architecture
- **Control Plane & Execution Layer (Laravel 11)**:
  - Authority for authentication, tenant isolation, database connection management, dynamic tool execution, execution locks, idempotency, safety policies, and audit logs.
  - Zero raw SQL execution, zero customer-database destructive queries (DELETE, DROP, TRUNCATE, ALTER).
  - All operations persist in the platform database with per-user scoping.
- **AI Inference & Semantic Planning (Python 3.12 / FastAPI)**:
  - Host for Ollama / local LLM integration and provider adapters.
  - Open-ended semantic planning: translates user intent into registered tool workflows without hardcoded command prefixes.
- **Voice-First Frontend Portal (React 19 + TypeScript + Vite + Framer Motion)**:
  - Floating autonomous mascot with 17 distinct visual states.
  - Interactive Travelling Mascot engine that animates coordinates across portal routes and UI anchors.
  - Compact, non-chat Operational HUD: transient speech captions, real-time step progress, pause/stop controls, and secure focused input cards.
  - Web Speech API integration (voice recognition + speech synthesis) with push-and-hold and tap toggle.
  - Absolutely NO text chat composer, NO send button, NO canned suggestion chips, and NO large chat sidebar.

## 3. Non-Goals
- We are NOT rebuilding the application from scratch; existing working Laravel endpoints, synthetic test databases, queues, and pages are preserved.
- We are NOT creating a text chatbot hidden under a mascot icon.
- We are NOT allowing arbitrary or AI-generated SQL execution against target databases.
- We are NOT storing or transmitting customer passwords/keys in plaintext or echoing them through TTS.

## 4. Phase Order & Dependencies
- **Task 0: Audit and Baseline**: Inspect codebase, verify test baseline, document anti-patterns.
- **Task 1: Architecture & State Specification**: Formalize 17-state machine, travel coordinates, and capability contracts.
- **Task 2: Original Mascot Character & Compact HUD**: Implement Aura Core with Framer Motion, 17 states, and replace the chat drawer with a compact HUD.
- **Task 3: Voice Lifecycle & Speech Synthesis**: Implement push-and-hold / tap toggle voice recognition, Web Speech TTS, audio visualizer, and transient captions.
- **Task 4: Dynamic Capability Registry & Semantic Planner**: Validate tool catalog, bound iterations, ensure semantic mapping without keywords.
- **Task 5: Mascot Travel Engine & Real Action Bridge**: Implement semantic anchor registry, spring-physics viewport travel, route synchronization, and field-level highlighting.
- **Task 6: Operation Persistence & Live Event Resync**: Ensure task states survive reconnects and reflect real server execution.
- **Task 7: Interruption & Correction Protocol**: Implement pause, stop, and mid-flight voice corrections with fencing tokens.
- **Task 8: Privacy & Security Hardening**: Redact secrets, prevent IDOR, enforce database safety guardrails.
- **Task 9: Integration, Polishing & Acceptance Walkthrough**: Build verification, end-to-end tests, and manual scenario validations.

## 5. Acceptance Criteria
- Small floating character (56-68px) at bottom-right with smooth spring physics and 17 states.
- Zero text composer, zero send buttons, zero canned command chips, zero large chat sidebars.
- Real voice recognition with press-and-hold and click toggle; natural TTS audio with mute control.
- Mascot visibly travels to real portal pages and anchors during execution.
- Real application operations executed through Laravel backend with verified persistence and safety.
