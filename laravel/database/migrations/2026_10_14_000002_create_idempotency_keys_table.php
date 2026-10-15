<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('idempotency_keys')) {
            Schema::create('idempotency_keys', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
                $table->foreignId('automation_id')->nullable()->constrained()->cascadeOnDelete();
                $table->string('idempotency_key', 255)->unique();
                $table->string('scheduled_slot', 64)->nullable();
                $table->string('content_hash', 64)->nullable();
                $table->string('target_record_id', 128)->nullable();
                $table->string('status', 32)->default('IN_PROGRESS'); // IN_PROGRESS, COMMITTED, FAILED
                $table->timestamps();

                $table->index(['automation_id', 'scheduled_slot']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('idempotency_keys');
    }
};
