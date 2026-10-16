<?php

namespace App\Services\Agent;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\KnowledgeDocument;
use App\Models\AiProvider;
use App\Models\AuditLog;
use App\Services\DatabaseSafetyService;
use App\Services\SchemaIntrospectionService;
use App\Services\SafeDatabaseExecutor;
use App\Services\AiServiceClient;
use App\Services\LiveEventService;
use App\Jobs\ProcessAutomationExecution;
use App\Jobs\PublishApprovedExecution;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AgentToolRegistry
{
    /**
     * Complete definitions of registered tools with rich capability metadata.
     */
    /** Names of the generic on-screen tools (executed by the browser, checked against SurfaceCatalog). */
    public const UI_TOOLS = ['go_to_page', 'open_form', 'read_screen', 'fill_fields', 'choose_option', 'press', 'ask_secret_in_form', 'show_me'];

    /**
     * Generic tools that let Orbit operate any catalogued page like a person, visibly:
     * navigate, open forms, type into fields, pick options, press buttons.
     */
    public static function uiToolDefinitions(): array
    {
        $routes = SurfaceCatalog::routes();
        $surfaces = SurfaceCatalog::surfaceIds();
        $openable = SurfaceCatalog::surfaceIds(fn ($s) => !empty($s['openable']));
        $ui = fn (string $name, string $label, string $description, array $properties, array $required = []) => [
            'name' => $name, 'label' => $label, 'description' => $description, 'outcome' => 'Visible action in the portal, acknowledged by the browser.',
            'scope' => 'tenant_user', 'read_only' => $name === 'read_screen', 'side_effects' => 'Operates the portal UI on screen.',
            'risk_level' => 'LOW', 'requires_confirmation' => false, 'idempotent' => false, 'retryable' => true, 'audit_required' => false,
            'parameters' => array_filter(['type' => 'object', 'properties' => $properties, 'required' => $required ?: null]),
            'output_schema' => ['type' => 'object'],
        ];

        return [
            $ui('go_to_page', 'Go to a page', 'Visibly navigate the portal to a page (Orbit taps the sidebar item). Returns which surfaces are now on screen.',
                ['page' => ['type' => 'string', 'enum' => $routes]], ['page']),
            $ui('open_form', 'Open a form', 'Navigate if needed and open a form (Orbit taps its opener, e.g. "Connect Database"). Returns its fields, current values and which required fields are still missing.',
                ['surface' => ['type' => 'string', 'enum' => $openable]], ['surface']),
            $ui('read_screen', 'Read the screen', 'Read what is on screen now: surfaces with their non-secret field values, errors, list rows (with their ids) and available actions.', []),
            $ui('fill_fields', 'Fill form fields', 'Type values into fields of an on-screen surface (Orbit types them visibly). values is an object of field name to value. Never for secret or file fields. Returns per-field acceptance or validation errors and fields still missing.',
                ['surface' => ['type' => 'string', 'enum' => $surfaces], 'values' => ['type' => 'object'], 'row' => ['type' => 'string']], ['surface', 'values']),
            $ui('choose_option', 'Choose a dropdown option', 'Pick an option in a select field using the real loaded options, by option id or visible label. Returns the chosen option, or the candidates if ambiguous.',
                ['surface' => ['type' => 'string', 'enum' => $surfaces], 'field' => ['type' => 'string'], 'choice' => ['type' => 'string'], 'row' => ['type' => 'string']], ['surface', 'field', 'choice']),
            $ui('press', 'Press a button', 'Press a button on an on-screen surface; the page does exactly what a user click does and the real result is returned. Row actions need row (the item id). Actions marked consequential need the user to confirm first.',
                ['surface' => ['type' => 'string', 'enum' => $surfaces], 'action' => ['type' => 'string'], 'row' => ['type' => 'string']], ['surface', 'action']),
            $ui('ask_secret_in_form', 'Ask for a secret in the form', 'Point at a password or API-key box in the form and let the user type it there themselves. Then WAIT_FOR_USER; you will be told when they have entered it. You never see the value.',
                ['surface' => ['type' => 'string', 'enum' => $surfaces], 'field' => ['type' => 'string']], ['surface', 'field']),
            $ui('show_me', 'Show the user something', 'Point at and highlight a field, button or the surface itself with a short caption, to guide the user.',
                ['surface' => ['type' => 'string', 'enum' => $surfaces], 'element' => ['type' => 'string'], 'caption' => ['type' => 'string', 'maxLength' => 160]], ['surface', 'caption']),
        ];
    }

    public static function getToolDefinitions(): array
    {
        return array_merge(self::uiToolDefinitions(), self::backendToolDefinitions());
    }

    public static function backendToolDefinitions(): array
    {
        return [
            // =================================================================
            // 1. Database Connection Management
            // =================================================================
            [
                'name' => 'list_database_connections',
                'label' => 'List Database Connections',
                'description' => 'List all connected databases for the authenticated user.',
                'outcome' => 'Retrieves database profiles, server versions, latency, and status.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'connections' => ['type' => 'array'],
                        'total' => ['type' => 'integer'],
                    ],
                ],
            ],
            [
                'name' => 'test_database_connection',
                'label' => 'Test Database Connection',
                'description' => 'Test connection parameters or test an existing saved connection profile.',
                'outcome' => 'Verifies network reachability, SSRF policy, and MySQL handshake.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'Network handshake only; zero data mutation.',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'connection_id' => ['type' => 'integer', 'description' => 'Optional ID of existing connection to retest.'],
                        'host' => ['type' => 'string', 'description' => 'Database host.'],
                        'port' => ['type' => 'integer', 'description' => 'Database port (default 3306).'],
                        'database' => ['type' => 'string', 'description' => 'Database name.'],
                        'username' => ['type' => 'string', 'description' => 'Database username.'],
                        'password' => ['type' => 'string', 'description' => 'Database password.'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'server_version' => ['type' => 'string'],
                        'latency_ms' => ['type' => 'number'],
                    ],
                ],
            ],
            [
                'name' => 'save_database_connection',
                'label' => 'Save Database Connection',
                'description' => 'Save a new validated database connection profile with encrypted credentials.',
                'outcome' => 'Persists database connection record with AES-256 encrypted password.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Creates platform DbConnection record.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => false,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['name', 'host', 'database', 'username', 'password'],
                    'properties' => [
                        'name' => ['type' => 'string', 'description' => 'Friendly connection label.'],
                        'host' => ['type' => 'string', 'description' => 'Database host.'],
                        'port' => ['type' => 'integer', 'description' => 'Database port (default 3306).'],
                        'database' => ['type' => 'string', 'description' => 'Database name.'],
                        'username' => ['type' => 'string', 'description' => 'Database username.'],
                        'password' => ['type' => 'string', 'description' => 'Database password (encrypted at rest).'],
                        'ssl_mode' => ['type' => 'string', 'description' => 'prefer, require, or disable.'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'connection_id' => ['type' => 'integer'],
                        'name' => ['type' => 'string'],
                    ],
                ],
            ],
            [
                'name' => 'update_database_connection',
                'label' => 'Update Database Connection',
                'description' => 'Update connection metadata or credentials for an existing database profile.',
                'outcome' => 'Modifies platform database connection settings.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Updates platform DbConnection record.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => true,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['connection_id'],
                    'properties' => [
                        'connection_id' => ['type' => 'integer'],
                        'name' => ['type' => 'string'],
                        'host' => ['type' => 'string'],
                        'port' => ['type' => 'integer'],
                        'ssl_mode' => ['type' => 'string'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'connection_id' => ['type' => 'integer'],
                        'message' => ['type' => 'string'],
                    ],
                ],
            ],
            [
                'name' => 'disconnect_database_connection',
                'label' => 'Disconnect Database Profile',
                'description' => 'Remove a saved platform database connection profile. Target customer database is completely untouched.',
                'outcome' => 'Removes platform connection record.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Deletes DbConnection record in platform database.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => true,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['connection_id'],
                    'properties' => [
                        'connection_id' => ['type' => 'integer'],
                        'force' => ['type' => 'boolean', 'description' => 'Force deletion even if automations depend on it.'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'connection_id' => ['type' => 'integer'],
                        'message' => ['type' => 'string'],
                    ],
                ],
            ],

            // =================================================================
            // 2. Schema Discovery & Introspection
            // =================================================================
            [
                'name' => 'scan_database_schema',
                'label' => 'Scan Database Schema',
                'description' => 'Introspect database schema and discover eligible tables for content automation.',
                'outcome' => 'Scans tables, columns, data types, and primary/foreign keys.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'Updates SchemaSnapshot in platform database.',
                'risk_level' => 'MEDIUM',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['connection_id'],
                    'properties' => [
                        'connection_id' => ['type' => 'integer', 'description' => 'ID of saved connection.'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'total_tables' => ['type' => 'integer'],
                        'eligible_tables' => ['type' => 'array'],
                    ],
                ],
            ],
            [
                'name' => 'get_schema_scan_status',
                'label' => 'Get Schema Details',
                'description' => 'Retrieve table eligibility classifications and foreign key relationships.',
                'outcome' => 'Returns latest cached schema snapshot.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['connection_id'],
                    'properties' => [
                        'connection_id' => ['type' => 'integer', 'description' => 'ID of saved connection.'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'tables' => ['type' => 'array'],
                    ],
                ],
            ],
            [
                'name' => 'lookup_table_values',
                'label' => 'Lookup Table Values',
                'description' => 'Query allowable sample values or lookup references in an eligible target table (e.g. categories, tags, authors).',
                'outcome' => 'Returns read-only sample rows for reference resolution.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['connection_id', 'table'],
                    'properties' => [
                        'connection_id' => ['type' => 'integer'],
                        'table' => ['type' => 'string'],
                        'column' => ['type' => 'string'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'values' => ['type' => 'array'],
                    ],
                ],
            ],

            // =================================================================
            // 3. Automation Workflows
            // =================================================================
            [
                'name' => 'list_automations',
                'label' => 'List Automations',
                'description' => 'List all configured content generation and publishing workflows for the user.',
                'outcome' => 'Returns list of automations with schedules, status, and target tables.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'automations' => ['type' => 'array'],
                        'total' => ['type' => 'integer'],
                    ],
                ],
            ],
            [
                'name' => 'get_automation_details',
                'label' => 'Get Automation Details',
                'description' => 'Retrieve complete configuration, prompts, schedule, and field mappings of an automation.',
                'outcome' => 'Returns full automation specification.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['automation_id'],
                    'properties' => [
                        'automation_id' => ['type' => 'integer'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'automation' => ['type' => 'object'],
                    ],
                ],
            ],
            [
                'name' => 'create_automation_draft',
                'label' => 'Create Automation Draft',
                'description' => 'Configure and persist a new AI content automation workflow with lead-time enforcement.',
                'outcome' => 'Persists Automation record with field mappings, topic prompt, and schedule.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Creates platform Automation record.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => false,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['connection_id', 'target_table', 'name'],
                    'properties' => [
                        'connection_id' => ['type' => 'integer'],
                        'target_table' => ['type' => 'string'],
                        'name' => ['type' => 'string'],
                        'operation_mode' => ['type' => 'string', 'description' => 'AI_CREATE, AI_ENRICH, or MANUAL_SCHEDULE'],
                        'topic_prompt' => ['type' => 'string'],
                        'category_name' => ['type' => 'string'],
                        'field_mappings' => ['type' => 'array'],
                        'schedule_type' => ['type' => 'string', 'description' => 'DAILY, WEEKLY, or ONE_TIME'],
                        'generation_time' => ['type' => 'string', 'description' => 'HH:MM format'],
                        'publication_time' => ['type' => 'string', 'description' => 'HH:MM format (>= 30m after generation_time)'],
                        'timezone' => ['type' => 'string', 'description' => 'IANA timezone, e.g. Asia/Kolkata'],
                        'requires_approval' => ['type' => 'boolean'],
                        'is_active' => ['type' => 'boolean'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'automation_id' => ['type' => 'integer'],
                        'name' => ['type' => 'string'],
                        'target_table' => ['type' => 'string'],
                    ],
                ],
            ],
            [
                'name' => 'update_automation',
                'label' => 'Update Automation Configuration',
                'description' => 'Update schedule, prompt context, active status, or settings of an existing automation.',
                'outcome' => 'Modifies platform Automation record.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Updates platform Automation record.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => true,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['automation_id'],
                    'properties' => [
                        'automation_id' => ['type' => 'integer'],
                        'name' => ['type' => 'string'],
                        'topic_prompt' => ['type' => 'string'],
                        'category_name' => ['type' => 'string'],
                        'schedule_type' => ['type' => 'string'],
                        'generation_time' => ['type' => 'string'],
                        'publication_time' => ['type' => 'string'],
                        'is_active' => ['type' => 'boolean'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'automation_id' => ['type' => 'integer'],
                        'message' => ['type' => 'string'],
                    ],
                ],
            ],
            [
                'name' => 'remove_automation',
                'label' => 'Remove Automation',
                'description' => 'Delete an automation configuration record from the platform database.',
                'outcome' => 'Removes platform Automation record.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Deletes Automation record.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => true,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['automation_id'],
                    'properties' => [
                        'automation_id' => ['type' => 'integer'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'automation_id' => ['type' => 'integer'],
                        'message' => ['type' => 'string'],
                    ],
                ],
            ],
            [
                'name' => 'run_automation_now',
                'label' => 'Trigger Immediate Execution',
                'description' => 'Immediately trigger a scheduled automation execution through the background queue.',
                'outcome' => 'Creates AutomationExecution record and dispatches ProcessAutomationExecution job.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Creates AutomationExecution, enqueues background worker job.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => false,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['automation_id'],
                    'properties' => [
                        'automation_id' => ['type' => 'integer'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'execution_id' => ['type' => 'integer'],
                        'status' => ['type' => 'string'],
                    ],
                ],
            ],
            [
                'name' => 'preview_automation_content',
                'label' => 'Preview AI Content Draft',
                'description' => 'Generate an ephemeral content preview using the configured AI model without scheduling or inserting into the database.',
                'outcome' => 'Returns generated preview JSON object.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None; zero database write.',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['prompt'],
                    'properties' => [
                        'prompt' => ['type' => 'string'],
                        'target_table' => ['type' => 'string'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'preview' => ['type' => 'object'],
                    ],
                ],
            ],

            // =================================================================
            // 4. Executions & Content Versions
            // =================================================================
            [
                'name' => 'list_executions',
                'label' => 'List Executions',
                'description' => 'List recent automation executions with status, date, and target table.',
                'outcome' => 'Returns execution run history.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'status' => ['type' => 'string'],
                        'limit' => ['type' => 'integer'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'executions' => ['type' => 'array'],
                        'total' => ['type' => 'integer'],
                    ],
                ],
            ],
            [
                'name' => 'get_execution_status',
                'label' => 'Get Execution Status',
                'description' => 'Check detailed status, timeline events, and output of an automation run.',
                'outcome' => 'Returns execution progress, target record ID, and error messages.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['execution_id'],
                    'properties' => [
                        'execution_id' => ['type' => 'integer'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'id' => ['type' => 'integer'],
                        'status' => ['type' => 'string'],
                        'timeline_events' => ['type' => 'array'],
                    ],
                ],
            ],
            [
                'name' => 'retry_execution',
                'label' => 'Retry Failed Execution',
                'description' => 'Re-dispatch a failed execution job to background workers.',
                'outcome' => 'Resets execution state to PENDING_GENERATION and re-enqueues job.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Updates AutomationExecution status, dispatches job.',
                'risk_level' => 'MEDIUM',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['execution_id'],
                    'properties' => [
                        'execution_id' => ['type' => 'integer'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'execution_id' => ['type' => 'integer'],
                        'status' => ['type' => 'string'],
                    ],
                ],
            ],
            [
                'name' => 'request_execution_interrupt',
                'label' => 'Request Execution Interrupt',
                'description' => 'Request immediate pause or cancellation of a queued or running execution.',
                'outcome' => 'Updates execution status to CANCELLED or PAUSED at safe boundary.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Updates execution status.',
                'risk_level' => 'MEDIUM',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['execution_id'],
                    'properties' => [
                        'execution_id' => ['type' => 'integer'],
                        'action' => ['type' => 'string', 'description' => 'cancel or pause'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'execution_id' => ['type' => 'integer'],
                        'status' => ['type' => 'string'],
                    ],
                ],
            ],
            [
                'name' => 'explain_execution_failure',
                'label' => 'Explain Execution Failure',
                'description' => 'Analyze the latest failed execution and explain the root cause and safe fix.',
                'outcome' => 'Returns actionable diagnosis and recovery instructions.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'execution_id' => ['type' => 'integer', 'description' => 'Optional specific execution ID.'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'explanation' => ['type' => 'string'],
                        'can_retry' => ['type' => 'boolean'],
                    ],
                ],
            ],
            [
                'name' => 'update_published_record',
                'label' => 'Update Published Customer Record',
                'description' => 'Perform an audited, scoped UPDATE to a single target customer record (WHERE id = :id).',
                'outcome' => 'Executes safe parameterized UPDATE on target customer database record.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Modifies allowable columns on specific single target record.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => true,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['execution_id', 'fields'],
                    'properties' => [
                        'execution_id' => ['type' => 'integer'],
                        'fields' => ['type' => 'object', 'description' => 'Key-value map of allowable columns to update.'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'target_record_id' => ['type' => 'integer'],
                        'message' => ['type' => 'string'],
                    ],
                ],
            ],

            // =================================================================
            // 5. Approvals
            // =================================================================
            [
                'name' => 'get_pending_approvals',
                'label' => 'Get Pending Approvals',
                'description' => 'List content drafts waiting for user approval before publishing.',
                'outcome' => 'Returns drafts in PENDING_APPROVAL status with payload previews.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'pending_approvals' => ['type' => 'array'],
                        'count' => ['type' => 'integer'],
                    ],
                ],
            ],
            [
                'name' => 'approve_content_version',
                'label' => 'Approve Content Draft',
                'description' => 'Approve a pending content version draft to proceed to scheduled or immediate publication.',
                'outcome' => 'Marks version approved and dispatches PublishApprovedExecution.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Updates ContentVersion, triggers background publisher.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => true,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['version_id'],
                    'properties' => [
                        'version_id' => ['type' => 'integer'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'version_id' => ['type' => 'integer'],
                        'execution_id' => ['type' => 'integer'],
                    ],
                ],
            ],
            [
                'name' => 'reject_content_version',
                'label' => 'Reject Content Draft',
                'description' => 'Reject a pending content draft and trigger regeneration with corrective feedback.',
                'outcome' => 'Records rejection feedback and triggers ProcessAutomationExecution.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Updates version to rejected, dispatches regeneration job.',
                'risk_level' => 'MEDIUM',
                'requires_confirmation' => false,
                'idempotent' => false,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['version_id', 'feedback'],
                    'properties' => [
                        'version_id' => ['type' => 'integer'],
                        'feedback' => ['type' => 'string', 'description' => 'Specific feedback explaining why to revise.'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'version_id' => ['type' => 'integer'],
                        'message' => ['type' => 'string'],
                    ],
                ],
            ],

            // =================================================================
            // 6. AI Providers
            // =================================================================
            [
                'name' => 'list_ai_providers',
                'label' => 'List AI Providers',
                'description' => 'List configured AI providers with masked API keys and model preferences.',
                'outcome' => 'Returns configured providers.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'providers' => ['type' => 'array'],
                    ],
                ],
            ],
            [
                'name' => 'test_ai_provider',
                'label' => 'Test AI Provider Credentials',
                'description' => 'Test connectivity and model availability for a specific AI provider.',
                'outcome' => 'Verifies API key and returns model availability.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['provider'],
                    'properties' => [
                        'provider' => ['type' => 'string', 'description' => 'ollama, openai, gemini, or claude'],
                        'model' => ['type' => 'string'],
                        'api_key' => ['type' => 'string'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'available' => ['type' => 'boolean'],
                        'latency_ms' => ['type' => 'number'],
                    ],
                ],
            ],
            [
                'name' => 'save_ai_provider',
                'label' => 'Save AI Provider Configuration',
                'description' => 'Save or update user-specific AI provider credentials (encrypted at rest).',
                'outcome' => 'Persists AiProvider configuration.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Updates AiProvider record.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => true,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['provider_type'],
                    'properties' => [
                        'provider_type' => ['type' => 'string'],
                        'model_name' => ['type' => 'string'],
                        'api_key' => ['type' => 'string'],
                        'is_active' => ['type' => 'boolean'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'provider_id' => ['type' => 'integer'],
                        'message' => ['type' => 'string'],
                    ],
                ],
            ],
            [
                'name' => 'get_provider_health',
                'label' => 'Get Provider Health',
                'description' => 'Check connectivity to local Ollama or active AI providers.',
                'outcome' => 'Returns provider status, active model, and latency.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'provider' => ['type' => 'string'],
                        'status' => ['type' => 'string'],
                    ],
                ],
            ],

            // =================================================================
            // 7. Knowledge Base & RAG
            // =================================================================
            [
                'name' => 'list_knowledge_documents',
                'label' => 'List Knowledge Documents',
                'description' => 'List indexed knowledge documents (.pdf, .txt, .md) for the tenant workspace.',
                'outcome' => 'Returns document list with chunk counts and index status.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'documents' => ['type' => 'array'],
                        'total' => ['type' => 'integer'],
                    ],
                ],
            ],
            [
                'name' => 'query_knowledge_base',
                'label' => 'Search Knowledge Base',
                'description' => 'Perform semantic search across workspace knowledge documents using vector embeddings.',
                'outcome' => 'Returns relevant passages and relevance scores.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['query'],
                    'properties' => [
                        'query' => ['type' => 'string'],
                        'top_k' => ['type' => 'integer'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'results' => ['type' => 'array'],
                    ],
                ],
            ],
            [
                'name' => 'remove_knowledge_document',
                'label' => 'Remove Knowledge Document',
                'description' => 'Remove a knowledge document and purge its vector embeddings from the index.',
                'outcome' => 'Deletes KnowledgeDocument and purges embeddings.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Deletes platform document and vectors.',
                'risk_level' => 'MEDIUM',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'required' => ['document_id'],
                    'properties' => [
                        'document_id' => ['type' => 'integer'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'document_id' => ['type' => 'integer'],
                        'message' => ['type' => 'string'],
                    ],
                ],
            ],

            // =================================================================
            // 8. Overview & Audit Logs
            // =================================================================
            [
                'name' => 'get_dashboard_summary',
                'label' => 'Get Workspace Dashboard Summary',
                'description' => 'Get overview statistics of connections, automations, executions, and worker health.',
                'outcome' => 'Returns workspace metrics counts and operational summary.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'connections_count' => ['type' => 'integer'],
                        'automations_count' => ['type' => 'integer'],
                        'executions_count' => ['type' => 'integer'],
                        'pending_approvals_count' => ['type' => 'integer'],
                    ],
                ],
            ],
            [
                'name' => 'list_audit_logs',
                'label' => 'List Audit Logs',
                'description' => 'Retrieve system audit trail records for actions performed in this tenant workspace.',
                'outcome' => 'Returns recent audit log records.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'limit' => ['type' => 'integer'],
                    ],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'logs' => ['type' => 'array'],
                    ],
                ],
            ],
            // Natural-Language Data Agent tools (ADR-010)
            [
                'name' => 'ask_database',
                'label' => 'Ask Database Question',
                'description' => 'Query database schema, count records, find tables, or inspect data using natural language.',
                'outcome' => 'Executes validated read-only queries with schema linking and returns masked results with diagnostics.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'question' => ['type' => 'string'],
                        'connection_id' => ['type' => 'integer'],
                        'reveal_pii' => ['type' => 'boolean'],
                    ],
                    'required' => ['question'],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'headline' => ['type' => 'string'],
                        'row_count' => ['type' => 'integer'],
                        'rows' => ['type' => 'array'],
                        'columns' => ['type' => 'array'],
                    ],
                ],
            ],
            [
                'name' => 'find_dummy_data',
                'label' => 'Find Dummy / Test Data',
                'description' => 'Analyze table sample for seeded dummy or placeholder accounts, test emails, filler text, or burst timestamps.',
                'outcome' => 'Returns dummy data report with evidence, confidence, and sample masked records.',
                'scope' => 'tenant_user',
                'read_only' => true,
                'side_effects' => 'None',
                'risk_level' => 'LOW',
                'requires_confirmation' => false,
                'idempotent' => true,
                'retryable' => true,
                'audit_required' => false,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'table' => ['type' => 'string'],
                        'connection_id' => ['type' => 'integer'],
                    ],
                    'required' => ['table'],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'report' => ['type' => 'object'],
                    ],
                ],
            ],
            [
                'name' => 'preview_data_change',
                'label' => 'Preview Database Change',
                'description' => 'Prepare a before/after diff preview for an UPDATE or an impact analysis for a guarded DELETE before execution.',
                'outcome' => 'Creates a pending DataChangeRequest with pinned primary keys and masked preview rows.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Creates a pending change record.',
                'risk_level' => 'MEDIUM',
                'requires_confirmation' => true,
                'idempotent' => false,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'connection_id' => ['type' => 'integer'],
                        'action' => ['type' => 'string', 'enum' => ['update', 'delete']],
                        'table' => ['type' => 'string'],
                        'filter' => ['type' => 'object'],
                        'patch_values' => ['type' => 'object'],
                    ],
                    'required' => ['connection_id', 'action', 'table', 'filter'],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'change_request_id' => ['type' => 'integer'],
                        'affected_count' => ['type' => 'integer'],
                    ],
                ],
            ],
            [
                'name' => 'confirm_data_change',
                'label' => 'Confirm and Execute Data Change',
                'description' => 'Atomically execute a previewed UPDATE (pinned to previewed PKs) or guarded DELETE (requiring typed confirmation phrase).',
                'outcome' => 'Executes the pinned change in a transaction with TOCTOU row count verification and encrypted before-image.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Mutates target database rows.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => false,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'change_request_id' => ['type' => 'integer'],
                        'typed_phrase' => ['type' => 'string'],
                    ],
                    'required' => ['change_request_id'],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'success' => ['type' => 'boolean'],
                        'affected_count' => ['type' => 'integer'],
                    ],
                ],
            ],
            [
                'name' => 'undo_data_change',
                'label' => 'Undo Executed Data Change',
                'description' => 'Revert an executed UPDATE or DELETE using the stored encrypted before-image.',
                'outcome' => 'Restores the original row values in a transaction.',
                'scope' => 'tenant_user',
                'read_only' => false,
                'side_effects' => 'Restores rows to target database.',
                'risk_level' => 'HIGH',
                'requires_confirmation' => true,
                'idempotent' => false,
                'retryable' => false,
                'audit_required' => true,
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'change_request_id' => ['type' => 'integer'],
                    ],
                    'required' => ['change_request_id'],
                ],
                'output_schema' => [
                    'type' => 'object',
                    'properties' => [
                        'success' => ['type' => 'boolean'],
                        'restored_count' => ['type' => 'integer'],
                    ],
                ],
            ],
        ];
    }

    /**
     * Agent-loop metadata layered over the definitions above. Anything not listed
     * gets defaults derived from the definition (read_only => side_effect_class "read").
     *
     * - secret_params: arguments filled from SecretVault at execution time; hidden from the model.
     * - always_confirm: needs explicit user confirmation regardless of autonomy level.
     * - postcondition: authoritative check run after a successful call.
     */
    public const TOOL_META = [
        'test_database_connection' => [
            'version' => 2,
            'side_effect_class' => 'platform_metadata',
            'secret_params' => ['password' => 'database_password'],
            'requires_confirmation' => false,
            'description' => 'Check whether a database is reachable. Pass connection_id to check the live status of a SAVED connection (updates its stored status). Or pass host, port, database and username to test NEW details before saving; the password is supplied securely by the app, never by you.',
        ],
        'save_database_connection' => [
            'version' => 2,
            'side_effect_class' => 'write',
            'secret_params' => ['password' => 'database_password'],
            // The user explicitly asked to connect; the handler re-tests before saving and the
            // profile is platform-only and removable, so no extra confirmation by default.
            'requires_confirmation' => false,
            'postcondition' => 'connection_persisted',
            'description' => 'Save a new MySQL connection profile for the user. Re-tests connectivity first and refuses to save if the test fails. Requires name, host, database, username (port defaults to 3306). The password is supplied securely by the app.',
        ],
        'update_database_connection' => ['side_effect_class' => 'write', 'secret_params' => ['password' => 'database_password']],
        'disconnect_database_connection' => ['side_effect_class' => 'write', 'always_confirm' => true],
        'scan_database_schema' => ['side_effect_class' => 'platform_metadata', 'postcondition' => 'schema_snapshot_exists'],
        'get_schema_scan_status' => ['side_effect_class' => 'platform_metadata'],
        'create_automation_draft' => ['side_effect_class' => 'write', 'postcondition' => 'automation_persisted'],
        'update_automation' => ['side_effect_class' => 'write'],
        'remove_automation' => ['side_effect_class' => 'write', 'always_confirm' => true],
        'run_automation_now' => ['side_effect_class' => 'external'],
        'update_published_record' => ['side_effect_class' => 'external', 'always_confirm' => true],
        'approve_content_version' => ['side_effect_class' => 'external', 'postcondition' => 'version_approved'],
        'reject_content_version' => ['side_effect_class' => 'write'],
        'retry_execution' => ['side_effect_class' => 'write'],
        'request_execution_interrupt' => ['side_effect_class' => 'write'],
        'test_ai_provider' => ['secret_params' => ['api_key' => 'api_key']],
        'save_ai_provider' => ['side_effect_class' => 'write', 'secret_params' => ['api_key' => 'api_key']],
        'remove_knowledge_document' => ['side_effect_class' => 'write', 'always_confirm' => true],
        'ask_database' => ['side_effect_class' => 'read'],
        'find_dummy_data' => ['side_effect_class' => 'read'],
        'preview_data_change' => ['side_effect_class' => 'platform_metadata'],
        'confirm_data_change' => ['side_effect_class' => 'external', 'always_confirm' => true],
        'undo_data_change' => ['side_effect_class' => 'external', 'always_confirm' => true],
    ];

    /**
     * Full definition for one tool, merged with agent-loop metadata. Null for unknown tools.
     */
    public static function definition(string $name): ?array
    {
        $def = collect(self::getToolDefinitions())->firstWhere('name', $name);
        if (!$def) {
            return null;
        }
        $meta = self::TOOL_META[$name] ?? [];

        $isUi = in_array($name, self::UI_TOOLS, true);

        return array_merge($def, [
            'version' => $meta['version'] ?? 1,
            'side_effect_class' => $isUi ? 'ui' : ($meta['side_effect_class'] ?? (($def['read_only'] ?? false) ? 'read' : 'write')),
            'secret_params' => $meta['secret_params'] ?? [],
            'always_confirm' => $meta['always_confirm'] ?? false,
            'requires_confirmation' => $meta['requires_confirmation'] ?? ($def['requires_confirmation'] ?? false),
            'postcondition' => $meta['postcondition'] ?? null,
            'description' => $meta['description'] ?? $def['description'],
        ]);
    }

    /**
     * Parameter schema the model is allowed to fill: secret params removed, no extra properties.
     */
    public static function modelParameterSchema(array $def): array
    {
        $params = $def['parameters'] ?? ['type' => 'object', 'properties' => []];
        $secret = array_keys($def['secret_params'] ?? []);
        $props = array_diff_key($params['properties'] ?? [], array_flip($secret));
        $required = array_values(array_diff($params['required'] ?? [], $secret));

        $schema = ['type' => 'object', 'properties' => (object) $props, 'additionalProperties' => false];
        if ($required) {
            $schema['required'] = $required;
        }

        return $schema;
    }

    /**
     * Tool schemas sent to the model, generated from the same definitions the executor
     * validates against, with live availability for this user.
     */
    public static function modelVisibleSchemas(User $user, string $autonomyLevel = 'CONFIRM_CONSEQUENTIAL_CHANGES'): array
    {
        $availability = self::getDynamicToolAvailability($user);
        $out = [];
        foreach (self::getToolDefinitions() as $raw) {
            $def = self::definition($raw['name']);
            $out[] = [
                'name' => $def['name'],
                'description' => $def['description'],
                'parameters' => self::modelParameterSchema($def),
                'side_effect_class' => $def['side_effect_class'],
                'requires_confirmation' => self::needsConfirmation($def, $autonomyLevel),
                'available' => $availability[$def['name']]['available'] ?? true,
                'unavailable_reason' => $availability[$def['name']]['reason'] ?? null,
            ];
        }

        return $out;
    }

    /**
     * Confirmation policy: always for always_confirm tools; otherwise by autonomy level.
     */
    public static function needsConfirmation(array $def, string $autonomyLevel): bool
    {
        if ($def['always_confirm'] ?? false) {
            return true;
        }
        // UI tools are gated per catalog action (consequential => confirm) in ToolPolicyGate.
        $mutates = !in_array($def['side_effect_class'] ?? 'read', ['read', 'platform_metadata', 'ui'], true);

        return match ($autonomyLevel) {
            'PREPARE_FOR_REVIEW' => $mutates,
            'AUTOMATIC_WITHIN_PERMISSIONS' => false,
            default => $mutates && ($def['requires_confirmation'] ?? false),
        };
    }

    /**
     * Determine dynamic availability for every tool based on live user context.
     */
    public static function getDynamicToolAvailability(User $user): array
    {
        $connCount = DbConnection::where('user_id', $user->id)->count();
        $autoCount = Automation::where('user_id', $user->id)->count();
        $execCount = AutomationExecution::where('user_id', $user->id)->count();
        $pendingCount = AutomationExecution::where('user_id', $user->id)->where('status', 'PENDING_APPROVAL')->count();
        $docCount = KnowledgeDocument::where('user_id', $user->id)->count();
        $providerCount = AiProvider::where('user_id', $user->id)->count();

        $availability = [];

        $browser = UiActionCoordinator::clientPresent($user->id);
        foreach (self::getToolDefinitions() as $tool) {
            $name = $tool['name'];
            $available = true;
            $reason = null;

            if (in_array($name, self::UI_TOOLS, true) && !$browser) {
                $available = false;
                $reason = 'Orbit can only operate the screen while the portal is open in a browser (NO_BROWSER).';
            }

            // Connection-dependent tools
            if (in_array($name, ['scan_database_schema', 'get_schema_scan_status', 'lookup_table_values'])) {
                if ($connCount === 0) {
                    $available = false;
                    $reason = 'No database connected yet. Connect a database first.';
                }
            }

            // Automation-dependent tools
            if (in_array($name, ['run_automation_now', 'get_automation_details', 'update_automation', 'remove_automation'])) {
                if ($autoCount === 0) {
                    $available = false;
                    $reason = 'No automations configured yet.';
                }
            }

            // Execution-dependent tools
            if (in_array($name, ['get_execution_status', 'retry_execution', 'request_execution_interrupt', 'update_published_record'])) {
                if ($execCount === 0) {
                    $available = false;
                    $reason = 'No execution history available.';
                }
            }

            // Approval-dependent tools
            if (in_array($name, ['approve_content_version', 'reject_content_version'])) {
                if ($pendingCount === 0) {
                    $available = false;
                    $reason = 'No content drafts currently waiting for approval.';
                }
            }

            // Knowledge-dependent tools
            if (in_array($name, ['query_knowledge_base', 'remove_knowledge_document'])) {
                if ($docCount === 0) {
                    $available = false;
                    $reason = 'No knowledge base documents uploaded yet.';
                }
            }

            $availability[$name] = [
                'available' => $available,
                'reason' => $reason,
            ];
        }

        return $availability;
    }

    /**
     * Execute a registered tool on behalf of the authenticated user.
     * Guaranteed tenant scoping and validation.
     */
    public static function executeTool(User $user, string $toolName, array $args = []): array
    {
        // Enforce hard security guardrail: strictly block destructive customer SQL and raw consoles
        $prohibited = ['drop', 'truncate', 'alter', 'create_table', 'raw_sql', 'sql_console', 'execute_sql'];
        $lower = strtolower($toolName);
        foreach ($prohibited as $p) {
            if (str_contains($lower, $p)) {
                return [
                    'success' => false,
                    'error' => "Action '{$toolName}' violates database safety guardrails. DDL and raw SQL console are strictly prohibited.",
                ];
            }
        }

        switch ($toolName) {
            case 'list_database_connections':
                return self::listDatabaseConnections($user);

            case 'test_database_connection':
                return self::testDatabaseConnection($user, $args);

            case 'save_database_connection':
                return self::saveDatabaseConnection($user, $args);

            case 'update_database_connection':
                return self::updateDatabaseConnection($user, $args);

            case 'disconnect_database_connection':
                return self::deleteDatabaseConnection($user, $args);

            case 'scan_database_schema':
                return self::scanDatabaseSchema($user, $args);

            case 'get_schema_scan_status':
                return self::getSchemaScanStatus($user, $args);

            case 'lookup_table_values':
                return self::lookupTableValues($user, $args);

            case 'list_automations':
                return self::listAutomations($user);

            case 'get_automation_details':
                return self::getAutomationDetails($user, $args);

            case 'create_automation_draft':
                return self::createAutomationDraft($user, $args);

            case 'update_automation':
                return self::updateAutomation($user, $args);

            case 'remove_automation':
                return self::deleteAutomation($user, $args);

            case 'run_automation_now':
                return self::runAutomationNow($user, $args);

            case 'preview_automation_content':
                return self::previewAutomationContent($user, $args);

            case 'list_executions':
                return self::listExecutions($user, $args);

            case 'get_execution_status':
                return self::getExecutionStatus($user, $args);

            case 'retry_execution':
                return self::retryExecution($user, $args);

            case 'request_execution_interrupt':
                return self::requestExecutionInterrupt($user, $args);

            case 'explain_execution_failure':
                return self::explainExecutionFailure($user, $args);

            case 'update_published_record':
                return self::updatePublishedRecord($user, $args);

            case 'get_pending_approvals':
                return self::getPendingApprovals($user);

            case 'approve_content_version':
                return self::approveContentVersion($user, $args);

            case 'reject_content_version':
                return self::rejectContentVersion($user, $args);

            case 'list_ai_providers':
                return self::listAiProviders($user);

            case 'test_ai_provider':
                return self::testAiProvider($user, $args);

            case 'save_ai_provider':
                return self::saveAiProvider($user, $args);

            case 'get_provider_health':
                return self::getProviderHealth();

            case 'list_knowledge_documents':
                return self::listKnowledgeDocuments($user);

            case 'query_knowledge_base':
                return self::queryKnowledgeBase($user, $args);

            case 'remove_knowledge_document':
                return self::deleteKnowledgeDocument($user, $args);

            case 'get_dashboard_summary':
                return self::getDashboardSummary($user);

            case 'list_audit_logs':
                return self::listAuditLogs($user, $args);

            case 'ask_database':
                return app(\App\Services\Data\DataAgentService::class)->ask(
                    $user,
                    $args['question'],
                    $args['connection_id'] ?? null,
                    ['reveal_pii' => $args['reveal_pii'] ?? false]
                );

            case 'find_dummy_data':
                $connId = $args['connection_id'] ?? null;
                $conn = $connId 
                    ? DbConnection::where('id', $connId)->where('user_id', $user->id)->firstOrFail()
                    : DbConnection::where('user_id', $user->id)->where('is_active', true)->firstOrFail();
                $res = app(\App\Services\Data\DummyDataDetector::class)->detect($conn, $args['table']);
                return ['success' => true, 'report' => $res];

            case 'preview_data_change':
                $conn = DbConnection::where('id', $args['connection_id'])->where('user_id', $user->id)->firstOrFail();
                if ($args['action'] === 'update') {
                    return app(\App\Services\Data\DataChangeService::class)->previewUpdate(
                        $conn, $user, $args['table'], $args['filter'], $args['patch_values'] ?? []
                    );
                } else {
                    return app(\App\Services\Data\DataChangeService::class)->previewDelete(
                        $conn, $user, $args['table'], $args['filter']
                    );
                }

            case 'confirm_data_change':
                return app(\App\Services\Data\DataChangeService::class)->executeChange(
                    $user, $args['change_request_id'], $args['typed_phrase'] ?? null
                );

            case 'undo_data_change':
                return app(\App\Services\Data\DataChangeService::class)->undo(
                    $user, $args['change_request_id']
                );

            default:
                return [
                    'success' => false,
                    'error' => "Unknown or unregistered tool '{$toolName}'.",
                ];
        }
    }

    // =========================================================================
    // Tool Implementations
    // =========================================================================

    protected static function listDatabaseConnections(User $user): array
    {
        $connections = DbConnection::where('user_id', $user->id)
            ->get()
            ->map(fn ($c) => [
                'id' => $c->id,
                'name' => $c->name,
                'db_type' => $c->db_type,
                'host' => $c->host,
                'port' => $c->port,
                'database_name' => $c->database_name,
                'username' => $c->username,
                'status' => $c->status,
                'server_version' => $c->server_version,
                'latency_ms' => $c->latency_ms,
                'last_tested_at' => $c->last_tested_at ? $c->last_tested_at->toIso8601String() : null,
            ]);

        return [
            'success' => true,
            'connections' => $connections,
            'total' => $connections->count(),
            'message' => "Found {$connections->count()} database connection(s) in workspace.",
        ];
    }

    protected static function testDatabaseConnection(User $user, array $args): array
    {
        if (!empty($args['connection_id'])) {
            $conn = DbConnection::where('user_id', $user->id)->find($args['connection_id']);
            if (!$conn) {
                return ['success' => false, 'error' => 'Database connection profile not found.'];
            }
            $host = $conn->host;
            $port = $conn->port;
            $dbName = $conn->database_name;
            $username = $conn->username;
            $password = $conn->encrypted_password;
            $sslMode = $conn->ssl_mode ?: 'prefer';
        } else {
            $host = $args['host'] ?? '';
            $port = (int) ($args['port'] ?? 3306);
            $dbName = $args['database'] ?? ($args['database_name'] ?? '');
            $username = $args['username'] ?? '';
            $password = $args['password'] ?? '';
            $sslMode = $args['ssl_mode'] ?? 'prefer';

            if (empty($host) || empty($dbName) || empty($username)) {
                return ['success' => false, 'error' => 'Missing host, database name, or username.'];
            }
        }

        // Validate SSRF Guardrail
        $safety = new DatabaseSafetyService();
        try {
            $safety->validateConnectionTarget($host, $port);
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }

        // Perform PDO handshake
        $start = microtime(true);
        try {
            $dsn = "mysql:host={$host};port={$port};dbname={$dbName};charset=utf8mb4";
            $options = [
                \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
                \PDO::ATTR_TIMEOUT => 4,
            ];
            $pdo = new \PDO($dsn, $username, $password, $options);
            $serverVersion = $pdo->getAttribute(\PDO::ATTR_SERVER_VERSION);
            $latency = round((microtime(true) - $start) * 1000, 2);
            unset($pdo);

            if (isset($conn)) {
                self::recordConnectionStatus($user, $conn, true, $serverVersion, $latency, null);
            }

            return [
                'success' => true,
                'message' => isset($conn)
                    ? "Saved connection '{$conn->name}' is reachable (MySQL {$serverVersion}, {$latency}ms)."
                    : "Connection successful (Server: {$serverVersion}, Latency: {$latency}ms).",
                'connection_id' => isset($conn) ? $conn->id : null,
                'connection_name' => isset($conn) ? $conn->name : null,
                'status' => 'connected',
                'server_version' => $serverVersion,
                'latency_ms' => $latency,
            ];
        } catch (\Throwable $e) {
            $error = 'Connection test failed: ' . $e->getMessage();
            if (isset($conn)) {
                self::recordConnectionStatus($user, $conn, false, null, null, $error);
            }

            return [
                'success' => false,
                'error' => $error,
                'connection_id' => isset($conn) ? $conn->id : null,
                'status' => 'connection_error',
            ];
        }
    }

    protected static function recordConnectionStatus(User $user, DbConnection $conn, bool $ok, ?string $version, ?float $latency, ?string $error): void
    {
        $conn->update([
            'status' => $ok ? 'connected' : 'connection_error',
            'last_tested_at' => now(),
            'server_version' => $version ?? $conn->server_version,
            'latency_ms' => $latency,
            'error_message' => $ok ? null : $error,
        ]);
        LiveEventService::publish($user->id, 'connection.tested', [
            'id' => $conn->id,
            'status' => $conn->status,
            'latency_ms' => $conn->latency_ms,
            'server_version' => $conn->server_version,
            'last_tested_at' => $conn->last_tested_at?->toIso8601String(),
        ], 'DbConnection', (string) $conn->id);
    }

    protected static function saveDatabaseConnection(User $user, array $args): array
    {
        $name = trim($args['name'] ?? '');
        $host = trim($args['host'] ?? '');
        $port = (int) ($args['port'] ?? 3306);
        $dbName = trim($args['database'] ?? ($args['database_name'] ?? ''));
        $username = trim($args['username'] ?? '');
        $password = $args['password'] ?? '';
        $sslMode = in_array($args['ssl_mode'] ?? '', ['require', 'disable']) ? $args['ssl_mode'] : 'prefer';

        if (empty($name) || empty($host) || empty($dbName) || empty($username) || empty($password)) {
            return [
                'success' => false,
                'error' => 'All connection parameters (name, host, database, username, password) are required.',
            ];
        }

        $existing = DbConnection::where('user_id', $user->id)
            ->where('host', $host)->where('port', $port)
            ->where('database_name', $dbName)->where('username', $username)
            ->first();
        if ($existing) {
            return [
                'success' => false,
                'error_category' => 'CONFLICT',
                'error' => "A saved connection for {$username}@{$host}:{$port}/{$dbName} already exists ('{$existing->name}', id {$existing->id}). Test that connection_id instead of saving a duplicate.",
                'connection_id' => $existing->id,
            ];
        }

        $safety = new DatabaseSafetyService();
        try {
            $safety->validateConnectionTarget($host, $port);
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }

        // Pre-test credentials before saving
        $testResult = self::testDatabaseConnection($user, [
            'host' => $host,
            'port' => $port,
            'database' => $dbName,
            'username' => $username,
            'password' => $password,
            'ssl_mode' => $sslMode,
        ]);

        if (!$testResult['success']) {
            return [
                'success' => false,
                'error' => 'Cannot save connection: verification failed. ' . $testResult['error'],
            ];
        }

        $conn = DbConnection::create([
            'user_id' => $user->id,
            'name' => $name,
            'db_type' => 'mysql',
            'host' => $host,
            'port' => $port,
            'database_name' => $dbName,
            'username' => $username,
            'encrypted_password' => $password, // Auto-encrypted by Model cast
            'ssl_mode' => $sslMode,
            'status' => 'connected',
            'server_version' => $testResult['server_version'] ?? 'MySQL 8.0',
            'latency_ms' => $testResult['latency_ms'] ?? 10.0,
            'last_tested_at' => now(),
        ]);

        AuditLog::log(
            $user->id,
            'AGENT_CONNECTION_SAVED',
            'DbConnection',
            (string) $conn->id,
            ['name' => $conn->name, 'host' => $conn->host, 'database' => $conn->database_name]
        );

        return [
            'success' => true,
            'connection_id' => $conn->id,
            'name' => $conn->name,
            'message' => "Database connection '{$conn->name}' verified and saved successfully with encrypted credentials.",
        ];
    }

    protected static function updateDatabaseConnection(User $user, array $args): array
    {
        $connId = (int) ($args['connection_id'] ?? 0);
        $conn = DbConnection::where('user_id', $user->id)->find($connId);
        if (!$conn) {
            return ['success' => false, 'error' => 'Database connection not found.'];
        }

        $dataToUpdate = [];
        if (!empty($args['name'])) $dataToUpdate['name'] = trim($args['name']);
        if (!empty($args['host'])) $dataToUpdate['host'] = trim($args['host']);
        if (!empty($args['port'])) $dataToUpdate['port'] = (int) $args['port'];
        if (!empty($args['ssl_mode'])) $dataToUpdate['ssl_mode'] = $args['ssl_mode'];

        if (!empty($dataToUpdate)) {
            $conn->update($dataToUpdate);
            AuditLog::log($user->id, 'AGENT_CONNECTION_UPDATED', 'DbConnection', (string) $conn->id, $dataToUpdate);
        }

        return [
            'success' => true,
            'connection_id' => $conn->id,
            'message' => "Connection '{$conn->name}' updated successfully.",
        ];
    }

    protected static function deleteDatabaseConnection(User $user, array $args): array
    {
        $connId = (int) ($args['connection_id'] ?? 0);
        $conn = DbConnection::where('user_id', $user->id)->find($connId);
        if (!$conn) {
            return ['success' => false, 'error' => 'Database connection not found.'];
        }

        $activeAutomations = $conn->automations()->where('is_active', true)->get();
        if ($activeAutomations->count() > 0 && empty($args['force'])) {
            return [
                'success' => false,
                'error' => "Cannot disconnect: {$activeAutomations->count()} active automation(s) depend on it ({$activeAutomations->pluck('name')->implode(', ')}). Disable them first or confirm with force=true.",
            ];
        }

        if ($activeAutomations->count() > 0) {
            $conn->automations()->update(['is_active' => false]);
        }

        $connName = $conn->name;
        $conn->delete();

        AuditLog::log($user->id, 'AGENT_CONNECTION_DELETED', 'DbConnection', (string) $connId);

        return [
            'success' => true,
            'connection_id' => $connId,
            'message' => "Database connection profile '{$connName}' removed successfully (target database untouched).",
        ];
    }

    protected static function scanDatabaseSchema(User $user, array $args): array
    {
        $conn = DbConnection::where('user_id', $user->id)->find($args['connection_id'] ?? 0);
        if (!$conn) {
            return ['success' => false, 'error' => 'Database connection not found.'];
        }

        try {
            $service = app(SchemaIntrospectionService::class);
            $schema = $service->introspectSchema($conn);
            $conn->update([
                'schema_freshness_at' => now(),
            ]);

            return [
                'success' => true,
                'connection_id' => $conn->id,
                'connection_name' => $conn->name,
                'total_tables' => count($schema['tables'] ?? []),
                'eligible_tables' => array_values(array_filter($schema['tables'] ?? [], fn ($t) => empty($t['is_sensitive']) && ($t['category'] ?? '') !== 'RESTRICTED')),
                'tables' => $schema['tables'] ?? [],
                'message' => "Discovered " . count($schema['tables'] ?? []) . " tables in connection '{$conn->name}'.",
            ];
        } catch (\Throwable $e) {
            return [
                'success' => false,
                'error' => 'Failed to scan schema: ' . $e->getMessage(),
            ];
        }
    }

    protected static function getSchemaScanStatus(User $user, array $args): array
    {
        return self::scanDatabaseSchema($user, $args);
    }

    protected static function lookupTableValues(User $user, array $args): array
    {
        $conn = DbConnection::where('user_id', $user->id)->find($args['connection_id'] ?? 0);
        if (!$conn) {
            return ['success' => false, 'error' => 'Database connection not found.'];
        }

        $table = trim($args['table'] ?? '');
        $safety = new DatabaseSafetyService();
        if ($safety->isTableSensitive($table)) {
            return ['success' => false, 'error' => "Table '{$table}' is sensitive and restricted."];
        }

        try {
            $service = app(SafeDatabaseExecutor::class);
            $records = $service->fetchLookupRecords($conn, $table, 10);
            return [
                'success' => true,
                'table' => $table,
                'count' => count($records),
                'values' => $records,
                'message' => "Retrieved " . count($records) . " sample records from '{$table}'.",
            ];
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => "Lookup failed: " . $e->getMessage()];
        }
    }

    protected static function listAutomations(User $user): array
    {
        $automations = Automation::where('user_id', $user->id)
            ->with(['connection'])
            ->get()
            ->map(fn ($a) => [
                'id' => $a->id,
                'name' => $a->name,
                'target_table' => $a->target_table,
                'connection_name' => $a->connection?->name,
                'schedule_type' => $a->schedule_type,
                'generation_time' => $a->generation_time,
                'publication_time' => $a->publication_time,
                'timezone' => $a->timezone,
                'requires_approval' => $a->requires_approval,
                'is_active' => $a->is_active,
            ]);

        return [
            'success' => true,
            'automations' => $automations,
            'total' => $automations->count(),
            'message' => "Found {$automations->count()} configured automation(s).",
        ];
    }

    protected static function getAutomationDetails(User $user, array $args): array
    {
        $automation = Automation::where('user_id', $user->id)->with(['connection'])->find($args['automation_id'] ?? 0);
        if (!$automation) {
            return ['success' => false, 'error' => 'Automation not found.'];
        }

        return [
            'success' => true,
            'automation' => [
                'id' => $automation->id,
                'name' => $automation->name,
                'target_table' => $automation->target_table,
                'connection_id' => $automation->connection_id,
                'connection_name' => $automation->connection?->name,
                'prompt_context' => $automation->prompt_context,
                'field_mappings' => $automation->field_mappings,
                'schedule_type' => $automation->schedule_type,
                'generation_time' => $automation->generation_time,
                'publication_time' => $automation->publication_time,
                'timezone' => $automation->timezone,
                'requires_approval' => $automation->requires_approval,
                'is_active' => $automation->is_active,
            ],
        ];
    }

    protected static function createAutomationDraft(User $user, array $args): array
    {
        $connId = (int) ($args['connection_id'] ?? 0);
        $conn = DbConnection::where('user_id', $user->id)->find($connId);
        if (!$conn) {
            return ['success' => false, 'error' => 'Invalid or unauthorized database connection ID.'];
        }

        $targetTable = trim($args['target_table'] ?? '') ?: 'posts';
        $name = trim($args['name'] ?? '');
        if (empty($name)) {
            return ['success' => false, 'error' => 'Automation name is required.'];
        }

        // Enforce Lead Time Buffer
        $genTime = $args['generation_time'] ?? '08:00';
        $pubTime = $args['publication_time'] ?? '09:00';
        $timezone = $args['timezone'] ?? 'Asia/Kolkata';

        $leadTimeValidation = self::validateLeadTime($genTime, $pubTime);
        if (!$leadTimeValidation['valid']) {
            return ['success' => false, 'error' => $leadTimeValidation['error']];
        }

        // Check if target table is safe
        $safety = new DatabaseSafetyService();
        if ($safety->isTableSensitive($targetTable)) {
            return [
                'success' => false,
                'error' => "Target table '{$targetTable}' contains restricted system/auth data and cannot be automated.",
            ];
        }

        $fieldMappings = $args['field_mappings'] ?? [
            ['field_name' => 'title', 'mapping_type' => 'AI_GENERATED'],
            ['field_name' => 'content', 'mapping_type' => 'AI_GENERATED'],
            ['field_name' => 'slug', 'mapping_type' => 'DERIVED_SLUG', 'source_field' => 'title'],
            ['field_name' => 'status', 'mapping_type' => 'FIXED_VALUE', 'fixed_value' => 'published'],
        ];

        $promptContext = $args['topic_prompt'] ?? "High quality articles about {$name}";
        if (!empty($args['category_name'])) {
            $promptContext .= " [Category: {$args['category_name']}]";
        }

        $automation = Automation::create([
            'user_id' => $user->id,
            'connection_id' => $conn->id,
            'name' => $name,
            'target_table' => $targetTable,
            'operation_mode' => $args['operation_mode'] ?? 'AI_CREATE',
            'prompt_context' => $promptContext,
            'field_mappings' => $fieldMappings,
            'schedule_type' => $args['schedule_type'] ?? 'DAILY',
            'generation_time' => $genTime,
            'publication_time' => $pubTime,
            'timezone' => $timezone,
            'requires_approval' => (bool) ($args['requires_approval'] ?? false),
            'timeout_policy' => 'AUTO_PUBLISH_LATEST',
            'is_active' => (bool) ($args['is_active'] ?? true),
        ]);

        AuditLog::log(
            $user->id,
            'AGENT_AUTOMATION_CREATED',
            'Automation',
            (string) $automation->id,
            ['name' => $automation->name, 'target_table' => $automation->target_table]
        );

        return [
            'success' => true,
            'automation_id' => $automation->id,
            'name' => $automation->name,
            'target_table' => $automation->target_table,
            'is_active' => $automation->is_active,
            'message' => "Automation '{$automation->name}' created and configured for {$automation->target_table} (Schedule: {$genTime} -> {$pubTime} in {$timezone}).",
        ];
    }

    protected static function updateAutomation(User $user, array $args): array
    {
        $automation = Automation::where('user_id', $user->id)->find($args['automation_id'] ?? 0);
        if (!$automation) {
            return ['success' => false, 'error' => 'Automation not found.'];
        }

        $dataToUpdate = [];
        if (!empty($args['name'])) $dataToUpdate['name'] = trim($args['name']);
        if (isset($args['is_active'])) $dataToUpdate['is_active'] = (bool) $args['is_active'];
        if (!empty($args['schedule_type'])) $dataToUpdate['schedule_type'] = $args['schedule_type'];

        $genTime = $args['generation_time'] ?? $automation->generation_time;
        $pubTime = $args['publication_time'] ?? $automation->publication_time;
        if (!empty($args['generation_time']) || !empty($args['publication_time'])) {
            $validation = self::validateLeadTime($genTime, $pubTime);
            if (!$validation['valid']) {
                return ['success' => false, 'error' => $validation['error']];
            }
            $dataToUpdate['generation_time'] = $genTime;
            $dataToUpdate['publication_time'] = $pubTime;
        }

        if (!empty($args['category_name']) || !empty($args['topic_prompt'])) {
            $currentContext = $automation->prompt_context;
            if (!empty($args['category_name'])) {
                $newCat = trim($args['category_name']);
                if (preg_match('/\[Category:.*?\]/', $currentContext)) {
                    $currentContext = preg_replace('/\[Category:.*?\]/', "[Category: {$newCat}]", $currentContext);
                } else {
                    $currentContext .= " [Category: {$newCat}]";
                }
            }
            if (!empty($args['topic_prompt'])) {
                $currentContext = trim($args['topic_prompt']) . (preg_match('/\[Category:.*?\]/', $currentContext, $m) ? " {$m[0]}" : "");
            }
            $dataToUpdate['prompt_context'] = $currentContext;
        }

        if (!empty($dataToUpdate)) {
            $automation->update($dataToUpdate);
            AuditLog::log($user->id, 'AGENT_AUTOMATION_UPDATED', 'Automation', (string) $automation->id, $dataToUpdate);
        }

        return [
            'success' => true,
            'automation_id' => $automation->id,
            'message' => "Automation '{$automation->name}' updated successfully.",
        ];
    }

    protected static function deleteAutomation(User $user, array $args): array
    {
        $automation = Automation::where('user_id', $user->id)->find($args['automation_id'] ?? 0);
        if (!$automation) {
            return ['success' => false, 'error' => 'Automation not found.'];
        }

        $name = $automation->name;
        $id = $automation->id;
        $automation->delete();

        AuditLog::log($user->id, 'AGENT_AUTOMATION_DELETED', 'Automation', (string) $id);

        return [
            'success' => true,
            'automation_id' => $id,
            'message' => "Automation '{$name}' deleted from platform.",
        ];
    }

    protected static function runAutomationNow(User $user, array $args): array
    {
        $automationId = (int) ($args['automation_id'] ?? 0);
        $automation = Automation::where('user_id', $user->id)->find($automationId);
        if (!$automation) {
            return ['success' => false, 'error' => 'Automation workflow not found.'];
        }

        $idempotencyKey = 'agent_run_' . $automation->id . '_' . date('Y-m-d_H-i-s') . '_' . Str::random(6);

        $execution = AutomationExecution::create([
            'automation_id' => $automation->id,
            'user_id' => $user->id,
            'status' => 'PENDING_GENERATION',
            'idempotency_key' => $idempotencyKey,
            'timeline_events' => [
                [
                    'stage' => 'DISPATCHED_BY_AGENT',
                    'timestamp' => now()->toIso8601String(),
                    'message' => 'Agent requested immediate execution.',
                ],
            ],
        ]);

        ProcessAutomationExecution::dispatch($execution->id);

        return [
            'success' => true,
            'execution_id' => $execution->id,
            'status' => $execution->status,
            'message' => "Execution #{$execution->id} queued for immediate background processing.",
        ];
    }

    protected static function previewAutomationContent(User $user, array $args): array
    {
        $prompt = trim($args['prompt'] ?? 'General technology update');
        $targetTable = $args['target_table'] ?? 'posts';

        try {
            $ai = new AiServiceClient();
            $res = $ai->generateContent([
                'prompt' => $prompt,
                'target_table' => $targetTable,
                'required_fields' => ['title', 'slug', 'content', 'excerpt'],
            ]);
            return [
                'success' => true,
                'preview' => $res['data'] ?? [],
                'message' => 'Preview content generated successfully.',
            ];
        } catch (\Throwable $e) {
            return [
                'success' => false,
                'error' => 'Preview generation failed: ' . $e->getMessage(),
            ];
        }
    }

    protected static function listExecutions(User $user, array $args): array
    {
        $query = AutomationExecution::where('user_id', $user->id)->with(['automation'])->latest('id');
        if (!empty($args['status'])) {
            $query->where('status', $args['status']);
        }
        $limit = min((int) ($args['limit'] ?? 10), 50);
        $executions = $query->limit($limit)->get()->map(fn ($e) => [
            'id' => $e->id,
            'automation_id' => $e->automation_id,
            'automation_name' => $e->automation?->name,
            'status' => $e->status,
            'target_record_id' => $e->target_record_id,
            'created_at' => $e->created_at->toIso8601String(),
        ]);

        return [
            'success' => true,
            'executions' => $executions,
            'total' => $executions->count(),
            'message' => "Found {$executions->count()} execution record(s).",
        ];
    }

    protected static function getExecutionStatus(User $user, array $args): array
    {
        $execution = AutomationExecution::where('user_id', $user->id)->find($args['execution_id'] ?? 0);
        if (!$execution) {
            return ['success' => false, 'error' => 'Execution record not found.'];
        }

        return [
            'success' => true,
            'id' => $execution->id,
            'automation_id' => $execution->automation_id,
            'status' => $execution->status,
            'target_record_id' => $execution->target_record_id,
            'error_message' => $execution->error_message,
            'timeline_events' => $execution->timeline_events ?? [],
            'created_at' => $execution->created_at->toIso8601String(),
        ];
    }

    protected static function retryExecution(User $user, array $args): array
    {
        $execution = AutomationExecution::where('user_id', $user->id)->find($args['execution_id'] ?? 0);
        if (!$execution) {
            return ['success' => false, 'error' => 'Execution not found.'];
        }

        $execution->update([
            'status' => 'PENDING_GENERATION',
            'error_message' => null,
        ]);

        ProcessAutomationExecution::dispatch($execution->id);

        return [
            'success' => true,
            'execution_id' => $execution->id,
            'status' => $execution->status,
            'message' => "Execution #{$execution->id} reset and re-queued for processing.",
        ];
    }

    protected static function requestExecutionInterrupt(User $user, array $args): array
    {
        $execution = AutomationExecution::where('user_id', $user->id)->find($args['execution_id'] ?? 0);
        if (!$execution) {
            return ['success' => false, 'error' => 'Execution not found.'];
        }

        $action = strtolower($args['action'] ?? 'cancel');
        if ($action === 'pause') {
            $execution->update(['status' => 'PAUSED']);
            $msg = "Execution #{$execution->id} paused.";
        } else {
            $execution->update(['status' => 'CANCELLED']);
            $msg = "Execution #{$execution->id} cancelled safely at boundary.";
        }

        return [
            'success' => true,
            'execution_id' => $execution->id,
            'status' => $execution->status,
            'message' => $msg,
        ];
    }

    protected static function explainExecutionFailure(User $user, array $args): array
    {
        $query = AutomationExecution::where('user_id', $user->id)->where('status', 'FAILED')->orderBy('id', 'desc');
        if (!empty($args['execution_id'])) {
            $query->where('id', $args['execution_id']);
        }
        $failed = $query->first();

        if (!$failed) {
            return [
                'success' => true,
                'message' => 'No failed executions found in your workspace history.',
            ];
        }

        $err = $failed->error_message ?: 'Unknown error occurred during execution.';
        $diag = 'Analysis: ';
        if (str_contains(strtolower($err), 'lead time')) {
            $diag .= 'Generation lead time was under 30 minutes before publication. Safe fix: adjust publication time to be at least 30 minutes after generation.';
        } elseif (str_contains(strtolower($err), 'connection')) {
            $diag .= 'Target database was unreachable. Safe fix: verify host, port, firewall rules, and password in Connections.';
        } elseif (str_contains(strtolower($err), 'restricted')) {
            $diag .= 'Table access was blocked by safety policy. Safe fix: select an eligible content table (e.g. posts, customer_blogs).';
        } else {
            $diag .= "Review configuration or retry: \"{$err}\".";
        }

        return [
            'success' => true,
            'execution_id' => $failed->id,
            'automation_name' => $failed->automation?->name,
            'error_message' => $err,
            'explanation' => $diag,
            'can_retry' => true,
        ];
    }

    protected static function updatePublishedRecord(User $user, array $args): array
    {
        $execution = AutomationExecution::where('user_id', $user->id)->find($args['execution_id'] ?? 0);
        if (!$execution) {
            return ['success' => false, 'error' => 'Execution record not found.'];
        }

        if ($execution->status !== 'PUBLISHED' || empty($execution->target_record_id)) {
            return ['success' => false, 'error' => 'Only published executions with a verified target record ID can be updated.'];
        }

        $fields = $args['fields'] ?? [];
        if (empty($fields) || !is_array($fields)) {
            return ['success' => false, 'error' => 'Update fields payload must not be empty.'];
        }

        $automation = $execution->automation;
        if (!$automation || !$automation->connection) {
            return ['success' => false, 'error' => 'Associated database connection not available.'];
        }

        $res = SafeDatabaseExecutor::executeScopedUpdate(
            $automation->connection,
            $automation->target_table,
            (int) $execution->target_record_id,
            $fields
        );

        if (!$res['success']) {
            return ['success' => false, 'error' => $res['error'] ?? 'Scoped update failed.'];
        }

        AuditLog::log(
            $user->id,
            'AGENT_RECORD_UPDATED',
            'AutomationExecution',
            (string) $execution->id,
            ['fields_updated' => array_keys($fields)]
        );

        return [
            'success' => true,
            'target_record_id' => $execution->target_record_id,
            'message' => "Record #{$execution->target_record_id} in table '{$automation->target_table}' was updated successfully.",
        ];
    }

    protected static function getPendingApprovals(User $user): array
    {
        $pending = AutomationExecution::where('user_id', $user->id)
            ->where('status', 'PENDING_APPROVAL')
            ->with(['automation', 'contentVersions'])
            ->get()
            ->map(fn ($e) => [
                'execution_id' => $e->id,
                'automation_name' => $e->automation?->name,
                'target_table' => $e->automation?->target_table,
                'latest_version' => $e->contentVersions->last()?->version_number ?? 1,
                'payload_preview' => $e->contentVersions->last()?->payload ?? [],
                'created_at' => $e->created_at->toIso8601String(),
            ]);

        return [
            'success' => true,
            'pending_approvals' => $pending,
            'count' => $pending->count(),
            'message' => "Found {$pending->count()} content draft(s) pending approval.",
        ];
    }

    protected static function approveContentVersion(User $user, array $args): array
    {
        $version = ContentVersion::where('user_id', $user->id)->find($args['version_id'] ?? 0);
        if (!$version) {
            return ['success' => false, 'error' => 'Draft version not found.'];
        }

        $execution = AutomationExecution::where('user_id', $user->id)->find($version->execution_id);
        if (!$execution) {
            return ['success' => false, 'error' => 'Unauthorized or invalid execution.'];
        }

        // Same persisted state as the email approval flow (EmailApprovalService).
        $version->update(['status' => 'APPROVED']);
        $execution->update(['status' => 'APPROVED']);

        PublishApprovedExecution::dispatch($execution->id, $version->id);

        return [
            'success' => true,
            'version_id' => $version->id,
            'execution_id' => $execution->id,
            'message' => "Draft Version #{$version->version_number} approved and dispatched for publication.",
        ];
    }

    protected static function rejectContentVersion(User $user, array $args): array
    {
        $version = ContentVersion::where('user_id', $user->id)->find($args['version_id'] ?? 0);
        if (!$version) {
            return ['success' => false, 'error' => 'Draft version not found.'];
        }

        $execution = AutomationExecution::where('user_id', $user->id)->find($version->execution_id);
        if (!$execution) {
            return ['success' => false, 'error' => 'Unauthorized or invalid execution.'];
        }

        $feedback = trim($args['feedback'] ?? 'Please revise the draft.');
        $version->update([
            'status' => 'REJECTED',
            'rejection_feedback' => $feedback,
        ]);

        $execution->update(['status' => 'REJECTED']);

        ProcessAutomationExecution::dispatch($execution->id);

        return [
            'success' => true,
            'version_id' => $version->id,
            'message' => "Version #{$version->version_number} rejected. Triggered regeneration with feedback: \"{$feedback}\".",
        ];
    }

    protected static function listAiProviders(User $user): array
    {
        $providers = AiProvider::where('user_id', $user->id)->get()->map(fn ($p) => [
            'id' => $p->id,
            'provider_type' => $p->provider_type,
            'model_name' => $p->model_name,
            'masked_key' => $p->masked_key,
            'is_active' => $p->is_active,
        ]);

        return [
            'success' => true,
            'providers' => $providers,
            'count' => $providers->count(),
            'message' => "Found {$providers->count()} configured provider(s).",
        ];
    }

    protected static function testAiProvider(User $user, array $args): array
    {
        $provider = $args['provider'] ?? 'ollama';
        $model = $args['model'] ?? null;
        $key = $args['api_key'] ?? null;

        try {
            $ai = new AiServiceClient();
            $health = $ai->checkHealth($provider, $model, $key);
            return [
                'success' => true,
                'provider' => $provider,
                'available' => $health['available'] ?? false,
                'latency_ms' => $health['latency_ms'] ?? 0.0,
                'message' => $health['message'] ?? 'Provider check finished.',
            ];
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => 'Provider test failed: ' . $e->getMessage()];
        }
    }

    protected static function saveAiProvider(User $user, array $args): array
    {
        $providerType = trim($args['provider_type'] ?? '');
        if (empty($providerType)) {
            return ['success' => false, 'error' => 'Provider type is required.'];
        }

        $provider = AiProvider::updateOrCreate(
            ['user_id' => $user->id, 'provider_type' => $providerType],
            [
                'model_name' => $args['model_name'] ?? 'default',
                'encrypted_api_key' => $args['api_key'] ?? '',
                'is_active' => (bool) ($args['is_active'] ?? true),
            ]
        );

        AuditLog::log($user->id, 'AGENT_AI_PROVIDER_SAVED', 'AiProvider', (string) $provider->id);

        return [
            'success' => true,
            'provider_id' => $provider->id,
            'provider_type' => $provider->provider_type,
            'message' => "AI provider configuration for '{$providerType}' saved successfully.",
        ];
    }

    protected static function getProviderHealth(): array
    {
        try {
            $ai = new AiServiceClient();
            $health = $ai->checkHealth('ollama', 'llama3.2:1b');
            return [
                'success' => true,
                'provider' => 'ollama',
                'status' => ($health['available'] ?? false) ? 'ONLINE' : 'OFFLINE',
                'latency_ms' => $health['latency_ms'] ?? 0,
                'models' => $health['models'] ?? [],
                'message' => $health['message'] ?? 'Checked provider status.',
            ];
        } catch (\Throwable $e) {
            return [
                'success' => true,
                'provider' => 'ollama',
                'status' => 'FALLBACK_MODE',
                'message' => 'Local Ollama is offline; deterministic fallback agent engine active.',
            ];
        }
    }

    protected static function listKnowledgeDocuments(User $user): array
    {
        $docs = KnowledgeDocument::where('user_id', $user->id)->get()->map(fn ($d) => [
            'id' => $d->id,
            'title' => $d->title,
            'file_type' => $d->file_type,
            'chunks_count' => $d->chunks_count,
            'created_at' => $d->created_at->toIso8601String(),
        ]);

        return [
            'success' => true,
            'documents' => $docs,
            'total' => $docs->count(),
            'message' => "Found {$docs->count()} indexed document(s).",
        ];
    }

    protected static function queryKnowledgeBase(User $user, array $args): array
    {
        $query = trim($args['query'] ?? '');
        if (empty($query)) {
            return ['success' => false, 'error' => 'Query string is required.'];
        }

        try {
            $ai = new AiServiceClient();
            $results = $ai->queryKnowledge($user->id, $query, (int) ($args['top_k'] ?? 3));
            return [
                'success' => true,
                'query' => $query,
                'results' => $results,
                'count' => count($results),
                'message' => "Found " . count($results) . " relevant passage(s) in knowledge base.",
            ];
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => 'Search failed: ' . $e->getMessage()];
        }
    }

    protected static function deleteKnowledgeDocument(User $user, array $args): array
    {
        $doc = KnowledgeDocument::where('user_id', $user->id)->find($args['document_id'] ?? 0);
        if (!$doc) {
            return ['success' => false, 'error' => 'Knowledge document not found.'];
        }

        $docId = $doc->id;
        $title = $doc->title;

        try {
            $ai = new AiServiceClient();
            $ai->deleteDocument($user->id, $docId);
        } catch (\Throwable $e) {
            // Log vector index purge warning but proceed with DB delete
        }

        $doc->delete();
        AuditLog::log($user->id, 'AGENT_KNOWLEDGE_DELETED', 'KnowledgeDocument', (string) $docId);

        return [
            'success' => true,
            'document_id' => $docId,
            'message' => "Knowledge document '{$title}' removed from workspace.",
        ];
    }

    protected static function getDashboardSummary(User $user): array
    {
        $connCount = DbConnection::where('user_id', $user->id)->count();
        $autoCount = Automation::where('user_id', $user->id)->count();
        $execCount = AutomationExecution::where('user_id', $user->id)->count();
        $publishedCount = AutomationExecution::where('user_id', $user->id)->where('status', 'PUBLISHED')->count();
        $pendingApprovals = AutomationExecution::where('user_id', $user->id)->where('status', 'PENDING_APPROVAL')->count();

        return [
            'success' => true,
            'connections_count' => $connCount,
            'automations_count' => $autoCount,
            'executions_count' => $execCount,
            'published_count' => $publishedCount,
            'pending_approvals_count' => $pendingApprovals,
            'message' => "Workspace status: {$connCount} connection(s), {$autoCount} automation(s), {$execCount} execution(s), {$pendingApprovals} pending approval(s).",
        ];
    }

    protected static function listAuditLogs(User $user, array $args): array
    {
        $limit = min((int) ($args['limit'] ?? 15), 50);
        $logs = AuditLog::where('user_id', $user->id)->latest('id')->limit($limit)->get()->map(fn ($l) => [
            'id' => $l->id,
            'action' => $l->action,
            'resource_type' => $l->resource_type,
            'resource_id' => $l->resource_id,
            'created_at' => $l->created_at->toIso8601String(),
        ]);

        return [
            'success' => true,
            'logs' => $logs,
            'total' => $logs->count(),
            'message' => "Retrieved {$logs->count()} recent audit event(s).",
        ];
    }

    protected static function validateLeadTime(string $genTime, string $pubTime): array
    {
        [$gH, $gM] = array_map('intval', explode(':', $genTime));
        [$pH, $pM] = array_map('intval', explode(':', $pubTime));

        $genMins = $gH * 60 + $gM;
        $pubMins = $pH * 60 + $pM;

        $diff = $pubMins - $genMins;
        if ($diff < 0) {
            $diff += 1440; // Next day
        }

        if ($diff < 30) {
            return [
                'valid' => false,
                'error' => "Publication time ({$pubTime}) must be at least 30 minutes after generation time ({$genTime}) to allow AI draft preparation and review (current gap: {$diff}m).",
            ];
        }

        return ['valid' => true];
    }
}
