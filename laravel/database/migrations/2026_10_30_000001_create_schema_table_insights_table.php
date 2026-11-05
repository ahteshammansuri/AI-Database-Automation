<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What the customer's model understood about one table of a connection: each column's role and meaning, names for
 * coded values, and the table an id-only column points to. Re-read when the table's columns change (schema_hash).
 * Platform data only; nothing is written to the customer's database.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('schema_table_insights', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('connection_id')->constrained('db_connections')->cascadeOnDelete();
            $table->string('table_name', 64);
            $table->string('schema_hash', 40);
            $table->string('status', 16)->default('pending'); // pending | ready | failed
            $table->string('source', 16)->nullable();         // model | embeddings
            $table->string('model', 120)->nullable();
            $table->json('insights')->nullable();
            $table->text('error')->nullable();
            $table->timestamp('analyzed_at')->nullable();
            $table->timestamps();
            $table->unique(['connection_id', 'table_name'], 'sti_connection_table_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('schema_table_insights');
    }
};
