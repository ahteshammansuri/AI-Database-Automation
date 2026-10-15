<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('model_roles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role', 32); // 'planner', 'generator', 'classifier', 'summarizer'
            $table->string('provider', 32)->default('ollama'); // 'ollama', 'mock', 'openai', 'gemini', 'anthropic'
            $table->string('model_name', 64)->default('llama3.2:1b');
            $table->decimal('temperature', 3, 2)->default(0.70);
            $table->integer('max_tokens')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['user_id', 'role']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('model_roles');
    }
};
