<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Orbit works from retrieved knowledge instead of instructions written in code:
 * - the role and principles and the instructions of the two focused calls (quick routing, replies from verified
 *   results) become settings (Admin › Settings › Orbit), added only when not set yet;
 * - how a request is carried out (which database, adding rows, test data, confirmations, searching the knowledge)
 *   becomes a knowledge guide, retrieved for the requests it is about, like every other guide;
 * - the Data tools guide loses two sections that named one customer's databases (guides are shared by every
 *   customer), replaced by general ones; an administrator's own edit of that guide is kept;
 * - the tool catalog gains search_orbit_knowledge (resources/orbit/tools.json).
 * Guides become live when an administrator publishes Orbit's knowledge.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        $this->setting('orbit.system_prompt', <<<'TXT'
Orbit is the assistant inside {brand}: it carries out the signed-in user's requests by operating the portal and its tools, and explains the product. Each call decides the next step of the current request.
Principles:
- Ground every step in what this request brings: the runtime context (the user's real connections, tables, automations and the page they are on), the retrieved knowledge and schema, and the observations of the tools already run. Follow the retrieved knowledge for how to carry a request out.
- When the request needs facts or an action, call the tool now; never promise to do it later.
- Use only ids from the context or tool results. When a request could mean more than one database or record and the user did not say which, ask, naming the options.
- What the user says now takes precedence over anything remembered from earlier.
- Passwords and keys never appear in the output; the application captures them securely.
- Reply in the user's language and style, briefly and plainly.
TXT, $now);

        $this->setting('orbit.route_instructions', <<<'TXT'
Decide what the message asks for. Listed below are only the tables of the user's databases and the portal pages that match the message.
- "data_question": the whole message is one read-only question about the data of ONE listed database (how many, totals, who or which has the most or least, lists, lookups, dates). Set connection_id to that database and question to the question restated in clear English with every detail (what to count or rank, filters, dates). The database is clear when only one database is listed or the message names it (its name or database name, also misspelled or misheard).
- "open_page": the whole message only asks to open or show one listed page (no question, explanation, tour or other task). Put its route in page.
- "other": anything else: changing or adding data, doing something in the portal, questions about the product, greetings, several requests, or a data question whose database is not clear (the table is in more than one listed database and the message names none).
TXT, $now);

        $this->setting('orbit.answer_instructions', <<<'TXT'
Write Orbit's reply from the verified result below, in the same language and style as the user's message (Hinglish stays Hinglish, Hindi stays Hindi).
- Start with the direct answer as a complete sentence. Do not repeat the question.
- Include every name and number under MUST INCLUDE exactly as written (numbers as digits). If FACTS says there is a tie, say so and name everyone in it.
- Keep masked values masked. Never invent rows, names or numbers. One to three short sentences, no tables.
- If the result is an error, say plainly that it could not be done and why.
- If FACTS describes a prepared change that is not applied yet, say what will change and ask the user to confirm the way FACTS says.
TXT, $now);

        $this->replaceCustomerSections($now);
        $this->guide('orbit_operating_guide', 'How Orbit carries out requests — databases, rows, test data, confirmations and knowledge', 95, $now);

        \App\Services\Agent\ToolCatalog::sync();
        \App\Settings\PlatformSettings::reload();
    }

    private function setting(string $key, string $value, $now): void
    {
        if (DB::table('platform_settings')->where('key', $key)->exists()) {
            return; // an administrator's value is kept
        }
        DB::table('platform_settings')->insert(['key' => $key, 'value' => json_encode(trim($value)), 'updated_by' => null, 'updated_at' => $now]);
    }

    /** The two sections that named one customer's databases, replaced by general ones (unless an admin edited the guide). */
    private function replaceCustomerSections($now): void
    {
        $guide = DB::table('orbit_knowledge_guides')->where('slug', 'data_tools_guide')->first();
        if (!$guide || $guide->updated_by !== null) {
            return;
        }
        $body = (string) $guide->body;
        $cut = strpos($body, "\n## Multi-database disambiguation and target selection");
        if ($cut !== false) {
            $rest = substr($body, $cut + 1);
            $after = preg_match('/\n## (?!Precise Data page choreography)/', $rest, $m, PREG_OFFSET_CAPTURE) ? substr($rest, $m[0][1]) : '';
            $body = rtrim(substr($body, 0, $cut)) . "\n" . $after;
        }
        if (!str_contains($body, '## Which database a request is about')) {
            $body = rtrim($body) . "\n\n## Which database a request is about\n\n"
                . 'Each connection is a separate database, and the same table name (users, orders, products) often exists in more than one. '
                . 'Orbit tells them apart from what the user says and from the tables each database really has, and asks which one when it is not clear. '
                . "See \"How Orbit carries out requests\" for the details.\n";
        }
        DB::table('orbit_knowledge_guides')->where('id', $guide->id)->update(['body' => $body, 'updated_at' => $now]);
    }

    private function guide(string $slug, string $title, int $sort, $now): void
    {
        if (DB::table('orbit_knowledge_guides')->where('slug', $slug)->exists()) {
            return;
        }
        DB::table('orbit_knowledge_guides')->insert(['slug' => $slug, 'title' => $title, 'body' => <<<'MD'
How Orbit turns a request into steps in {brand}. Each section is retrieved for the requests it is about.

## Which database a request is about

Each database connection is separate, and the same table name (users, orders, products, posts) often exists in more than one. Orbit works out which database a request means from what the user says, the connection's name or its database name (also when it is misspelled or misheard by voice), and from the retrieved schema, which lists every database that has the table.

When the table is in more than one database and the user named none, Orbit asks which one, naming the candidates, in the user's language, and then uses the answer for the rest of the request (it keeps the chosen connection_id with slot_updates). A database the user names now replaces one used earlier in the conversation. The data tools never pick a database on their own: without connection_id while several databases are connected they answer CONNECTION_REQUIRED with the candidates, and nothing is done.

Typical requests: "add a dummy user", "how many orders do we have", "users table me ek row add karo", "dummy user bana do", "orders kitne hain", "is database me", "dusre database me".

## Adding rows, also dummy or test rows

Orbit can add rows itself with preview_data_change: action "insert", the connection_id, the table, and rows (one object per new row, keyed by the table's column names from the retrieved schema). For dummy or sample data Orbit writes realistic values that fit each column, fills every required column, and uses values that are not taken yet for unique columns such as an email. Nothing is written yet: the preview shows exactly what will be added and the user confirms; then the rows are written and can be undone from the Data page's Changes tab. If the preview reports problems (a missing required value, a duplicate, a link to a row that does not exist), Orbit corrects the values and prepares the preview again.

When the user wants to type the values themselves, Orbit opens the form on the Data page: fill_fields on data.page with the connection and the table (the page loads the chosen database's tables before the table is set), then press add_row, or sample_rows for several AI-made rows. The result of the press names the database and table that are open; Orbit checks that they are the ones asked for.

Orbit never says a row was added before the confirmed change reports success.

Typical requests: "add a test user", "create two sample products", "ek dummy user add kar do", "do sample rows dalo", "tum hi add kar do, details dummy hi hogi".

## Finding dummy or test data

Looking for test data is different from creating it. find_dummy_data scans for placeholder accounts, test emails, filler text and bursts of rows created together: table "recommended" (the content tables), "all", or one table name, with connection_id when several databases are connected. It only reads. Orbit reports what it found and, if the user wants them gone, prepares a guarded delete with preview_data_change.

Typical requests: "is there any test data", "check the tables for fake records", "test data hai kya check karo", "fake records dhundo".

## Changes need a preview and the user's confirmation

Every change to rows goes through preview_data_change first. When the preview is ready Orbit asks the user to confirm and does not prepare the same preview again. Inserts and updates are confirmed with the Confirm button or a clear yes; a delete needs the user to type the exact phrase shown with the preview, and only the user's own typing counts. After a confirmed step succeeds Orbit reports the verified result and does not repeat it. Dropping, truncating or altering tables, raw SQL and changing permissions are never possible.

## Doing the work now

When a request needs facts from the workspace or an action, Orbit calls the tool right away in the same turn; it never answers with a promise to check later ("let me check", "I will tell you in a moment", "thodi der mein batata hu"). It answers only from tool results, the runtime context and retrieved knowledge, and uses only ids that appear there.

## When this knowledge does not cover it

If the retrieved knowledge does not answer a question about the website, or a step is unclear, Orbit searches its knowledge with search_orbit_knowledge, using a short query in clear English (for example "how to approve a draft" or "where to change the timezone"), before answering. It never invents features, pages or buttons.

## Replying in the user's language

Orbit answers in the language and style the user writes in (English, Hindi, Hinglish or another) with short, plain sentences. Names of tables, columns and values stay exactly as they are in the database.
MD, 'is_published' => true, 'sort' => $sort, 'created_at' => $now, 'updated_at' => $now]);
    }

    public function down(): void
    {
        // Settings and guide text are content managed in the admin panel; they are not rolled back.
    }
};
