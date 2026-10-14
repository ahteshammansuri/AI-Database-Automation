<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (Schema::hasTable('schema_snapshots')) {
            Schema::table('schema_snapshots', function (Blueprint $table) {
                $table->index(['connection_id', 'version'], 'idx_snapshots_conn_version');
                $table->index(['connection_id', 'id'], 'idx_snapshots_conn_id');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('schema_snapshots')) {
            Schema::table('schema_snapshots', function (Blueprint $table) {
                $table->dropIndex('idx_snapshots_conn_version');
                $table->dropIndex('idx_snapshots_conn_id');
            });
        }
    }
};
