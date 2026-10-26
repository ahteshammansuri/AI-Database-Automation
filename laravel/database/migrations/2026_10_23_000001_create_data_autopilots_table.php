<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Data autopilot: AI sample rows added to a customer's table on a schedule. Each run is validated like any insert and
 * recorded as a data change (undoable). Paused automatically after repeated failures.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('data_autopilots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('connection_id')->constrained('db_connections')->cascadeOnDelete();
            $table->string('table_name', 64);
            $table->string('name', 120);
            $table->unsignedSmallInteger('rows_per_run')->default(5);
            $table->text('instructions')->nullable();
            $table->string('frequency', 10)->default('daily'); // hourly | daily | weekly
            $table->unsignedTinyInteger('every_hours')->default(1);
            $table->string('run_time', 5)->default('09:00');
            $table->json('weekdays')->nullable();
            $table->string('timezone', 64)->default('UTC');
            $table->date('ends_on')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamp('next_run_at')->nullable();
            $table->timestamp('last_run_at')->nullable();
            $table->string('last_status', 20)->nullable(); // added | failed
            $table->text('last_message')->nullable();
            $table->unsignedBigInteger('last_change_id')->nullable();
            $table->unsignedInteger('runs_count')->default(0);
            $table->unsignedInteger('rows_added')->default(0);
            $table->unsignedTinyInteger('failures_in_a_row')->default(0);
            $table->timestamps();
            $table->index(['is_active', 'next_run_at']);
            $table->index(['user_id', 'connection_id', 'table_name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('data_autopilots');
    }
};
