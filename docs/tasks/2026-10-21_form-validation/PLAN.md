# Form validation with inline messages (frontend + backend) — 2026-10-21

Request: proper validation everywhere, frontend and backend; no browser-only validation popups; a clear message
directly below the field it is about (not in a toast/banner elsewhere).

Resume: read PROGRESS.md, continue from the first item not DONE.

## Approach
- Frontend: `src/lib/validation.ts` (rules, validate(), serverFieldErrors() from Laravel 422 `errors`), `FieldError`
  + invalid input style in the UI kit, forms use `noValidate`, validate on submit (and re-check a field as it is
  edited), focus the first invalid field, show server field errors under the same fields. Non-field failures (e.g.
  "could not reach the database") stay in the form's own alert, not as field errors.
- Backend: every write endpoint returns 422 `{message, errors: {field: [msg]}}` with clear messages; conditional and
  format rules (host, database name, timezone, URL, file type, lengths); friendly attribute names in lang/en/validation.php;
  business-rule failures (duplicate name, unsafe host, write-plan column problems) keyed by their field.
- Orbit keeps working: surfaces still set fields through page state; server errors show inline for Orbit's saves too.

| # | Item | Status |
|---|------|--------|
| V1 | Validation lib + tests; FieldError/invalid styles in kit | DONE |
| V2 | Backend: lang attributes/messages; Auth, Connections (store/update/test, duplicate name, unsafe host), AI providers, Knowledge (file type), Schema notes, Approvals reject/edit, Manual publish (errors per column), Model roles, Automations (messages) + feature tests | DONE |
| V3 | Login, Register | DONE |
| V4 | Connections form (incl. Test button) | DONE |
| V5 | Automation builder (setup, content, schedule, approval email) + Automations list editor | DONE |
| V6 | Manual publishing (columns from schema + write-plan errors under each column, custom columns, schedule time) | DONE |
| V7 | Knowledge upload/search, AI providers, Model roles, Schema notes, Approvals edit/reject, public review page, Orbit typed message, secure credential card | DONE |
| V8 | Verify: tsc, lint (no new warnings), frontend tests, Laravel tests, real browser (empty submit shows messages under fields; server errors under fields), Orbit UI probe still OK | DONE |
