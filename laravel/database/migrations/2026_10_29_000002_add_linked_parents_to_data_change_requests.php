<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * New linked rows (a new category for a new blog post) that a change adds first, in the same transaction, and the ids
 * they received, so Undo can remove them again. Encrypted: a new person row can hold personal data.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('data_change_requests', function (Blueprint $table) {
            $table->longText('linked_parents')->nullable()->after('patch_values');
        });
    }

    public function down(): void
    {
        Schema::table('data_change_requests', function (Blueprint $table) {
            $table->dropColumn('linked_parents');
        });
    }
};
