<?php

namespace App\Jobs;

use App\Models\DbConnection;
use App\Services\SchemaIntrospectionService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Indexes discovered table profiles into Python RAG asynchronously.
 * Runs in background on the default queue so connection creation and schema introspection
 * return instantly (< 300ms) without blocking web workers on Ollama vector embeddings.
 */
class IndexTableProfilesJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 300;
    public int $tries = 2;

    public function __construct(
        public DbConnection $connection,
        public array $tables
    ) {
        $this->onQueue('default');
    }

    public function handle(SchemaIntrospectionService $introspectionService): void
    {
        try {
            if (!$this->connection->exists) {
                return;
            }

            $count = count($this->tables);
            Log::info("[IndexTableProfilesJob] Starting background RAG indexing for connection #{$this->connection->id} ({$this->connection->name}) with {$count} tables.");
            $indexed = $introspectionService->indexTableProfilesIntoRag($this->connection, $this->tables);
            Log::info("[IndexTableProfilesJob] Finished background RAG indexing for connection #{$this->connection->id}: {$indexed}/{$count} indexed.");
        } catch (\Throwable $e) {
            Log::warning("[IndexTableProfilesJob] Background RAG indexing failed for connection #{$this->connection->id}: " . $e->getMessage());
        }
    }
}
