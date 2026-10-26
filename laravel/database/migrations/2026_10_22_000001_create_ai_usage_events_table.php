<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Model usage reported by the AI service for each request (X-AI-Usage header): tokens per provider/model, who it was
 * for, what it was for and which run or Orbit request caused it. No prompts or outputs are stored.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_usage_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('purpose', 40);
            $table->string('provider', 40);
            $table->string('model', 120)->nullable();
            $table->string('kind', 20)->default('chat');
            $table->unsignedInteger('calls')->default(1);
            $table->unsignedInteger('prompt_tokens')->default(0);
            $table->unsignedInteger('completion_tokens')->default(0);
            $table->string('subject_type', 40)->nullable();
            $table->unsignedBigInteger('subject_id')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['user_id', 'created_at']);
            $table->index(['subject_type', 'subject_id']);
            $table->index(['provider', 'model']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_usage_events');
    }
};
