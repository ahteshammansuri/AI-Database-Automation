<?php

namespace App\Settings;

/**
 * Every setting an admin can change in the admin panel, in one place: where it applies (a config key, or website
 * content), its type, limits, help text and whether the portal may read it (GET /api/platform/config).
 * Config-backed settings take today's config/env value as their default; content has its default here.
 */
final class SettingsRegistry
{
    /** group => [title, short description, heroicon] (one admin page each; "content" is the Website content page) */
    public const GROUPS = [
        'general' => ['General', 'Platform name, contact details, portal address and email sender.', 'o-building-office-2'],
        'access' => ['Sign-up & limits', 'Who can sign up, password rules and what each customer may use.', 'o-user-plus'],
        'ai' => ['AI & models', 'The default model, the models customers can pick, the readiness test and the internal AI service.', 'o-cpu-chip'],
        'automations' => ['Automations', 'Review windows and links, rewrites, linked records, retries and fair scheduling.', 'o-arrow-path'],
        'data' => ['Data assistant', 'Limits for reading and changing data in customer databases: data assistant, Orbit, Data Explorer and Data Manager.', 'o-circle-stack'],
        'orbit' => ['Orbit', 'Orbit on or off, and how much time and how many steps it may take for a request.', 'o-sparkles'],
        'remote' => ['Orbit Remote', 'Pairing phones with Orbit by QR code.', 'o-device-phone-mobile'],
        'features' => ['Features', 'Turn product features on or off for every customer.', 'o-flag'],
        'content' => ['Website content', 'Texts on the public website, the sign-in pages and the announcement bar. Write {brand} to insert the brand name.', 'o-document-text'],
    ];

    /** group => section => what the section is about (shown under each section heading). */
    public const SECTIONS = [
        'general' => [
            'Brand' => 'How the product is named wherever customers see it.',
            'Addresses' => 'Where links in emails point.',
            'Email sender' => 'Who review and notification emails come from.',
            'Legal' => 'Your legal pages, linked on sign-up and in the website footer.',
        ],
        'access' => [
            'Sign-up' => 'Who can create an account and how long passwords must be.',
            'Sign-in' => 'How long customers stay signed in.',
            'Limits per customer' => 'What one customer may use. 0 means no limit.',
        ],
        'ai' => [
            'Default model' => 'Used when a customer has not chosen their own models.',
            'Models customers can choose' => 'The lists offered for each provider. Ollama lists what is installed on its server.',
            'Model checks' => 'The readiness test customers run on the AI providers page.',
            'AI service' => 'Where the platform reaches its internal AI service (it never connects to customer databases).',
        ],
        'automations' => [
            'Scheduling' => 'When content is written and when it is published.',
            'Review' => 'How reviewers approve or reject drafts.',
            'Linked records' => 'How the AI fills columns that point at another table.',
            'Reliability' => 'What happens when a background worker stops in the middle of a run.',
            'Fair scheduling' => 'How background work is shared between customers.',
        ],
        'data' => [
            'Questions' => 'Reading customer data (data assistant, Orbit, Data Explorer). Reads are always read-only, validated and limited.',
            'Changes' => 'Changing customer data (data assistant, Orbit, Data Manager). Every change is previewed and confirmed first.',
            'Data Explorer' => 'Browsing table rows in the portal.',
            'Sample data and autopilot' => 'AI sample rows, now or on a schedule.',
        ],
        'orbit' => [
            'Availability' => 'Turn Orbit on or off for every customer.',
            'Working limits' => 'How long and how many steps Orbit may take for one request.',
            'Portal link' => "How Orbit stays connected to the customer's open portal tab.",
        ],
        'remote' => [
            'Availability' => 'Let customers talk to Orbit from their phone after scanning a QR code.',
            'Limits' => 'How long codes and phone connections last, and how often a phone can send requests.',
        ],
        'features' => [
            'Automations' => 'Optional tools around automations.',
            'Safety' => 'Ways to undo published work.',
            'Databases' => 'Optional views of connected databases.',
            'Data tools' => 'Browsing and changing data in the portal.',
        ],
    ];

    public static function sectionDescription(string $group, string $section): ?string
    {
        return self::SECTIONS[$group][$section] ?? null;
    }

    private static ?array $definitions = null;

    /** @return array<string, array> key => definition */
    public static function all(): array
    {
        return self::$definitions ??= self::build();
    }

    /** @return array<string, array> */
    public static function group(string $group): array
    {
        return array_filter(self::all(), fn (array $d) => $d['group'] === $group);
    }

    public static function get(string $key): ?array
    {
        return self::all()[$key] ?? null;
    }

