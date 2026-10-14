# Voice Input and Output Lifecycle Specification

## 1. Interaction Paradigm: Voice-First, Zero Chat Composer
Voice is the primary interaction medium for Aura Core. The interface strictly prohibits:
- Text message composers / input textareas.
- Send-message submit buttons.
- Canned command chips / static suggestion pill buttons.
- Persistent scrolling message chat logs.

Ordinary application forms remain for entering sensitive credentials (e.g. database passwords) or reviewing structured data.

## 2. Activation Modes
The mascot supports two activation triggers:
1. **Press-and-Hold (Desktop)**:
   - User holds down mouse button or spacebar on the floating mascot.
   - Mascot wakes up (`activation`), transitions immediately to `listening`, and begins streaming speech.
   - Upon release, listening stops, transcript is finalized, and mascot enters `transcribing` -> `understanding`.
2. **Tap-to-Toggle (Mobile / Click Alternative)**:
   - Clicking or tapping the voice microphone trigger toggles listening state on.
   - Tap again, or wait for the automatic end-of-speech silence timeout (1.8 seconds), to submit.
3. **Keyboard Shortcut**:
   - `Cmd+J` / `Ctrl+J` activates voice listening immediately.

## 3. Speech Recognition Engine
- **Implementation**: Standard Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`).
- **Configuration**:
  - `continuous: false`
  - `interimResults: true`
  - `lang: navigator.language || 'en-US'`
- **Lifecycle & Error Handling**:
  - `onstart`: mascot state -> `listening`.
  - `onaudiostart`: volume meter activates.
  - `onresult`: transient speech preview card displays recognized speech in real time.
  - `onend`: transitions to `transcribing` -> `understanding` and dispatches request.
  - `onerror`:
    - `not-allowed` / `denied`: informs user with clear status card ("Microphone permission required") and provides accessible action.
    - `no-speech`: resets gently to `idle` after concise notice.
    - `network`: informs user of connectivity issue.

## 4. Spoken Speech Output (TTS)
- **Engine**: Browser native `window.speechSynthesis` (`SpeechSynthesisUtterance`).
- **Tone & Brevity**:
  - Concise, natural voice summaries (1-2 sentences maximum).
  - No long robotic technical JSON dumps.
  - Large results (such as schemas or tables) are displayed in their real portal views; the mascot speaks an executive summary: *"I've inspected your database. Discovered 7 tables, including posts and categories. Posts is eligible for automated content."*
- **Speech Settings & Controls**:
  - Voice mute toggle directly accessible on the compact HUD (one click mute/unmute).
  - Speech synthesis rate: 1.05x (natural, responsive cadence).
  - Respects user gesture policy: never autoplays voice audio on raw page load; speaks only after user-initiated activation.

## 5. Transient Captions & Accessible Fallback
- While listening or speaking, a floating transient caption card appears beside the mascot.
- It displays:
  - Spoken request transcript (what the user said).
  - Spoken response caption (what the agent is saying).
- If microphone hardware is absent or permission is denied:
  - The compact HUD displays an honest status card ("Voice recognition unavailable").
  - Provides a direct link to the corresponding portal page (e.g. "Open Connections Page").
  - Under NO circumstances does it fall back to a text chat message composer.
