<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The automation a customer is still building (every step: connection, table, column choices, content, schedule),
 * saved as they go so it survives closing the tab or switching devices. One draft per customer and kind.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('automation_drafts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 30)->default('automation'); // automation | manual_publish
            $table->json('payload');
            $table->unsignedTinyInteger('step')->default(1);
            $table->timestamps();
            $table->unique(['user_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('automation_drafts');
    }
};
