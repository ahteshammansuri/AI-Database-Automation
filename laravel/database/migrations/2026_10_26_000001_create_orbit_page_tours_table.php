<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Orbit's page explanations (overview + detailed, operable steps) live in the database and are edited in the admin
 * panel. This creates the table and adds the explanations for every portal page; rows an admin already has are kept.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orbit_page_tours', function (Blueprint $table) {
            $table->id();
            $table->string('route', 120)->unique();
            $table->string('title', 120);
            $table->text('overview');
            $table->json('steps')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort')->default(0);
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
        });

        $now = now();
        foreach ($this->tours() as $i => $t) {
            if (DB::table('orbit_page_tours')->where('route', $t['route'])->exists()) {
                continue;
            }
            DB::table('orbit_page_tours')->insert([
                'route' => $t['route'],
                'title' => $t['title'],
                'overview' => $t['overview'],
                'steps' => json_encode($t['steps'], JSON_UNESCAPED_UNICODE),
                'is_active' => true,
                'sort' => ($i + 1) * 10,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('orbit_page_tours');
    }

    private function tours(): array
    {
        $point = fn (string $surface, string $say, ?string $field = null, ?string $action = null) => array_filter(
            ['do' => 'point', 'surface' => $surface, 'field' => $field, 'action' => $action, 'say' => $say], fn ($v) => $v !== null);
        $say = fn (string $text) => ['do' => 'say', 'say' => $text];
        $close = fn (string $text) => ['do' => 'close_popup', 'say' => $text];

        return [
            [
                'route' => '/dashboard', 'title' => 'Dashboard',
                'overview' => 'This is your dashboard, the quickest way to see how everything is going. The first card follows your automations live: what is being written right now, the next run with a countdown, or the last thing that was published. Below it are your connections, automations, recent runs and anything waiting for your approval.',
                'steps' => [
                    $point('dashboard.page', 'The top card updates by itself. While a run is working you see its steps; otherwise it counts down to the next run, or shows what was published last.'),
                    $say('The cards below count your database connections and automations, how many runs succeeded or failed recently, and drafts waiting for a decision. Each one opens its own page.'),
                    $say('From the list of upcoming runs you can also start an automation right away.'),
                ],
            ],
            [
                'route' => '/connections', 'title' => 'Database Connections',
                'overview' => 'Here you connect your own databases. Each saved connection shows whether it can be reached, and what automations and I are allowed to do with it. A new connection starts read only, so nothing can change until you allow it.',
                'steps' => [
                    $point('connections.list', 'This list shows every saved connection and its status. You can test it again, rescan its tables, edit it, or remove the profile. Removing a profile never touches the database itself.'),
                    ['do' => 'open', 'surface' => 'connections.form', 'say' => 'This is the form for a new connection.'],
                    $point('connections.form', 'Give it a name you will recognise, for example Shop database.', 'name'),
                    $point('connections.form', 'The host is the address of your database server. For MySQL the port is usually 3306.', 'host'),
                    $point('connections.form', 'Then the name of the database, and a username that may read it.', 'database_name'),
                    $point('connections.form', 'You type the password yourself. It is stored encrypted and never shown again, not even to me.', 'password'),
                    $point('connections.form', 'Secure connection settings, if your server needs them.', 'ssl_mode'),
                    $point('connections.form', 'Test checks that the database really answers before anything is saved. Save tests it again and only then keeps it.', null, 'test'),
                    ['do' => 'press', 'surface' => 'connections.form', 'action' => 'cancel', 'say' => 'I will close the form without saving anything.'],
                    $say('Each connection also has an access mode: read only, read and write, or read, write and delete. You choose how much may change.'),
                ],
            ],
            [
                'route' => '/explorer', 'title' => 'Schema Explorer',
                'overview' => 'The Schema Explorer shows every table we found in your database, what each one is for, and how it is protected. It reads the structure only, never your rows.',
                'steps' => [
                    $point('explorer.browser', 'First choose a connection here.', 'connection'),
                    $point('explorer.browser', 'Then a table. Tables are grouped as recommended for automations, needing a review, or restricted.', 'table'),
                    $point('explorer.browser', 'For the chosen table you see what a new row needs, every column with its type, which tables it links to, and which columns are secret or personal.'),
                    $say('Secret columns, such as password hashes, are never shown or written. Personal data, such as emails, is masked until you reveal it.'),
                    $say('The owner can switch a table between view only and editable on this connection. Credential and session tables always stay hidden.'),
                    $point('explorer.browser', 'Team notes help everyone, including me, understand what a table is for.', 'note'),
                    $point('explorer.browser', 'Rescan reads the database again after its structure changed.', null, 'refresh'),
                ],
            ],
            [
                'route' => '/data', 'title' => 'Data',
                'overview' => 'On the Data page you see the rows of your own tables and can change them safely. Every change is shown as a preview first, and it can be undone afterwards.',
                'steps' => [
                    $point('data.page', 'Choose a connection,', 'connection'),
                    $point('data.page', 'and a table. Locked tables, such as passwords and sessions, are never opened.', 'table'),
                    $point('data.page', 'Search finds rows by their text. You can also sort by any column and page through the results.', 'search'),
                    ['do' => 'press', 'surface' => 'data.page', 'action' => 'add_row', 'say' => 'Add row opens a form made from the table itself, with the right kind of input for every column.'],
                    $close('Nothing is written until you confirm the preview, so I will close it.'),
                    ['do' => 'press', 'surface' => 'data.page', 'action' => 'sample_rows', 'say' => 'AI sample rows writes realistic test rows for you. Every value is checked before you see them.'],
                    $close('I will close this one too.'),
                    $say('Emails and phone numbers are masked until you reveal them, and that is recorded. Deleting needs the connection to allow it and a typed confirmation, and a backup is kept.'),
                ],
            ],
            [
                'route' => '/automations', 'title' => 'Automations',
                'overview' => 'Automations write new content into your database on a schedule, for example a blog post every morning. This list shows each one with its table, its schedule and when it runs next.',
                'steps' => [
                    $point('automations.list', 'Each row is one automation. You can run it now, pause it, resume it, or delete it.'),
                    $point('automations.list', 'New automation opens the builder, where you set one up step by step.', null, 'new'),
                    $say('Runs continue in the background even when this browser is closed. If an automation needs approval, its drafts wait on the Approvals page.'),
                ],
            ],
            [
                'route' => '/automations/new', 'title' => 'Automation builder',
                'overview' => 'The builder sets up an automation in five steps: what to write and where, how each column is filled, the content style, the schedule, and a final review with a real preview. Your progress is saved as you go.',
                'steps' => [
                    $point('builder.setup', 'Start with a name,', 'name'),
                    $point('builder.setup', 'the connection,', 'connection'),
                    $point('builder.setup', 'and the table to write into. Templates choose a matching table for you.', 'table'),
                    $point('builder.setup', 'You can also describe what you want in your own words and let the AI suggest the whole setup.', 'plan_prompt'),
                    $point('builder.setup', 'Next goes to the fields step. Every column gets a sensible choice: written by AI, a fixed value, a linked record such as a category, or the publish time.', null, 'next'),
                    $say('After that you choose the topic, tone and length, then the schedule and whether a person approves each draft. The last step shows a real preview before anything is saved.'),
                ],
            ],
            [
                'route' => '/manual-schedule', 'title' => 'Manual publishing',
                'overview' => 'Manual publishing lets you write one row yourself and publish it now, or at a time you choose. You see exactly what will be written before it happens.',
                'steps' => [
                    $point('manual.form', 'Choose the connection,', 'connection'),
                    $point('manual.form', 'and the table. Only tables you are allowed to write to are listed.', 'table'),
                    $say('The fields come from the table itself. For a linked column, such as a category, you pick an existing row, or add a new one that is created first.'),
                    $point('manual.form', 'Draft with AI fills the empty text fields from a topic, and keeps what you already wrote.', 'ai_topic'),
                    $point('manual.form', 'Publish now, or schedule it for later.', 'publish_mode'),
                    $point('manual.form', 'Review checks everything against your database and shows each step before you confirm.', null, 'review'),
                ],
            ],
            [
                'route' => '/approvals', 'title' => 'Approvals',
                'overview' => 'Approvals collects drafts waiting for a person to decide before they are published. Nothing waiting here has been written to your database yet.',
                'steps' => [
                    $point('approvals.list', 'Each card shows the draft, its table, when it will publish, and what happens if nobody decides in time.'),
                    ['do' => 'press', 'surface' => 'approvals.list', 'action' => 'open', 'row' => 'first', 'say' => 'Review opens the whole draft with a preview, and you can still edit it.'],
                    $close('I will close it again.'),
                    $say('From here you approve it for its time, publish it now, or send it back with notes so a new version is written.'),
                ],
            ],
            [
                'route' => '/executions', 'title' => 'Execution history',
                'overview' => 'Execution history lists every run: what was written, when it publishes, how long it took and how many AI tokens it used.',
                'steps' => [
                    $point('executions.list', 'Filter by status here, for example failed runs or runs waiting for approval.', 'status_filter'),
                    $point('executions.list', 'Each row is one run, with its status and publication time.'),
                    ['do' => 'press', 'surface' => 'executions.list', 'action' => 'view', 'row' => 'first', 'say' => 'Details opens a run: the content, the exact database change, how it was made, and a step by step timeline.'],
                    $close('I will close the details.'),
                    $say('A failed run can be retried, and a waiting run can be paused or cancelled before anything is written.'),
                ],
            ],
            [
                'route' => '/knowledge', 'title' => 'Knowledge Base',
                'overview' => 'The knowledge base holds your own documents, in Markdown, text or PDF. Automations and I use them as background, so the content fits your business.',
                'steps' => [
                    $point('knowledge.page', 'Give the document a title,', 'title'),
                    $point('knowledge.page', 'choose the file yourself,', null, 'choose_file'),
                    $point('knowledge.page', 'and upload it. It is split into passages and indexed, so the right parts can be found later.', null, 'upload'),
                    $point('knowledge.page', 'Search shows which passages match a question.', 'search'),
                ],
            ],
            [
                'route' => '/ai-providers', 'title' => 'AI Providers',
                'overview' => 'Here you choose which AI models do the work. A local Ollama model works without any paid service; OpenAI, Gemini or Claude can be added with your own key.',
                'steps' => [
                    $point('providers.list', 'Each provider can be tested and configured. Keys are stored encrypted and never shown again.'),
                    $point('providers.roles', 'Model roles decide which model runs me, Orbit, and which one writes your content. Temperature controls how varied the writing is; lower is steadier.'),
                    $say('If your Gemini model is out of quota or busy, I switch to another Gemini model and tell you which one answered.'),
                ],
            ],
            [
                'route' => '/audit-logs', 'title' => 'Audit log',
                'overview' => 'The audit log is a permanent record of what happened in your workspace, written as plain sentences.',
                'steps' => [
                    $point('audit.page', 'Filter by area, such as connections, automations, data or Orbit.', 'action_filter'),
                    $point('audit.page', 'Search by words, or choose dates.', 'search'),
                    ['do' => 'press', 'surface' => 'audit.page', 'action' => 'inspect', 'row' => 'first', 'say' => 'Opening an entry shows what changed, from the old value to the new one.'],
                    $close('I will close it.'),
                    $say('The Orbit tab lists every action I took for you, and Export saves the log as a spreadsheet file.'),
                ],
            ],
            [
                'route' => '/security', 'title' => 'Security and guardrails',
                'overview' => 'This page lists what the platform enforces for your databases. These rules run on the server, no matter who asks, including me.',
                'steps' => [
                    $point('security.page', 'Tables are never dropped or altered, there is no raw SQL console, and every change needs a preview and your confirmation.'),
                    $say('Passwords and keys are encrypted, secret columns are never shown, and personal data stays masked until you reveal it.'),
                ],
            ],
            [
                'route' => '/account', 'title' => 'Account settings',
                'overview' => 'Account settings: your name, email, timezone and password, the devices you are signed in on, and how many AI tokens you used.',
                'steps' => [
                    $say('Changing your email or password needs your current password. Changing the password signs out your other devices.'),
                    $say('Your timezone is used to show times and as the default for new schedules.'),
                    $say('AI usage shows tokens by model and by purpose for the last week, month or three months.'),
                ],
            ],
        ];
    }
};
