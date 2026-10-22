<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Orbit's knowledge of the website (product guides), edited in the admin panel and published to the AI service.
 * published_hash is the content that is live in Orbit, so the panel can tell which edits are not live yet.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orbit_knowledge_guides', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 81)->unique();
            $table->string('title', 120);
            $table->longText('body');
            $table->boolean('is_published')->default(true);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->string('published_hash', 64)->nullable();
            $table->timestamp('published_at')->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('admins')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('orbit_knowledge_guides');
    }
};
