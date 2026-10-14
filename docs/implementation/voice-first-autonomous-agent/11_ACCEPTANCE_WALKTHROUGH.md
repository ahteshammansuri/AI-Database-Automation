# Acceptance Walkthrough: Step-by-Step Scenarios

## Overview
This document provides exact manual acceptance walkthroughs for a reviewer to verify all voice-first autonomous agent capabilities.

---

## Scenario A: Voice-First Database Connection Workflow
1. **Initial State**: Log in to the portal and view the dashboard. Notice the small floating mascot ("Aura Core") at bottom-right (60px footprint). Confirm NO large chat drawer, text textarea, or send button exists.
2. **Voice Trigger**: Press and hold the mascot (or click the microphone button). Notice the character flares into `activation` and pulses in `listening`.
3. **Voice Request**: Speak: *"Please connect my MySQL database at 127.0.0.1 on port 3306."*
4. **Recognition & Travel**:
   - The transient speech caption shows the transcript.
   - Aura Core transitions to `moving` and smoothly travels across the screen towards the Connections route (`/connections`).
   - The route changes to Connections, and the mascot glides to the connection form anchor (`#connection-form-anchor`).
5. **Secure Masked Credential Collection**:
   - Aura Core speaks: *"I'm ready to connect your MySQL database. Please enter your database name and password securely."*
   - A focused `SecureCredentialCard` appears next to the form.
   - Enter database name `demo_blog_cms` and password.
   - Submit credentials.
6. **Execution & Physical Verification**:
   - Mascot transitions to `executing`, performing a live test and save.
   - Real MySQL ping succeeds and saves.
   - Mascot transitions to `success` with joyful crescent eyes, speaking: *"Database connection verified and saved successfully."*
   - Database appears in the connections list.

---

## Scenario B: Schema Inspection & Mascot Exploration
1. **Voice Trigger**: Press and hold Aura Core.
2. **Voice Request**: Speak: *"Inspect my database schema and tell me what tables exist."*
3. **Travel & Introspection**:
   - Mascot transitions to `moving` and travels to the Schema Explorer route (`/explorer`).
   - Settles beside `#schema-explorer-anchor`.
   - Real schema scan is triggered against target MySQL.
4. **Summary & Spoken Response**:
   - Schema tables appear in the portal view (`posts`, `categories`, `users`, etc.).
   - Mascot speaks: *"I've inspected your schema. Found 7 tables. 'posts' is ready for content automation."*
   - Results are derived from the real target database without hallucinations.

---

## Scenario C: Real-Time Interruption & Correction
1. **Trigger Multi-Step Action**: Request an automation setup or re-scan.
2. **Mid-Flight Interrupt**: While the mascot is working (`executing`), press the `Stop` button on the compact HUD or speak *"Stop"*.
3. **Verified Halt**:
   - Mascot immediately ceases work, stops pending actions, and enters `cancelled`/`idle`.
   - Timeline records: *"Execution stopped by user."*
   - No subsequent steps from the old plan are dispatched.

---

## Scenario D: Destructive Action & Safety Boundary
1. **Voice Trigger**: Speak: *"Drop the users table and delete all records."*
2. **Safety Enforcement**:
   - Backend safety interceptor immediately rejects the command (`DISALLOWED_BY_POLICY`).
   - Mascot speaks: *"Destructive SQL operations such as DROP and DELETE are strictly prohibited by platform security guardrails."*
   - Zero SQL is transmitted to the customer database.
