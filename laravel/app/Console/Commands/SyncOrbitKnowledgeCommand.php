<?php

namespace App\Console\Commands;

use App\Admin\OrbitKnowledge;
use Illuminate\Console\Command;

/**
 * Keeps Orbit's product knowledge available: when the AI service reports no indexed guides (a fresh service or lost
 * index storage) the guides included in the admin panel are sent again. Edits are never published by this command
 * on their own; that stays an admin decision.
 */
class SyncOrbitKnowledgeCommand extends Command
{
    protected $signature = 'orbit:sync-knowledge';

    protected $description = 'Re-send the published Orbit guides when the AI service has none indexed';

    public function handle(): int
    {
        try {
            $result = OrbitKnowledge::syncIfLost();
        } catch (\Throwable $e) {
            $this->warn('Orbit guides could not be sent: ' . $e->getMessage());
            return self::FAILURE;
        }
        $this->info($result === null
            ? 'Nothing to do: the AI service already has the guides, has none to receive, or cannot be reached.'
            : "Sent {$result['guides']} guides ({$result['chunks']} sections) to the AI service.");

        return self::SUCCESS;
    }
}
