<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Orbit Remote: a phone paired by QR code sends spoken requests to the user's open DataAuto tab and mirrors
 * the web Orbit. Pairing codes and device tokens are stored only as SHA-256 hashes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orbit_remote_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('public_id', 40)->unique();
            $table->string('status', 16)->default('pending'); // pending, active, ended
            $table->string('pairing_code_hash', 64)->nullable()->unique();
            $table->timestamp('pairing_expires_at')->nullable();
            $table->string('device_token_hash', 64)->nullable()->unique();
            $table->string('device_label', 120)->nullable();
            $table->string('device_ip', 45)->nullable();
            $table->string('desktop_instance', 64)->nullable();
            $table->unsignedBigInteger('desktop_token_id')->nullable(); // Sanctum token of the tab that paired
            $table->string('desktop_label', 120)->nullable();
            $table->json('desktop_state')->nullable();
            $table->timestamp('claimed_at')->nullable();
            $table->timestamp('last_device_seen_at')->nullable();
            $table->timestamp('last_desktop_seen_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->string('end_reason', 40)->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status']);
        });

        Schema::create('orbit_remote_commands', function (Blueprint $table) {
            $table->id();
            $table->foreignId('session_id')->constrained('orbit_remote_sessions')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 16); // say, stop
            $table->text('text')->nullable();
            $table->string('status', 16)->default('sent'); // sent, received, rejected
            $table->string('reason', 200)->nullable();
            $table->timestamp('received_at')->nullable();
            $table->timestamps();

            $table->index(['session_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('orbit_remote_commands');
        Schema::dropIfExists('orbit_remote_sessions');
    }
};
