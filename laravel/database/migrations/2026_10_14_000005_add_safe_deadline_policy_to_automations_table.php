<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('automations', function (Blueprint $table) {
            if (!Schema::hasColumn('automations', 'safe_deadline_policy')) {
                $table->string('safe_deadline_policy', 32)
                    ->default('notify_and_wait')
                    ->after('timeout_policy'); // Allowed: skip, publish_last_valid, notify_and_wait
            }
        });
    }

    public function down(): void
    {
        Schema::table('automations', function (Blueprint $table) {
            if (Schema::hasColumn('automations', 'safe_deadline_policy')) {
                $table->dropColumn('safe_deadline_policy');
            }
        });
    }
};
