# Progress: linked records everywhere (2026-10-29)

## Baseline (before changes)
Relevant Laravel suites: 42 passed, 4 failed. The 4 failures need a MySQL on port 3308 (`demo_blog_cms`) that is not running (already listed under known limitations of earlier slices).

## Done
| Slice | Files | Result |
|---|---|---|
| L1 inference | `app/Services/Data/RelationInference.php`, `tests/Unit/RelationInferenceTest.php` | 5 tests, 108 assertions pass. On the connected `choviet102` (141 tables): 8 declared -> 175 links in 22 ms; `blogs.category_id -> blog_categories`, `products.user_id -> users`, `products.category_id -> categories` (not the `product_categories` pivot), `product_taxes.tax_id -> taxes`. On `pinpoint_live`, `order-number` columns are no longer linked to the backup table `orders-duplicate`. |
| L2 settings + catalog | migration `2026_10_29_000001`, `ConnectionColumnSetting`, `SchemaRelations`, `LiveSchemaService` | Catalog and snapshot carry effective links, `label_column`, `value_labels`, `categorical`. |
| L3 data API | `LinkedRecords`, `DataChangeService`, `DataExplorerController`, migration `2026_10_29_000002` (`linked_parents`, encrypted) | `$new` parents on insert and edit, same transaction, Undo removes them unless used; link checks accept `0` as none and never read blocked tables; delete impact says when a link is not enforced. |
| L4 automations | `TargetTableInspector::describeFor`, `FieldPlanBuilder`, `ParentRowBuilder`, `SafeDatabaseExecutor`, `AutomationController::manualPublish` | Manual publishing and automations use detected links; `relation_values` fills a new parent's details; plans name the parent. |
| L5 schema API | `SchemaLinksController`, routes, `SchemaController` | Link editor, value names, display column, data check, publishing pickers; all audited and owner-scoped. |
| L6 frontend | `components/links/*`, `RowForm`, `DataCell`, `ChangeConfirmModal`, `DataPage`, `ManualSchedulePage`, `FieldMappingStep`, `fieldPlan.ts`, `components/schema/{RelationshipMap,LinkEditor,ValueNamesEditor,ColumnsTable,schemaFacts}`, `SchemaExplorerPage`, `ui/kit.tsx` (portal + top-most Escape) | Removed: `manual/RelationPicker.tsx`, `common/SearchableRelationshipSelect.tsx`, `schema/TableLinks.tsx` (replaced by the shared picker and the map). |

## Verification
- `php artisan test` on the relevant suites (Data, automations, executor, schema, tenant isolation, approvals, scheduler, inference, linked records): **91 passed, 1 skipped, 6 failed**. The 6 failures are environmental: 5 need the MySQL on port 3308, 1 (`ast read gate`) needs the Python AI service on 8001, which was not running during the run. None touch this change.
- `tests/Feature/LinkedRecordsTest.php`: 7 tests, 102 assertions pass (fixture MySQL 3317).
- Frontend: `npx tsc -b` clean; `npm test` (79 existing + 5 new) pass; `npm run build` succeeds (existing chunk-size warning); `oxlint` shows no new warnings in the new components beyond patterns already used in the codebase.
- Headless Chrome walkthrough on a disposable demo database without foreign keys (account, connection and database removed afterwards): Schema Explorer map and link editor with data check, Data rows by name, add blog with a new category typed by name -> preview "Also added first" -> saved with both rows, new user with required email/phone in the details form (validation shown), named status values in the table and the choice list, manual publishing pickers (people never created there), phone width. Screens fixed during the run: new-row chip truncated in half-width fields, message order in the picker, default shown for empty choices, long table names wrapping.

## Not done / limits
See "Known limitations" in `docs/IMPLEMENTATION_PLAN.md` (Linked records everywhere).
