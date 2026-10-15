<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('media_assets')) {
            Schema::create('media_assets', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->string('disk', 32)->default('public');
                $table->string('path', 512);
                $table->string('original_filename', 255)->nullable();
                $table->string('mime_type', 64);
                $table->unsignedBigInteger('file_size');
                $table->unsignedInteger('width')->nullable();
                $table->unsignedInteger('height')->nullable();
                $table->string('hash', 64)->nullable(); // SHA-256 for deduplication
                $table->timestamps();

                $table->index(['user_id', 'hash']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('media_assets');
    }
};
