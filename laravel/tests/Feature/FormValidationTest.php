<?php

namespace Tests\Feature;

use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\DbConnection;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * Validation returns 422 with a clear message keyed by the field it is about, so the portal can show it
 * directly under that field (never only a generic banner, never a 500).
 */
class FormValidationTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_reports_each_missing_field_by_name()
    {
        $this->postJson('/api/auth/register', [])
            ->assertStatus(422)
            ->assertJsonPath('errors.name.0', 'Name is required.')
            ->assertJsonPath('errors.email.0', 'Email is required.')
            ->assertJsonPath('errors.password.0', 'Password is required.');
    }

    public function test_registration_explains_duplicate_email_short_and_mismatched_passwords()
    {
        User::factory()->create(['email' => 'taken@example.test']);

        $this->postJson('/api/auth/register', ['name' => 'A', 'email' => 'taken@example.test', 'password' => 'short', 'password_confirmation' => 'short'])
            ->assertStatus(422)
            ->assertJsonPath('errors.email.0', 'An account with this email already exists. Sign in instead.')
            ->assertJsonPath('errors.password.0', 'Password must be at least 8 characters.');

        $this->postJson('/api/auth/register', ['name' => 'A', 'email' => 'new@example.test', 'password' => 'longenough1', 'password_confirmation' => 'different1'])
            ->assertStatus(422)
            ->assertJsonPath('errors.password.0', 'The passwords do not match.');
    }

    public function test_wrong_password_is_reported_on_the_password_field()
    {
        User::factory()->create(['email' => 'me@example.test', 'password' => bcrypt('correct-horse')]);

        $this->postJson('/api/auth/login', ['email' => 'me@example.test', 'password' => 'nope'])
            ->assertStatus(422)
            ->assertJsonPath('errors.password.0', 'The email or password is incorrect.');
        $this->postJson('/api/auth/login', ['email' => 'not-an-email'])
            ->assertStatus(422)
            ->assertJsonPath('errors.email.0', 'Enter a valid email address, like name@example.com.')
            ->assertJsonPath('errors.password.0', 'Password is required.');
    }

    public function test_connection_details_are_required_and_checked_field_by_field()
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/connections', ['name' => 'Blog'])
            ->assertStatus(422)
            ->assertJsonPath('errors.host.0', 'Host is required.')
            ->assertJsonPath('errors.database_name.0', 'Database name is required.')
            ->assertJsonPath('errors.username.0', 'Username is required.');

        $this->actingAs($user)->postJson('/api/connections', [
            'name' => str_repeat('x', 121), 'host' => 'bad host!', 'port' => 70000, 'database_name' => 'my db',
            'username' => 'root', 'data_timezone' => 'Mars/Base', 'connection_timeout' => 90,
        ])
            ->assertStatus(422)
            ->assertJsonPath('errors.name.0', 'Name must be 120 characters or fewer.')
            ->assertJsonPath('errors.host.0', 'Host must be a hostname or IP address, like 127.0.0.1 or db.example.com.')
            ->assertJsonPath('errors.port.0', 'Port must be at most 65535.')
            ->assertJsonPath('errors.database_name.0', 'Database name can use letters, numbers, _, $ and - (up to 64 characters).')
            ->assertJsonPath('errors.data_timezone.0', 'Use a valid timezone, like Asia/Kolkata or UTC.')
            ->assertJsonPath('errors.connection_timeout.0', 'Timeout must be between 1 and 30 seconds.');

        $this->actingAs($user)->postJson('/api/connections', ['name' => 'Blog', 'connection_mode' => 'uri', 'connection_uri' => 'http://nope'])
            ->assertStatus(422)
            ->assertJsonPath('errors.connection_uri.0', 'Connection URI must start with mysql://, like mysql://user:password@127.0.0.1:3306/blog. For PostgreSQL, use Connection details.');

        // A URI that passes the format check but cannot be used is still a message under the URI field.
        $this->actingAs($user)->postJson('/api/connections', ['name' => 'Blog', 'connection_mode' => 'uri', 'connection_uri' => 'mysql://root:pw@127.0.0.1:3306'])
            ->assertStatus(422)
            ->assertJsonPath('errors.connection_uri.0', 'Add the database name after the host, like mysql://user:password@127.0.0.1:3306/blog.');
        $this->actingAs($user)->postJson('/api/connections/test', ['connection_mode' => 'uri', 'connection_uri' => 'mysql:///nohost'])
            ->assertStatus(422)
            ->assertJsonPath('errors.connection_uri.0', 'Connection URI is not in the expected format: mysql://user:password@host:3306/database.');
    }

    public function test_unsafe_host_is_a_field_message_not_a_server_error()
    {
        $user = User::factory()->create();

        $res = $this->actingAs($user)->postJson('/api/connections', [
            'name' => 'Metadata', 'host' => '169.254.169.254', 'port' => 3306, 'database_name' => 'x', 'username' => 'root',
        ]);
        $res->assertStatus(422);
        $this->assertStringContainsString('169.254.169.254', $res->json('errors.host.0'));
    }

    public function test_duplicate_connection_name_is_reported_on_the_name_field()
    {
        $user = User::factory()->create();
        DbConnection::create([
            'user_id' => $user->id, 'name' => 'Blog DB', 'db_type' => 'mysql', 'host' => '127.0.0.1', 'port' => 3306,
            'database_name' => 'blog', 'username' => 'root', 'encrypted_password' => 'x', 'ssl_mode' => 'disabled',
        ]);

        $this->actingAs($user)->postJson('/api/connections', [
            'name' => 'Blog DB', 'host' => '127.0.0.1', 'port' => 3306, 'database_name' => 'blog', 'username' => 'root',
        ])
            ->assertStatus(422)
            ->assertJsonPath('errors.name.0', "You already have a connection named 'Blog DB'. Choose a different name.");
    }

    public function test_cloud_provider_needs_a_key_and_ollama_needs_a_full_address()
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/ai-providers', ['provider_type' => 'openai', 'model_name' => 'gpt-4o-mini'])
            ->assertStatus(422)
            ->assertJsonPath('errors.api_key.0', 'Paste your API key for this provider. It is stored encrypted.');

        $this->actingAs($user)->postJson('/api/ai-providers', ['provider_type' => 'ollama', 'model_name' => 'qwen2.5:3b', 'base_url' => 'localhost:11434'])
            ->assertStatus(422)
            ->assertJsonPath('errors.base_url.0', 'Enter the full address, like http://localhost:11434.');

        $this->actingAs($user)->postJson('/api/ai-providers', ['provider_type' => 'ollama'])
            ->assertStatus(422)
            ->assertJsonPath('errors.model_name.0', 'Model is required.');
    }

    public function test_knowledge_upload_rejects_unsupported_files_on_the_file_field()
    {
        $user = User::factory()->create();

        $this->actingAs($user)->post('/api/knowledge', ['file' => UploadedFile::fake()->create('notes.docx', 4)], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('errors.file.0', 'Upload a Markdown (.md), text (.txt) or PDF (.pdf) file.');

        $this->actingAs($user)->post('/api/knowledge', [], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('errors.file.0', 'File is required.');
    }

    public function test_editing_a_draft_reports_problems_on_each_column()
    {
        $user = User::factory()->create();
        $conn = DbConnection::create([
            'user_id' => $user->id, 'name' => 'Blog DB', 'db_type' => 'mysql', 'host' => '127.0.0.1', 'port' => 3306,
            'database_name' => 'blog', 'username' => 'root', 'encrypted_password' => 'x', 'ssl_mode' => 'disabled',
        ]);
        $automation = Automation::create([
            'user_id' => $user->id, 'name' => 'Daily blog', 'connection_id' => $conn->id, 'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE', 'ai_provider' => 'mock', 'ai_model' => 'mock',
            'field_mappings' => [['field_name' => 'title', 'mapping_type' => 'AI_GENERATED']],
            'schedule_type' => 'DAILY', 'generation_time' => '09:00', 'publication_time' => '10:00', 'timezone' => 'UTC',
        ]);
        $execution = AutomationExecution::create([
            'user_id' => $user->id, 'automation_id' => $automation->id, 'status' => 'PENDING_APPROVAL',
            'idempotency_key' => 'fv1', 'publication_time' => now()->addHour(),
        ]);
        $version = ContentVersion::create([
            'user_id' => $user->id, 'execution_id' => $execution->id, 'version_number' => 1, 'status' => 'PENDING_APPROVAL',
            'payload' => ['title' => 'Hello', 'views' => 3, 'slug' => 'hello', 'category_id' => 'Cloud'],
            'meta' => ['write_plan' => ['columns' => [
                ['column' => 'title', 'type' => 'varchar(10)', 'required' => true],
                ['column' => 'views', 'type' => 'int(11)', 'required' => false],
                ['column' => 'slug', 'type' => 'varchar(200)', 'required' => true],
                ['column' => 'category_id', 'type' => 'int(10) unsigned', 'required' => true],
            ], 'relations' => [['column' => 'category_id', 'table' => 'categories', 'lookup' => 'Cloud']]]],
        ]);

        $this->actingAs($user)->putJson("/api/approvals/{$version->id}/payload", ['payload' => [
            'title' => 'A title that is far too long', 'views' => 'many', 'slug' => '  ', 'password' => 'x',
        ]])
            ->assertStatus(422)
            ->assertJsonPath('errors', [
                'payload.title' => ['title must be 10 characters or fewer (now 28).'],
                'payload.views' => ['views must be a whole number.'],
                'payload.slug' => ['slug is required.'],
                'payload.password' => ["'password' is not part of this draft, so it cannot be added here."],
            ]);
        $this->assertSame('Hello', $version->fresh()->payload['title']);

        // Approving with a bad edit is refused the same way and leaves the run awaiting review.
        $res = $this->actingAs($user)->postJson("/api/approvals/{$version->id}/portal-approve", ['payload' => ['title' => '', 'views' => 3, 'slug' => 'hello']]);
        $res->assertStatus(422);
        $this->assertSame(['title is required.'], $res->json('errors')['payload.title']);
        $this->assertSame('PENDING_APPROVAL', $version->fresh()->status);

        // A linked column may hold the category's name (resolved when published), so it is not a number problem.
        $this->actingAs($user)->putJson("/api/approvals/{$version->id}/payload", ['payload' => ['title' => 'Fine', 'views' => '12', 'slug' => 'fine', 'category_id' => 'Databases']])
            ->assertOk();
    }
}
