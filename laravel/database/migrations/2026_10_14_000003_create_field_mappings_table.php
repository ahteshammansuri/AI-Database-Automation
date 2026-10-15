<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('field_mappings')) {
            Schema::create('field_mappings', function (Blueprint $table) {
                $table->id();
                $table->foreignId('automation_id')->constrained()->cascadeOnDelete();
                $table->string('column_name', 128);
                $table->string('role', 64);
                $table->float('confidence')->default(1.0);
                $table->boolean('confirmed')->default(true);
                $table->text('override_instructions')->nullable();
                $table->timestamps();

                $table->unique(['automation_id', 'column_name']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('field_mappings');
    }
};
