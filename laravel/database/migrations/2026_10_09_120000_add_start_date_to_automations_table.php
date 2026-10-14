<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('automations') && !Schema::hasColumn('automations', 'start_date')) {
            Schema::table('automations', function (Blueprint $table) {
                $table->date('start_date')->nullable()->after('timezone');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('automations') && Schema::hasColumn('automations', 'start_date')) {
            Schema::table('automations', function (Blueprint $table) {
                $table->dropColumn('start_date');
            });
        }
    }
};
