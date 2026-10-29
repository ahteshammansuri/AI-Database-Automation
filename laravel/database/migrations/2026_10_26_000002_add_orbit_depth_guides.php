<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * More of Orbit's knowledge, stored in the database like the other guides: databases explained simply, accounts and
 * users, troubleshooting, and working with Orbit (tours, walkthroughs, thinking). A guide is only added when it is
 * missing, so an admin's edits are never replaced. They become live when an admin publishes to Orbit.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        $this->add('database_basics', 'Databases explained simply — tables, keys, types and how {brand} reads them', <<<'MD'
Plain explanations of database words, for users who are not database experts, and how {brand} treats each one.

## Tables, rows and columns

A database holds tables. A table is like a spreadsheet: each row is one record (one blog post, one product, one customer) and each column is one piece of information about it (title, price, email). The Schema Explorer lists every table of a connection with its columns; the Data page shows the rows of one table.

## Primary keys

The primary key is the column (usually `id`) whose value is different for every row, so one row can be named exactly. {brand} pins every change to primary keys: an update or delete only touches the rows shown in the preview, by their keys, never "all rows that match".

## Linked records (foreign keys)

A foreign key links a row to a row in another table, for example `posts.category_id` points at `categories.id`. The Schema Explorer shows these links. When a row is added, a linked column only accepts an id that really exists in the other table. Before a delete, the preview shows how many rows elsewhere depend on the row and what the database will do with them.

## Column types

- Whole numbers (int, bigint) and decimals (decimal, float).
- Short text (varchar, with a maximum length) and long text (text).
- Dates and times (date, datetime, timestamp).
- Yes/no values (boolean, often stored as tinyint 0 or 1).
- A fixed list of choices (enum): only the listed values are accepted.
- JSON: structured data stored in one column.

Every value written by {brand} is checked against the column's type, length and allowed values first.

## Empty values, defaults and required columns

NULL means "no value". A column that does not allow NULL and has no default is required: a new row must give it a value. A default is the value the database fills in when none is given. Auto-increment columns (usually `id`) are filled by the database itself.

## Unique columns and indexes

A unique column (such as a slug or an email) cannot hold the same value twice; {brand} checks this before adding a row. An index makes searching a column faster; it does not change the data.

## Dates, times and the data timezone

A connection can name its data timezone: the time zone the database stores its dates in. {brand} uses it when it writes a date or time into that database, so "now" is the same moment the database's own data means. Your own timezone (Account settings) is used to show times to you and for schedules.

## How {brand} reads your database

Testing a connection only signs in and reads the server version. A schema scan reads table names, columns, types, keys, defaults, indexes and links; it does not copy your rows. Rows are read only when you open them on the Data page or ask a question, and only the rows needed.

## Table access on a connection

Every table has one of three classes:
- Blocked: credential, token and session tables. Never read or written, and no setting can change that.
- View only: financial, order, payment, permission and audit tables by default. The connection owner can make one editable in the Schema Explorer; the change is recorded in the audit log.
- Editable: every other table, subject to the connection's access mode (read only by default).

## Column sensitivity

- Secret columns (password hashes, tokens, card numbers, national ids) are never returned and never written.
- Personal columns (emails, phone numbers) are masked. The owner can reveal them on the Data page; every reveal is recorded in the audit log.
- Everything else is shown as stored.

## Database engines

MySQL and MariaDB are supported. PostgreSQL goes through the same adapter, but only on a server that has the PHP PostgreSQL driver installed; the connection form says so when it is missing. SQLite is refused for user connections (it would mean reading a file on this server), and SQL Server and MongoDB have no adapter yet.

## How Orbit answers a question about your data

