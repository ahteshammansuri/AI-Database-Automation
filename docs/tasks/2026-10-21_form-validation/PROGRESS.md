# Progress — form validation

## 2026-10-21
- Audit: api.ts keeps Laravel 422 errors (err.errors) but pages show one toast/banner; forms rely on browser popups
  (a hidden required file input in Knowledge can even block submit); several 422s have no field keys (connection
  duplicate name / missing host, manual publish plan problems).
- V1 DONE: frontend/src/lib/validation.ts (+6 tests), FieldError/FormAlert in ui/kit, .da-input-invalid.
- V2 DONE: lang/en/validation.php (friendly messages + attribute names, merges with Laravel defaults); connections
  store/update/test: required host/database/username (or URI), host/database/URI formats, timezone, lengths, duplicate
  name -> errors.name, unsafe host -> errors.host (was an uncaught 500); login failure -> errors.password; register
  password max; AI provider: cloud key required, Ollama URL format, model length; knowledge: extensions rule ->
  errors.file; schema notes lengths; approval feedback max; manual publish 422 -> errors["payload.<column>"].
  tests/Feature/FormValidationTest.php 8/8. Pre-existing environmental failures (demo MySQL 3308 down): 4 tests.
- V3 DONE: Login/Register noValidate + FieldError per field; server 422 (duplicate email, wrong password) under the field.
- V4 DONE: Connections form: client rules mirror targetRules (name, host, port, db, user, password length, URI, timeout 1-30,
  timezone); Test button validates inline first; URI-mode server errors land on the URI field; Advanced opens if needed.
  Backend: unusable URIs (no host/db/user, non-mysql scheme) now 422 errors.connection_uri (were 500s).
- V5 DONE: Builder: stepCheck() per step -> messages under name/connection/table/topic/tone/image style/model/reviewer
  email; ScheduleStep shows timezone/dates/weekdays/times under each picker (summary only lists unplaced errors); server
  422 mapped back to the right step+field; doc upload modal validates title/file (type, 10 MB). SearchableSelect has
  invalid state. Automations list model/topic modal validated inline.
- V6 DONE: Manual publishing: checkForm() (required NOT NULL w/o default, numbers, max length, enums, custom field names,
  past time), dry-run plan column errors and 422 payload.<col> under each column; AI topic and image upload inline.
- V7 DONE: Knowledge (file chosen/dropped is checked at once, search text), AI providers (model, URL, key when none saved),
  model roles, schema note (2000), approvals edit (draftPayloadErrors mirrors new DraftPayloadValidator) + reject notes,
  public review feedback, Orbit typed message, secret card, correction box; published-record editor sends only changed
  fields, is checked first and asks for confirmation before the UPDATE.
  Backend: DraftPayloadValidator used by approvals payload edit/approve and ExecutionController::updateRecord.
- V8 DONE (2026-10-21):
  - tsc clean; oxlint 148 -> 139 warnings (no new ones; remaining are pre-existing); frontend 66/66 (14 files, incl.
    Orbit catalog consistency); FormValidationTest 9/9 (52 assertions).
  - Real browser (headless Chrome, live stack): 15/15 sign-in/register checks, 18/19 portal checks + 4/4 follow-up
    (the one "miss" was the builder auto-selecting the only connection, which is correct). Messages sit under the
    field, aria-invalid + aria-describedby set, typing clears only that field. QA users + placeholder connection deleted.
  - Full Laravel suite (fixture containers dataauto-fx-mysql/postgres started): 189 passed, 23 failed, 1 skipped.
    All 23 are environmental/pre-existing: 21 need the demo MySQL on 127.0.0.1:3308 (container
    claudeipopremium-mysql-1 from another project, stopped; not started by me), 1 needs pdo_pgsql (not installed),
    1 NoveltyCheckTest mocks the wrong class for GenerateAutomationContentJob (unchanged files).
