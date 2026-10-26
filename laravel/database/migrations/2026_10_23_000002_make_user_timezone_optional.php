<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * users.timezone becomes optional: null means "follow the browser". Until Account settings existed nobody could set
 * it, so the column default 'UTC' was never a choice; those values are cleared so times keep following the browser.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('timezone')->nullable()->default(null)->change();
        });
        DB::table('users')->where('timezone', 'UTC')->update(['timezone' => null]);
    }

    public function down(): void
    {
        DB::table('users')->whereNull('timezone')->update(['timezone' => 'UTC']);
        Schema::table('users', function (Blueprint $table) {
            $table->string('timezone')->default('UTC')->nullable(false)->change();
        });
    }
};