Orbit turns the question into one SELECT query. Before it runs, the server checks it: one statement only, allowed tables and functions only, no secret columns, a forced row limit (set by the administrator, 200 rows by default), a time limit, and a read-only transaction. Personal values stay masked. Orbit then shows the answer with the query it used, so you can check how it got there. Orbit never writes SQL that changes data: changes go through the preview and your confirmation.
MD, 60, $now);

        $this->add('account_and_users', 'Your account, users and workspace', <<<'MD'
How accounts work in {brand}: signing in, what is private to each user, and the settings on the Account page.

## Signing up and signing in

Anyone can create an account from the landing page with a name, email and password, unless the administrator has closed sign-ups (then the sign-up page says so). The minimum password length is set by the administrator. Each person uses their own account; there is no shared demo login.

## Your workspace is private

Every user has their own connections, AI provider keys, knowledge documents, automations, drafts, approvals, schedules, runs and audit log. The server checks ownership on every request and in every background job, so another user can never see or change your resources, even by guessing an id. Orbit works with the same rule: it only sees the signed-in user's workspace.

## Profile

On Account settings you can change your name, email and timezone. Changing the email needs your current password. Your timezone is used to show times and for schedules.

## Password

Changing the password needs the current one; the new one must be different and meet the minimum length. Attempts are rate limited.

## Signed-in sessions

Account settings lists every device where you are signed in. You can sign out one session, or all the others at once (for example after using a shared computer).

## AI usage

Account settings shows how much AI you used over the last 7, 30 or 90 days: calls and tokens in total, per day, per provider and model, and per purpose (Orbit, automation writing and previews, questions about data, sample data, images, model tests and more).

## Limits set by the administrator

The administrator can limit how many connections and automations each customer may create (0 means no limit). When a limit is reached, the form says so instead of saving.

## Suspended accounts

An administrator can suspend an account, with a reason. Its sessions end at once and it cannot sign in until an administrator reactivates it. Both are recorded in the account's audit log.

## Administrators

Administrators use a separate admin panel with their own sign-in; a customer account is never an admin. Admin roles decide which areas each admin can open (customers, settings, Orbit knowledge and page tours, system health). Admins do not see customers' database passwords or API keys: those are encrypted and never shown after saving.
MD, 70, $now);

        $this->add('troubleshooting', 'Troubleshooting — common problems and what to do', <<<'MD'
Common problems, what they mean, and what to do. Orbit uses this to explain an error in plain words and suggest the next step.

## Connection test: access denied

The database refused the username or password. Check both (they are case sensitive), and that this user may connect from the {brand} server's address. Type the password again in the form; Orbit never asks for it in chat.

## Connection test: unknown database

The server was reached and the sign-in worked, but no database has that name. Check the spelling of the database name.

## Connection test: refused, unreachable or timed out

{brand} could not reach the database server. Check the host and port (MySQL uses 3306 by default), that the database server is running, and that a firewall allows connections from the {brand} server. A database on your own computer is not reachable from a hosted server.

## Connection refused by the platform's rules

Some addresses and ports are never allowed, to protect the server: cloud metadata addresses (such as 169.254.169.254), 0.0.0.0, and ports of other services such as SSH (22) or Telnet (23). The form shows the reason under the host or port field.

## The schema scan shows few or no tables

The database user may not have permission to see the tables, or the database is empty. Blocked tables (credentials, tokens, sessions) are listed as blocked, not hidden. Scan again after changing permissions.

## A table cannot be changed

Either the connection is read only (the owner can change the access mode in the connection settings), or the table is view only (financial, order, permission or audit data; the owner can make it editable in the Schema Explorer), or it is blocked (never changeable). The Data page says which one.

## An automation run failed

Open Executions and the run's Details: it shows the error, the content, the exact database change and a step by step timeline. Fix the cause (for example a connection that no longer connects, or a required column without a value in the field mapping) and use Retry. Nothing is half written: each publish runs in a transaction.

## A draft is waiting or the approval email did not arrive

Drafts that need approval wait on the Approvals page, where they can be reviewed, edited, approved or rejected; the email is only a shortcut. If emails do not arrive, the administrator's mail settings may not be set up, or the email is in spam.

## AI provider errors

- Invalid API key: save the key again on AI Providers and press Test.
- Quota or rate limit (HTTP 429): the provider refused because the plan's limit was reached. For Gemini, Orbit first tries the provider's other available models and says which one answered. If all are exhausted, wait for the limit to reset, add billing at the provider, or choose another provider or a local Ollama model.
- Ollama not reachable or model not found: start Ollama on the server and pull the model (for example `ollama pull qwen2.5:3b`).

## Orbit is slow

Orbit's speed is mostly the speed of the model behind it. A small local model on a CPU can take 20 seconds or more per step; free cloud tiers can be slow or rate limited. Choose a faster model for "Orbit and planning" on AI Providers. Orbit shows which model answered when it had to use a fallback.

## Orbit says the portal is not open

Orbit works on screen through an open portal tab. If no tab is open (for example when using Orbit from the phone without the portal open on the computer), it can still answer and use server tools, but it cannot click or show things.

## No Orbit background worker is running

Requests are saved but nothing processes them until the agent worker runs. On a local install, start everything with `./run_all.sh`.

## Orbit does not speak

Check that voice replies are on in Orbit's panel (the speaker button) and that the browser allows sound. Orbit's text is always shown, even when it is not spoken.
MD, 80, $now);

        $this->add('working_with_orbit', 'Working with Orbit — tours, walkthroughs and thinking', <<<'MD'
How to get the most out of Orbit, {brand}'s assistant.

## A tour of the portal

Say "give me a tour". Orbit goes to every page in turn, points at its main area and explains in two or three calm sentences what the page is for. At the end it asks whether you want any page in detail.

## A detailed walkthrough of one page

Say "explain this page" for a short explanation, or "walk me through this page in detail". In detail, Orbit opens the page's forms and windows, points at each field and button and says what it does, then closes what it opened. It only presses buttons that open or close something. Buttons that change data (save, approve, publish, delete, run now) are pointed at and explained, never pressed. Parts that are not on screen right now (for example an empty list) are skipped and Orbit says so.

## Stopping or interrupting

Press Escape, the Stop button, or simply say something new: Orbit stops speaking and ends the tour or task at once.

## Orbit's thinking

While Orbit works, its panel shows a short "Thinking" note: what it understood and the next steps it plans. It is a summary written for you, not hidden reasoning, and never contains secrets.

## Several steps at once

When Orbit already knows the next on-screen steps (open a page, open a form, fill fields), it does them in one go instead of stopping to think between each. Anything that changes data, such as saving with consequences, approving, publishing or deleting, still waits for your confirmation.

## Long tasks

If a request will take a while (a tour of every page, several detailed walkthroughs, or many steps) and you did not ask for the long version, Orbit says what it will do and about how long it takes, and asks before starting.

## What Orbit never does

It never types or reads passwords or API keys (you type them in the form), never runs SQL that changes data, never presses a data-changing button without your confirmation, and never acts on another user's resources. The server decides what Orbit may do, not the model.
MD, 90, $now);
    }

    private function add(string $slug, string $title, string $body, int $sort, $now): void
    {
        if (DB::table('orbit_knowledge_guides')->where('slug', $slug)->exists()) {
            return;
        }
        DB::table('orbit_knowledge_guides')->insert(['slug' => $slug, 'title' => $title, 'body' => $body, 'is_published' => true, 'sort' => $sort, 'created_at' => $now, 'updated_at' => $now]);
    }

    public function down(): void
    {
        // Guide text is content managed in the admin panel; it is not rolled back.
    }
};
