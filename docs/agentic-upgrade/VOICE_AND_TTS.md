# VOICE_AND_TTS.md
## Voice Input, Text-to-Speech, and Barge-In Lifecycle Specification

**Objective:** Natural voice-first interaction with real-time barge-in, accessible fallback, and state synchronization with the animated mascot character.

---

### 1. State Machine

```
   +--------+
   |  IDLE  |<---------------------------------------+
   +---+----+                                        |
       | User clicks Mic / speaks                    |
       v                                             |
+--------------+                                     |
|  LISTENING   |                                     |
+------+-------+                                     |
       | Speech ends / final transcript emitted      |
       v                                             |
+--------------+                                     |
| TRANSCRIBING |                                     |
+------+-------+                                     |
       | Redaction & API submission                  |
       v                                             |
+---------------+                                    |
| UNDERSTANDING | (Model generates plan)             |
+------+--------+                                    |
       | Plan approved                               |
       v                                             |
+--------------+                                     |
|  EXECUTING   | (Real bridge actions + DB backend)  |
+------+-------+                                     |
       | Verified outcome confirmed                  |
       v                                             |
+--------------+       Barge-In (New Voice Input)    |
|   SPEAKING   |-------------------------------------+ (Interrupts audio)
+------+-------+
       | Audio finished playing
       v
+--------------+
|   SUCCESS    |
+--------------+
```

---

### 2. Barge-In & Interruption Handling

1. **Immediate Audio Ducking/Cancellation:**
   When the user begins speaking while the mascot is talking (`window.speechSynthesis.speaking === true`), `useVoiceLifecycle` immediately calls `window.speechSynthesis.cancel()` to halt playback.
2. **Intent Classification:**
   The new incoming utterance is classified:
   - If it is a stop/cancel command (`"stop"`, `"cancel"`, `"halt"`), the active task's pending steps are marked `CANCELLED`.
   - If it is a correction (`"change port to 3307"`), the active plan version is incremented and the slot is updated.
   - If it is a new request, the prior task is cleanly terminated if non-destructive, and a fresh turn begins.
3. **Mascot Audio Ducking:**
   Mascot speech never overlaps with user speech or plays multiple tracks simultaneously.

---

### 3. Accessible Fallback

If microphone permissions are denied or Web Speech API is unsupported in the browser:
1. An accessible text command input is provided in the `AgentOperationalHUD`.
2. Speech output is mirrored visually in captions/text bubbles.
3. Motion respects `prefers-reduced-motion: reduce`.