    private static function build(): array
    {
        $list = [
            // ---------------------------------------------------------------- general
            ['key' => 'platform.brand_name', 'group' => 'general', 'section' => 'Brand', 'type' => 'string', 'max' => 60, 'public' => true, 'also' => ['app.name'],
                'label' => 'Platform name', 'help' => 'The product name customers see on the website, in the portal, in emails, in Orbit\'s own words and in this panel. Website texts that use {brand} follow it.'],
            ['key' => 'platform.tagline', 'group' => 'general', 'section' => 'Brand', 'type' => 'string', 'max' => 80, 'public' => true,
                'label' => 'Tagline', 'help' => 'Short line under the name in the portal\'s sidebar.'],
            ['key' => 'platform.support_email', 'group' => 'general', 'section' => 'Brand', 'type' => 'email', 'nullable' => true, 'public' => true,
                'label' => 'Support email', 'help' => 'Shown on the website and to customers whose account is suspended. Leave empty to hide it.'],
            ['key' => 'app.frontend_url', 'group' => 'general', 'section' => 'Addresses', 'type' => 'url',
                'label' => 'Portal address', 'help' => 'Review links in approval emails open this address, e.g. https://app.example.com.'],
            ['key' => 'mail.from.address', 'group' => 'general', 'section' => 'Email sender', 'type' => 'email',
                'label' => 'From address', 'help' => 'Review and notification emails are sent from this address. Use an address your mail server may send for.'],
            ['key' => 'mail.from.name', 'group' => 'general', 'section' => 'Email sender', 'type' => 'string', 'max' => 80,
                'label' => 'From name',
                'help' => 'The sender name customers see in their inbox.'],
            ['key' => 'platform.terms_url', 'group' => 'general', 'section' => 'Legal', 'type' => 'url', 'nullable' => true, 'public' => true,
                'label' => 'Terms of service page', 'help' => 'Linked from the sign-up form and the website footer. Leave empty to hide the link.'],
            ['key' => 'platform.privacy_url', 'group' => 'general', 'section' => 'Legal', 'type' => 'url', 'nullable' => true, 'public' => true,
                'label' => 'Privacy policy page', 'help' => 'Linked from the sign-up form and the website footer. Leave empty to hide the link.'],

            // ---------------------------------------------------------------- access
            ['key' => 'platform.registration_open', 'group' => 'access', 'section' => 'Sign-up', 'type' => 'bool', 'public' => true,
                'label' => 'New customers can sign up', 'help' => 'When off, the sign-up form shows the message below and the server refuses new accounts.'],
            ['key' => 'platform.registration_closed_message', 'group' => 'access', 'section' => 'Sign-up', 'type' => 'text', 'max' => 300, 'public' => true,
                'label' => 'Message when sign-up is closed',
                'help' => 'Shown on the sign-up page while sign-ups are paused.'],
            ['key' => 'platform.password_min_length', 'group' => 'access', 'section' => 'Sign-up', 'type' => 'int', 'min' => 6, 'max' => 64, 'suffix' => 'characters', 'public' => true,
                'label' => 'Minimum password length', 'help' => 'Minimum length for new customer passwords (6 to 64). Passwords already set keep working.'],
            ['key' => 'platform.session_hours', 'group' => 'access', 'section' => 'Sign-in', 'type' => 'int', 'min' => 0, 'max' => 8760, 'suffix' => 'hours',
                'map' => ['sanctum.expiration' => fn ($v) => (int) $v > 0 ? (int) $v * 60 : null],
                'label' => 'Stay signed in for', 'help' => 'Customers are signed out this long after they sign in. 0 keeps them signed in until they sign out. Applies to existing sign-ins too.'],
            ['key' => 'platform.max_connections_per_customer', 'group' => 'access', 'section' => 'Limits per customer', 'type' => 'int', 'min' => 0, 'max' => 1000,
                'label' => 'Database connections', 'help' => 'Most database connections one customer can save. 0 means no limit.'],
            ['key' => 'platform.max_automations_per_customer', 'group' => 'access', 'section' => 'Limits per customer', 'type' => 'int', 'min' => 0, 'max' => 10000,
                'label' => 'Automations', 'help' => 'Most automations one customer can create (manual publishing does not count). 0 means no limit.'],
            ['key' => 'platform.knowledge_max_upload_mb', 'group' => 'access', 'section' => 'Limits per customer', 'type' => 'int', 'min' => 1, 'max' => 50, 'suffix' => 'MB', 'public' => true,
                'label' => 'Knowledge document size',
                'help' => 'Largest Markdown, text or PDF file a customer can add to their knowledge base.'],
            ['key' => 'platform.media_max_upload_mb', 'group' => 'access', 'section' => 'Limits per customer', 'type' => 'int', 'min' => 1, 'max' => 50, 'suffix' => 'MB', 'public' => true,
                'label' => 'Image upload size',
                'help' => 'Largest image a customer can upload when publishing manually.'],

            // ---------------------------------------------------------------- ai
            ['key' => 'orbit.default_provider', 'group' => 'ai', 'section' => 'Default model', 'type' => 'select',
                'options' => ['ollama' => 'Ollama (local, free)', 'openai' => 'OpenAI', 'gemini' => 'Google Gemini', 'anthropic' => 'Anthropic Claude'],
                'label' => 'Default provider', 'help' => 'Used for customers who have not chosen their own models (AI providers › Which model does which job). Cloud providers also need the customer\'s own API key, so Ollama is the safe default.'],
            ['key' => 'orbit.default_model', 'group' => 'ai', 'section' => 'Default model', 'type' => 'string', 'max' => 120,
                'label' => 'Default model', 'help' => 'The model used with the default provider, e.g. qwen2.5:3b for Ollama. It must be installed on the Ollama server.'],
            ['key' => 'ai_models.openai', 'group' => 'ai', 'section' => 'Models customers can choose', 'type' => 'tags', 'max_items' => 20,
                'label' => 'OpenAI models', 'help' => 'Offered when a customer picks OpenAI. Customers can still type another model name.'],
            ['key' => 'ai_models.gemini', 'group' => 'ai', 'section' => 'Models customers can choose', 'type' => 'tags', 'max_items' => 20,
                'label' => 'Gemini models', 'help' => 'Offered when a customer picks Google Gemini.'],
            ['key' => 'ai_models.anthropic', 'group' => 'ai', 'section' => 'Models customers can choose', 'type' => 'tags', 'max_items' => 20,
                'label' => 'Claude models', 'help' => 'Offered when a customer picks Anthropic Claude.'],
            ['key' => 'ai_models.ollama_fallback', 'group' => 'ai', 'section' => 'Models customers can choose', 'type' => 'tags', 'max_items' => 20,
                'label' => 'Ollama suggestions', 'help' => 'Shown for Ollama only when the installed models cannot be read from the Ollama server.'],
            ['key' => 'orbit.readiness_budget_seconds', 'group' => 'ai', 'section' => 'Model checks', 'type' => 'int', 'min' => 60, 'max' => 900, 'suffix' => 'seconds',
                'label' => 'Readiness test time limit', 'help' => "Total time the 'Test with real tasks' check (AI providers page) may take for its four tasks. Local models on a CPU need more."],
            ['key' => 'services.ai.url', 'group' => 'ai', 'section' => 'AI service', 'type' => 'url',
                'label' => 'AI service address', 'help' => 'Internal address of the Python AI service. Change it only if the service moved. Its shared key stays in the server environment.'],

            // ---------------------------------------------------------------- automations
            ['key' => 'automation.min_gap_minutes', 'group' => 'automations', 'section' => 'Scheduling', 'type' => 'int', 'min' => 5, 'max' => 240, 'suffix' => 'minutes', 'public' => true,
                'label' => 'Minimum review window', 'help' => 'Publication is at least this long after generation, so reviewers have time to decide.'],
            ['key' => 'automation.max_regenerations', 'group' => 'automations', 'section' => 'Review', 'type' => 'int', 'min' => 1, 'max' => 10,
                'label' => 'Rewrites after rejection', 'help' => 'When a reviewer rejects a draft, the AI rewrites it using their feedback. After this many rejections the run stops.'],
            ['key' => 'automation.approval_link_hours', 'group' => 'automations', 'section' => 'Review', 'type' => 'int', 'min' => 1, 'max' => 168, 'suffix' => 'hours',
                'label' => 'Review link lifetime', 'help' => "How long the Approve and Reject buttons in a review email work. After that the reviewer uses the portal's Approvals page."],
            ['key' => 'automation.relation_options', 'group' => 'automations', 'section' => 'Linked records', 'type' => 'int', 'min' => 5, 'max' => 200, 'suffix' => 'records',
                'label' => 'Existing records the AI can choose from', 'help' => 'For a column that links to another table (for example a category), the AI sees up to this many existing records and picks the best one, or creates a new one when the automation allows it.'],
            ['key' => 'automation.max_retries', 'group' => 'automations', 'section' => 'Reliability', 'type' => 'int', 'min' => 0, 'max' => 10, 'suffix' => 'times',
                'label' => 'Retries after a worker stops', 'help' => 'A run whose worker stopped before finishing (restart, crash, timeout) starts again this many times before it is marked failed. Finished work is never repeated.'],
            ['key' => 'automation.tenant_concurrency', 'group' => 'automations', 'section' => 'Fair scheduling', 'type' => 'int', 'min' => 1, 'max' => 20,
                'label' => 'Runs at once per customer', 'help' => 'How many runs of one customer can work at the same time. Keeps one busy customer from delaying everyone else.'],

            // ---------------------------------------------------------------- data assistant
            ['key' => 'data_agent.statement_timeout_ms', 'group' => 'data', 'section' => 'Questions', 'type' => 'int', 'min' => 1000, 'max' => 60000, 'suffix' => 'ms',
                'label' => 'Query time limit', 'help' => 'Every read on a customer database (questions, Data Explorer, previews) is stopped after this long, so a slow query cannot hold the database.'],
            ['key' => 'data_agent.max_result_rows', 'group' => 'data', 'section' => 'Questions', 'type' => 'int', 'min' => 10, 'max' => 1000, 'suffix' => 'rows',
                'label' => 'Rows per answer',
                'help' => 'Most rows returned for one question to the data assistant or Orbit. Larger results are cut off and say so.'],
            ['key' => 'data_agent.schema_cache_seconds', 'group' => 'data', 'section' => 'Questions', 'type' => 'int', 'min' => 0, 'max' => 3600, 'suffix' => 'seconds',
                'label' => 'Schema cache', 'help' => 'How long the list of tables and columns is reused before it is read from the database again. Lower values notice new columns sooner.'],
            ['key' => 'data_agent.max_write_rows', 'group' => 'data', 'section' => 'Changes', 'type' => 'int', 'min' => 1, 'max' => 1000, 'suffix' => 'rows',
                'label' => 'Rows per update', 'help' => 'An update that would change more rows than this is refused. Every update is previewed and confirmed first, and only the previewed rows change.'],
            ['key' => 'data_agent.max_delete_rows', 'group' => 'data', 'section' => 'Changes', 'type' => 'int', 'min' => 1, 'max' => 500, 'suffix' => 'rows',
                'label' => 'Rows per delete', 'help' => 'A delete that would remove more rows than this is refused. Deletes also need the connection\'s delete mode, a typed confirmation and a backup.'],
            ['key' => 'data_explorer.max_page_size', 'group' => 'data', 'section' => 'Data Explorer', 'type' => 'int', 'min' => 10, 'max' => 500, 'suffix' => 'rows', 'public' => true,
                'label' => 'Rows per page', 'help' => 'Most rows shown on one page of the Data Explorer. Bigger pages read more from the customer\'s database at once.'],
            ['key' => 'data_explorer.max_sample_rows', 'group' => 'data', 'section' => 'Sample data and autopilot', 'type' => 'int', 'min' => 1, 'max' => 100, 'suffix' => 'rows', 'public' => true,
                'label' => 'Sample rows at once', 'help' => 'Most AI sample rows created in one go, now or per scheduled run. Each batch is validated before it is added.'],
            ['key' => 'data_explorer.max_autopilots_per_customer', 'group' => 'data', 'section' => 'Sample data and autopilot', 'type' => 'int', 'min' => 0, 'max' => 200,
                'label' => 'Data autopilots per customer', 'help' => 'Most scheduled sample-data jobs one customer can have. 0 means no limit.'],

            // ---------------------------------------------------------------- orbit
            ['key' => 'orbit.enabled', 'group' => 'orbit', 'section' => 'Availability', 'type' => 'bool', 'public' => true,
                'label' => 'Orbit is available to customers', 'help' => 'When off, Orbit is hidden in the portal and the server refuses new requests.'],
            ['key' => 'orbit.max_iterations', 'group' => 'orbit', 'section' => 'Working limits', 'type' => 'int', 'min' => 4, 'max' => 60,
                'label' => 'Steps per request', 'help' => 'The most steps Orbit may take for one request (open a page, fill a field, press a button…). Long tasks need more steps.'],
            ['key' => 'orbit.max_turn_seconds', 'group' => 'orbit', 'section' => 'Working limits', 'type' => 'int', 'min' => 60, 'max' => 1500, 'suffix' => 'seconds',
                'label' => 'Time per request', 'help' => 'The longest Orbit may work on one request before it stops and reports what it did. Must stay below the agent worker\'s timeout (1600 s).'],
            ['key' => 'orbit.decide_timeout_seconds', 'group' => 'orbit', 'section' => 'Working limits', 'type' => 'int', 'min' => 30, 'max' => 900, 'suffix' => 'seconds',
                'label' => 'Time per decision', 'help' => 'How long the model may think about one step. Must be less than the time per request; local models on a CPU need more time.'],
            ['key' => 'orbit.max_repairs', 'group' => 'orbit', 'section' => 'Working limits', 'type' => 'int', 'min' => 0, 'max' => 3,
                'label' => 'Repairs per decision', 'help' => 'When the model returns an answer the server cannot accept, Orbit asks it again this many times before it reports the problem.'],
            ['key' => 'orbit.client_heartbeat_ttl_seconds', 'group' => 'orbit', 'section' => 'Portal link', 'type' => 'int', 'min' => 10, 'max' => 300, 'suffix' => 'seconds',
                'label' => 'Open-tab check', 'help' => 'Orbit acts on screen only in an open portal tab. A tab counts as open for this long after it last checked in.'],
            ['key' => 'orbit.secure_input_ttl_minutes', 'group' => 'orbit', 'section' => 'Portal link', 'type' => 'int', 'min' => 5, 'max' => 120, 'suffix' => 'minutes',
                'label' => 'Secure field lifetime', 'help' => 'A password or key typed into Orbit\'s secure field is kept this long for the task.'],

            // ---------------------------------------------------------------- orbit remote
            ['key' => 'orbit.remote_enabled', 'group' => 'remote', 'section' => 'Availability', 'type' => 'bool', 'public' => true,
                'label' => 'Customers can pair a phone', 'help' => 'When off, the QR code is hidden and pairing and phone requests are refused.'],
            ['key' => 'orbit.remote_public_url', 'group' => 'remote', 'section' => 'Availability', 'type' => 'url', 'nullable' => true,
                'label' => 'Address phones open', 'help' => 'Leave empty to use the address the computer has open (or its Wi-Fi address instead of localhost).'],
            ['key' => 'orbit.remote_pairing_seconds', 'group' => 'remote', 'section' => 'Limits', 'type' => 'int', 'min' => 60, 'max' => 900, 'suffix' => 'seconds',
                'label' => 'QR code lifetime',
                'help' => 'How long a QR code can be scanned. Showing a new code cancels the old one.'],
            ['key' => 'orbit.remote_session_hours', 'group' => 'remote', 'section' => 'Limits', 'type' => 'int', 'min' => 1, 'max' => 72, 'suffix' => 'hours',
                'label' => 'Longest connection',
                'help' => 'A paired phone is disconnected after this many hours, even while it is being used.'],
            ['key' => 'orbit.remote_idle_minutes', 'group' => 'remote', 'section' => 'Limits', 'type' => 'int', 'min' => 5, 'max' => 720, 'suffix' => 'minutes',
                'label' => 'Disconnect after idle',
                'help' => 'A paired phone is disconnected when it has not been used for this long.'],
            ['key' => 'orbit.remote_commands_per_minute', 'group' => 'remote', 'section' => 'Limits', 'type' => 'int', 'min' => 5, 'max' => 120,
                'label' => 'Requests per minute per phone',
                'help' => 'Most spoken or typed requests one phone can send per minute.'],

            // ---------------------------------------------------------------- features
            ['key' => 'features.dry_run', 'group' => 'features', 'section' => 'Automations', 'type' => 'bool', 'public' => true, 'label' => 'Dry runs (simulate without writing)',
                'help' => 'Customers can simulate a run: everything is generated and checked, nothing is written.'],
            ['key' => 'features.templates', 'group' => 'features', 'section' => 'Automations', 'type' => 'bool', 'public' => true, 'label' => 'Automation templates',
                'help' => 'Ready-made starting points (daily blog, product descriptions, FAQ…) when creating an automation.'],
            ['key' => 'features.quality_score', 'group' => 'features', 'section' => 'Automations', 'type' => 'bool', 'public' => true, 'label' => 'Content quality score',
                'help' => 'Each draft gets a readability and completeness score before it is reviewed.'],
            ['key' => 'features.content_calendar', 'group' => 'features', 'section' => 'Automations', 'type' => 'bool', 'public' => true, 'label' => 'Content calendar',
                'help' => 'Scheduled and published runs on a calendar.'],
            ['key' => 'features.undo_center', 'group' => 'features', 'section' => 'Safety', 'type' => 'bool', 'public' => true, 'label' => 'Undo center (revert published runs)',
                'help' => 'Customers can revert a published run: the row it added is removed after confirmation.'],
            ['key' => 'features.schema_drift', 'group' => 'features', 'section' => 'Databases', 'type' => 'bool', 'public' => true, 'label' => 'Schema drift detection',
                'help' => 'Warns when a table\'s columns changed since an automation was set up.'],
            ['key' => 'features.db_insights', 'group' => 'features', 'section' => 'Databases', 'type' => 'bool', 'public' => true, 'label' => 'Database insights',
                'help' => 'Table sizes and how quickly rows are added, per connection.'],
            ['key' => 'features.data_explorer', 'group' => 'features', 'section' => 'Data tools', 'type' => 'bool', 'public' => true, 'label' => 'Data Explorer',
                'help' => 'Customers can browse the rows of their tables (read-only, limited, secrets hidden, personal data masked).'],
            ['key' => 'features.data_manager', 'group' => 'features', 'section' => 'Data tools', 'type' => 'bool', 'public' => true, 'label' => 'Data Manager',
                'help' => 'Customers can add, edit and delete rows from the portal. Every change is previewed, confirmed and can be undone; deletes also need the connection\'s delete mode.'],
            ['key' => 'features.sample_data', 'group' => 'features', 'section' => 'Data tools', 'type' => 'bool', 'public' => true, 'label' => 'AI sample rows',
                'help' => 'Customers can have the AI create realistic sample rows for a table (shown first, added after confirmation).'],
            ['key' => 'features.data_autopilot', 'group' => 'features', 'section' => 'Data tools', 'type' => 'bool', 'public' => true, 'label' => 'Data autopilot',
                'help' => 'Customers can schedule AI sample rows to be added to a table on a schedule.'],

            // ---------------------------------------------------------------- website content (not config)
            ['key' => 'content.announcement_enabled', 'group' => 'content', 'section' => 'Announcement bar', 'type' => 'bool', 'config' => false, 'default' => false,
                'label' => 'Show an announcement', 'help' => 'A slim bar at the top of the website and the portal.'],
            ['key' => 'content.announcement_text', 'group' => 'content', 'section' => 'Announcement bar', 'type' => 'string', 'max' => 200, 'config' => false, 'default' => '',
                'label' => 'Announcement'],
            ['key' => 'content.announcement_link', 'group' => 'content', 'section' => 'Announcement bar', 'type' => 'url', 'nullable' => true, 'config' => false, 'default' => null,
                'label' => 'Link (optional)'],
            ['key' => 'content.announcement_tone', 'group' => 'content', 'section' => 'Announcement bar', 'type' => 'select', 'config' => false, 'default' => 'info',
                'options' => ['info' => 'Information', 'success' => 'Good news', 'warning' => 'Warning'], 'label' => 'Style'],
            ['key' => 'content.hero_badge', 'group' => 'content', 'section' => 'Hero', 'type' => 'string', 'max' => 120, 'config' => false,
                'default' => 'Meet Orbit, the voice-first operator for your portal', 'label' => 'Badge'],
            ['key' => 'content.hero_title', 'group' => 'content', 'section' => 'Hero', 'type' => 'string', 'max' => 80, 'config' => false,
                'default' => 'Put your database', 'label' => 'Headline'],
            ['key' => 'content.hero_highlight', 'group' => 'content', 'section' => 'Hero', 'type' => 'string', 'max' => 80, 'config' => false,
                'default' => 'on autopilot.', 'label' => 'Highlighted line', 'help' => 'Second line of the headline, in the gradient colour.'],
            ['key' => 'content.hero_subtitle', 'group' => 'content', 'section' => 'Hero', 'type' => 'text', 'max' => 400, 'config' => false,
                'default' => '{brand} connects to your MySQL database, understands every table, and writes on-brand content into it with your own AI: on schedule, approved by a person, and validated before every write.',
                'label' => 'Description'],
            ['key' => 'content.hero_primary_cta', 'group' => 'content', 'section' => 'Hero', 'type' => 'string', 'max' => 40, 'config' => false,
                'default' => 'Start for free', 'label' => 'Main button'],
            ['key' => 'content.hero_secondary_cta', 'group' => 'content', 'section' => 'Hero', 'type' => 'string', 'max' => 40, 'config' => false,
                'default' => 'See how it works', 'label' => 'Second button'],
            ['key' => 'content.hero_points', 'group' => 'content', 'section' => 'Hero', 'type' => 'list', 'config' => false, 'max_items' => 4,
                'fields' => ['text' => ['label' => 'Point', 'max' => 80]], 'label' => 'Points under the buttons',
                'default' => [['text' => 'Runs on local Ollama, no paid API'], ['text' => 'Credentials encrypted at rest'], ['text' => 'Every write validated and audited']]],
            ['key' => 'content.product_eyebrow', 'group' => 'content', 'section' => 'Product section', 'type' => 'string', 'max' => 40, 'config' => false,
                'default' => 'The product', 'label' => 'Label above the heading'],
            ['key' => 'content.product_title', 'group' => 'content', 'section' => 'Product section', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'Everything between your idea and', 'label' => 'Heading'],
            ['key' => 'content.product_highlight', 'group' => 'content', 'section' => 'Product section', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'a published row', 'label' => 'Highlighted words'],
            ['key' => 'content.product_title_end', 'group' => 'content', 'section' => 'Product section', 'type' => 'string', 'max' => 100, 'nullable' => true, 'config' => false,
                'default' => null, 'label' => 'Words after the highlight (optional)'],
            ['key' => 'content.product_subtitle', 'group' => 'content', 'section' => 'Product section', 'type' => 'text', 'max' => 400, 'config' => false,
                'default' => '{brand} handles the whole path: understanding the database, writing with your knowledge, getting a person\'s OK, and committing safely on time.', 'label' => 'Description'],
            ['key' => 'content.how_eyebrow', 'group' => 'content', 'section' => 'How it works section', 'type' => 'string', 'max' => 40, 'config' => false,
                'default' => 'How it works', 'label' => 'Label above the heading'],
            ['key' => 'content.how_title', 'group' => 'content', 'section' => 'How it works section', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'From connection to published,', 'label' => 'Heading'],
            ['key' => 'content.how_highlight', 'group' => 'content', 'section' => 'How it works section', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'in five steps', 'label' => 'Highlighted words'],
            ['key' => 'content.how_title_end', 'group' => 'content', 'section' => 'How it works section', 'type' => 'string', 'max' => 100, 'nullable' => true, 'config' => false,
                'default' => null, 'label' => 'Words after the highlight (optional)'],
            ['key' => 'content.how_subtitle', 'group' => 'content', 'section' => 'How it works section', 'type' => 'text', 'max' => 400, 'config' => false,
                'default' => 'Set it up once in the portal. After that, the work happens on schedule in the background, with a person in the loop where it matters.', 'label' => 'Description'],
            ['key' => 'content.orbit_eyebrow', 'group' => 'content', 'section' => 'Orbit section', 'type' => 'string', 'max' => 40, 'config' => false,
                'default' => 'Meet Orbit', 'label' => 'Label above the heading'],
            ['key' => 'content.orbit_title', 'group' => 'content', 'section' => 'Orbit section', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'An operator that works', 'label' => 'Heading'],
            ['key' => 'content.orbit_highlight', 'group' => 'content', 'section' => 'Orbit section', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'on screen, in front of you', 'label' => 'Highlighted words'],
            ['key' => 'content.orbit_title_end', 'group' => 'content', 'section' => 'Orbit section', 'type' => 'string', 'max' => 100, 'nullable' => true, 'config' => false,
                'default' => null, 'label' => 'Words after the highlight (optional)'],
            ['key' => 'content.orbit_subtitle', 'group' => 'content', 'section' => 'Orbit section', 'type' => 'text', 'max' => 400, 'config' => false,
                'default' => 'Orbit lives in the corner of your portal. Tell it what you need and it uses the same pages, forms and buttons you would, with your model deciding each step and the server checking every one.', 'label' => 'Description'],
            ['key' => 'content.security_eyebrow', 'group' => 'content', 'section' => 'Security section', 'type' => 'string', 'max' => 40, 'config' => false,
                'default' => 'Security', 'label' => 'Label above the heading'],
            ['key' => 'content.security_title', 'group' => 'content', 'section' => 'Security section', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'Safe by design.', 'label' => 'Heading'],
            ['key' => 'content.security_highlight', 'group' => 'content', 'section' => 'Security section', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'Enforced by the server,', 'label' => 'Highlighted words'],
            ['key' => 'content.security_title_end', 'group' => 'content', 'section' => 'Security section', 'type' => 'string', 'max' => 100, 'nullable' => true, 'config' => false,
                'default' => 'not the model.', 'label' => 'Words after the highlight (optional)'],
            ['key' => 'content.security_subtitle', 'group' => 'content', 'section' => 'Security section', 'type' => 'text', 'max' => 400, 'config' => false,
                'default' => 'Every rule here is checked in the backend for every request and every background job. The AI can suggest; it never decides what runs.', 'label' => 'Description'],
            ['key' => 'content.use_cases_eyebrow', 'group' => 'content', 'section' => 'Use cases section', 'type' => 'string', 'max' => 40, 'config' => false,
                'default' => 'Use cases', 'label' => 'Label above the heading'],
            ['key' => 'content.use_cases_title', 'group' => 'content', 'section' => 'Use cases section', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'Built for content that', 'label' => 'Heading'],
            ['key' => 'content.use_cases_highlight', 'group' => 'content', 'section' => 'Use cases section', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'lives in tables', 'label' => 'Highlighted words'],
            ['key' => 'content.use_cases_title_end', 'group' => 'content', 'section' => 'Use cases section', 'type' => 'string', 'max' => 100, 'nullable' => true, 'config' => false,
                'default' => null, 'label' => 'Words after the highlight (optional)'],
            ['key' => 'content.use_cases_subtitle', 'group' => 'content', 'section' => 'Use cases section', 'type' => 'text', 'max' => 400, 'config' => false,
                'default' => 'Blog posts are the showcase, but the same engine works for any eligible table. You decide how every column is filled.', 'label' => 'Description'],
            ['key' => 'content.auth_title', 'group' => 'content', 'section' => 'Sign-in pages', 'type' => 'string', 'max' => 80, 'config' => false,
                'default' => 'Put your database', 'label' => 'Heading', 'help' => 'Shown beside the sign-in and sign-up forms.'],
            ['key' => 'content.auth_highlight', 'group' => 'content', 'section' => 'Sign-in pages', 'type' => 'string', 'max' => 80, 'config' => false,
                'default' => 'on autopilot.', 'label' => 'Highlighted words'],
            ['key' => 'content.auth_subtitle', 'group' => 'content', 'section' => 'Sign-in pages', 'type' => 'text', 'max' => 300, 'config' => false,
                'default' => 'Write, approve and publish content into your own tables on schedule, with your own AI and guardrails the server enforces.', 'label' => 'Description'],
            ['key' => 'content.auth_points', 'group' => 'content', 'section' => 'Sign-in pages', 'type' => 'list', 'config' => false, 'max_items' => 4,
                'fields' => ['text' => ['label' => 'Point', 'max' => 80]], 'label' => 'Points',
                'default' => [['text' => 'Runs on local Ollama, no paid API needed'], ['text' => 'Credentials and keys encrypted at rest'], ['text' => 'Every connection starts read-only']]],
            ['key' => 'content.faq_title', 'group' => 'content', 'section' => 'Questions', 'type' => 'string', 'max' => 80, 'config' => false,
                'default' => 'Questions,', 'label' => 'Heading'],
            ['key' => 'content.faq_highlight', 'group' => 'content', 'section' => 'Questions', 'type' => 'string', 'max' => 80, 'config' => false,
                'default' => 'answered plainly', 'label' => 'Highlighted words'],
            ['key' => 'content.faq_subtitle', 'group' => 'content', 'section' => 'Questions', 'type' => 'text', 'max' => 300, 'config' => false,
                'default' => 'The short version: your data stays yours, the server enforces every rule, and nothing needs a paid API.', 'label' => 'Description'],
            ['key' => 'content.faqs', 'group' => 'content', 'section' => 'Questions', 'type' => 'list', 'config' => false, 'max_items' => 20,
                'fields' => ['question' => ['label' => 'Question', 'max' => 200], 'answer' => ['label' => 'Answer', 'max' => 1000, 'rows' => 3]],
                'label' => 'Questions and answers',
                'default' => [
                ['question' => 'Do I need a paid AI subscription?', 'answer' => 'No. {brand} runs on a local Ollama model on your own machine, so the core workflow needs no paid API. OpenAI, Gemini and Claude are optional: add your own key in the portal if you want them.'],
                ['question' => 'Which databases does it support?', 'answer' => 'MySQL and MariaDB. PostgreSQL works through the same adapter when the PostgreSQL PHP driver is installed on the server. SQL Server and MongoDB are not supported yet.'],
                ['question' => 'Can the AI change or delete my data on its own?', 'answer' => 'No. The AI service never connects to your database; the server decides what runs. Automations only write the tables and columns you mapped, after validation and, if you turn it on, a reviewer\'s approval. Changes you ask Orbit for are previewed and confirmed first. Deletes are off unless you enable them for a connection, and schema changes are never allowed.'],
                ['question' => 'Where are my database passwords and API keys stored?', 'answer' => 'Encrypted at rest in your own workspace. They are never logged and never sent back to the browser after you save them. Orbit never sees them either: you type them into the form yourself.'],
                ['question' => 'What happens if nobody approves a draft in time?', 'answer' => 'You choose for each automation: keep it as a draft, publish the latest version, or cancel that run.'],
                ['question' => 'Does it keep working when I close the browser?', 'answer' => 'Yes. Generation and publishing run as persisted background jobs and schedules, so they continue after you close the tab and survive restarts.'],
                ['question' => 'Can I write the content myself?', 'answer' => 'Yes. Manual publishing lets you write or paste content and schedule it with AI turned off, through the same validated pipeline.'],
                ['question' => 'Is my content sent to anyone else?', 'answer' => 'With a local Ollama model, generation stays on your machine. If you pick a cloud provider, prompts and the retrieved passages go to that provider under its terms. Approval emails go through your own mail server. Voice input in Chrome or Edge may use the browser\'s speech service, and Orbit tells you before you use it the first time.']
                ]],
            ['key' => 'content.closing_title', 'group' => 'content', 'section' => 'Closing call to action', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'Your next post can write, review', 'label' => 'Heading'],
            ['key' => 'content.closing_highlight', 'group' => 'content', 'section' => 'Closing call to action', 'type' => 'string', 'max' => 100, 'config' => false,
                'default' => 'and publish itself.', 'label' => 'Highlighted words'],
            ['key' => 'content.closing_subtitle', 'group' => 'content', 'section' => 'Closing call to action', 'type' => 'text', 'max' => 300, 'config' => false,
                'default' => 'Create a workspace, connect your database and schedule your first automation. Orbit can walk you through it.', 'label' => 'Description'],
            ['key' => 'content.closing_cta', 'group' => 'content', 'section' => 'Closing call to action', 'type' => 'string', 'max' => 40, 'config' => false,
                'default' => 'Create your workspace', 'label' => 'Button'],
            ['key' => 'content.footer_blurb', 'group' => 'content', 'section' => 'Footer', 'type' => 'text', 'max' => 300, 'config' => false,
                'default' => 'AI content and data automation for your own database: understood, approved by people, and written safely.', 'label' => 'About text'],
            ['key' => 'content.footer_copyright', 'group' => 'content', 'section' => 'Footer', 'type' => 'string', 'max' => 120, 'config' => false,
                'default' => '© 2026 {brand}. Self-hosted database automation.', 'label' => 'Copyright line'],
            ['key' => 'content.footer_stack', 'group' => 'content', 'section' => 'Footer', 'type' => 'string', 'max' => 120, 'config' => false,
                'default' => 'Laravel · FastAPI · React · Ollama', 'label' => 'Second line'],
            ['key' => 'content.meta_title', 'group' => 'content', 'section' => 'Search engines', 'type' => 'string', 'max' => 70, 'config' => false,
                'default' => '{brand} · AI automation for your own database', 'label' => 'Page title'],
            ['key' => 'content.meta_description', 'group' => 'content', 'section' => 'Search engines', 'type' => 'text', 'max' => 300, 'config' => false,
                'default' => '{brand} connects to your MySQL database, understands every table and writes on-brand content into it with your own AI: on schedule, approved by a person, validated before every write.',
                'label' => 'Description'],
        ];

        $out = [];
        foreach ($list as $d) {
            $d += ['config' => true, 'public' => false, 'nullable' => false, 'help' => null, 'also' => []];
            if ($d['group'] === 'content') {
                $d['public'] = true;
            }
            $out[$d['key']] = $d;
        }
        return $out;
    }
}
