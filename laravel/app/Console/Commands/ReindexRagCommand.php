<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\Knowledge\KnowledgeIndexerService;

class ReindexRagCommand extends Command
{
    protected $signature = 'rag:reindex {user_id? : Optional user ID to reindex}';
    protected $description = 'Re-index knowledge base documents into the tenant FAISS vector stores';

    public function handle(KnowledgeIndexerService $indexer)
    {
        $userId = $this->argument('user_id');

        if ($userId) {
            $this->info("Re-indexing knowledge base for user #{$userId}...");
            $res = $indexer->reindexUser((int) $userId);
            $this->info("Done! Processed {$res['reindexed']} document(s) with {$res['total_vectors']} vectors. Failed: {$res['failed']}");
            if (!empty($res['errors'])) {
                foreach ($res['errors'] as $err) {
                    $this->error(" - Doc #{$err['document_id']} ({$err['title']}): {$err['error']}");
                }
            }
            return 0;
        }

        $this->info("Re-indexing knowledge base for all users across the platform...");
        $res = $indexer->reindexAll();
        $this->info("Platform RAG reindex complete! Users: {$res['users_processed']}, Documents: {$res['documents_reindexed']}, Total Vectors: {$res['total_vectors']}");
        return 0;
    }
}
