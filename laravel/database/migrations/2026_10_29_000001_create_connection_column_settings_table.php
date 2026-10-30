<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The owner's own reading of a connection's schema: whether a column links to another table (confirmed, changed,
 * added or "not a link"), names for the stored values of status-like columns, and which column names a table's rows.
 * Platform data only; nothing is written to the customer's database.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('connection_column_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('connection_id')->constrained('db_connections')->cascadeOnDelete();
            $table->string('table_name', 64);
            $table->string('column_name', 64);
            $table->string('link_mode', 12)->default('auto'); // auto | link | none
            $table->string('ref_table', 64)->nullable();
            $table->string('ref_column', 64)->nullable();
            $table->json('value_labels')->nullable();           // {"1": "Published", "0": "Draft"}
            $table->timestamps();
            $table->unique(['connection_id', 'table_name', 'column_name'], 'ccs_connection_table_column_unique');
        });

        Schema::table('schema_table_annotations', function (Blueprint $table) {
            $table->string('display_column', 64)->nullable()->after('table_name');
        });
    }

    public function down(): void
    {
        Schema::table('schema_table_annotations', function (Blueprint $table) {
            $table->dropColumn('display_column');
        });
        Schema::dropIfExists('connection_column_settings');
    }
};
