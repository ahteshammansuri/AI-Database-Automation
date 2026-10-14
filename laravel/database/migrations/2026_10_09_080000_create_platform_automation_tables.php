<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // 1. Customer Target Database Connection Profiles
        Schema::create('db_connections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('db_type')->default('mysql');
            $table->string('host');
            $table->integer('port')->default(3306);
            $table->string('database_name');
            $table->string('username');
            $table->text('encrypted_password');
            $table->string('ssl_mode')->default('preferred');
            $table->string('status')->default('configured');
            $table->timestamps();
        });

        // 2. User-specific AI Provider Configurations
        Schema::create('ai_providers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('provider_type'); // ollama, mock, openai, gemini, anthropic
            $table->string('model_name');
            $table->text('encrypted_api_key')->nullable();
            $table->string('base_url')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // 3. Knowledge Base Documents (RAG)
        Schema::create('knowledge_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->string('file_path')->nullable();
            $table->string('file_type')->default('txt'); // md, txt, pdf
            $table->unsignedBigInteger('file_size')->default(0);
            $table->integer('chunk_count')->default(0);
            $table->integer('vector_count')->default(0);
            $table->string('status')->default('indexed');
            $table->timestamps();
        });

        // 4. Automation Definitions
        Schema::create('automations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('connection_id')->constrained('db_connections')->cascadeOnDelete();
            $table->string('name');
            $table->string('target_table');
            $table->string('operation_mode')->default('AI_CREATE'); // AI_CREATE, AI_ENRICH, MANUAL_SCHEDULE
            $table->json('field_mappings');
            $table->string('ai_provider')->default('mock');
            $table->string('ai_model')->nullable();
            $table->text('prompt_context')->nullable();
            $table->json('knowledge_document_ids')->nullable();
            $table->string('schedule_type')->default('DAILY'); // ONE_TIME, DAILY, WEEKLY
            $table->string('generation_time')->default('08:00');
            $table->string('publication_time')->default('09:00');
            $table->string('timezone')->default('UTC');
            $table->boolean('requires_approval')->default(true);
            $table->string('reviewer_email')->nullable();
            $table->string('timeout_policy')->default('AUTO_PUBLISH_LATEST'); // AUTO_PUBLISH_LATEST, KEEP_DRAFT, CANCEL
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // 5. Automation Executions
        Schema::create('automation_executions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('automation_id')->constrained()->cascadeOnDelete();
            $table->string('status')->default('PENDING_APPROVAL'); // PENDING_APPROVAL, APPROVED, PUBLISHING, PUBLISHED, REJECTED, FAILED
            $table->string('idempotency_key')->unique();
            $table->timestamp('generation_started_at')->nullable();
            $table->timestamp('generation_completed_at')->nullable();
            $table->timestamp('publication_time')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->text('error_message')->nullable();
            $table->string('target_record_id')->nullable();
            $table->timestamps();
        });

        // 6. Immutable Content Versions
        Schema::create('content_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('execution_id')->constrained('automation_executions')->cascadeOnDelete();
            $table->integer('version_number')->default(1);
            $table->json('payload');
            $table->text('rejection_feedback')->nullable();
            $table->string('status')->default('PENDING_APPROVAL'); // PENDING_APPROVAL, APPROVED, REJECTED, SUPERSEDED
            $table->timestamps();
        });

        // 7. Signed Approval Tokens
        Schema::create('approval_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('version_id')->constrained('content_versions')->cascadeOnDelete();
            $table->string('token', 64)->unique();
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamps();
        });

        // 8. Tenant Scoped Audit Logs
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action');
            $table->string('resource_type');
            $table->string('resource_id')->nullable();
            $table->json('metadata')->nullable();
            $table->string('ip_address')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('approval_tokens');
        Schema::dropIfExists('content_versions');
        Schema::dropIfExists('automation_executions');
        Schema::dropIfExists('automations');
        Schema::dropIfExists('knowledge_documents');
        Schema::dropIfExists('ai_providers');
        Schema::dropIfExists('db_connections');
    }
};
