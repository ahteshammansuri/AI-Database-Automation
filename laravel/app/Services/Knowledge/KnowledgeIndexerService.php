<?php

namespace App\Services\Knowledge;

use App\Models\KnowledgeDocument;
use App\Models\AuditLog;
use App\Services\AiServiceClient;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Log;
use Exception;

class KnowledgeIndexerService
{
    public function __construct(
        protected AiServiceClient $aiClient
    ) {}

    /**
     * Extract text content from a stored knowledge document.
     */
    public function extractDocumentText(KnowledgeDocument $doc): string
    {
        $disk = Storage::disk('local');
        $filePath = $doc->file_path;
        $fullPath = $disk->path($filePath);

        if (!$disk->exists($filePath) && !file_exists($fullPath)) {
            Log::warning("[KnowledgeIndexer] File not found on disk for document #{$doc->id}: {$filePath}");
            return "";
        }

        $extension = strtolower($doc->file_type ?: pathinfo($filePath, PATHINFO_EXTENSION));

        if ($extension === 'pdf') {
            // Tier 1: Extract via AI microservice
            try {
                $textContent = $this->aiClient->extractTextFromFile($fullPath);
                if (!empty(trim($textContent))) {
                    return $textContent;
                }
            } catch (\Throwable $e) {
                Log::debug("[KnowledgeIndexer] Tier 1 PDF extraction failed for #{$doc->id}: " . $e->getMessage());
            }

            // Tier 2: Extract via local Python venv (PyMuPDF)
            $pythonBin = base_path('../.venv/bin/python');
            if (file_exists($pythonBin)) {
                $cmd = escapeshellarg($pythonBin) . ' -c ' . escapeshellarg("
import fitz
doc = fitz.open('{$fullPath}')
text = ''
for page in doc:
    text += page.get_text()
print(text)
");
                $extracted = shell_exec($cmd);
                if (!empty(trim((string) $extracted))) {
                    return trim((string) $extracted);
                }
            }
        }

        // Tier 3: Direct text / markdown read
        if ($disk->exists($filePath)) {
            return $disk->get($filePath) ?: "";
        }

        if (file_exists($fullPath)) {
            return file_get_contents($fullPath) ?: "";
        }

        return "";
    }

    /**
     * Index a single document into the user-isolated FAISS vector store.
     */
    public function indexDocument(KnowledgeDocument $doc): array
    {
        $text = $this->extractDocumentText($doc);
        if (empty(trim($text))) {
            $doc->update(['status' => 'failed']);
            throw new Exception("Document #{$doc->id} ({$doc->title}) contains no readable text content.");
        }

        $res = $this->aiClient->indexDocument(
            $doc->user_id,
            $doc->id,
            $doc->title,
            $text,
            $doc->file_type ?: 'txt'
        );

        $doc->update([
            'chunk_count' => $res['chunks_created'] ?? 0,
            'vector_count' => $res['total_vectors'] ?? 0,
            'status' => 'indexed',
        ]);

        return $res;
    }

    /**
     * Self-healing check: verifies that specified document IDs exist in the user's
     * FAISS index. If missing or the index is unpopulated, automatically re-indexes them.
     */
    public function ensureDocumentsIndexed(int $userId, array $documentIds): bool
    {
        if (empty($documentIds)) {
            return true;
        }

        $targetIds = array_values(array_unique(array_filter(array_map('intval', $documentIds))));
        $status = $this->aiClient->getRagStatus($userId);
        $indexedIds = array_map('intval', $status['document_ids'] ?? []);

        // Find which requested document IDs are not present in FAISS
        $missingIds = array_diff($targetIds, $indexedIds);

        if (empty($missingIds) && ($status['total_vectors'] ?? 0) > 0) {
            return true; // All requested documents are properly indexed
        }

        Log::info("[KnowledgeIndexer] Self-healing RAG vectors for user {$userId}. Missing document IDs: " . implode(',', $missingIds));

        $documents = KnowledgeDocument::where('user_id', $userId)
            ->whereIn('id', $targetIds)
            ->get();

        $reindexedCount = 0;
        foreach ($documents as $doc) {
            try {
                $this->indexDocument($doc);
                $reindexedCount++;
            } catch (\Throwable $e) {
                Log::error("[KnowledgeIndexer] Self-healing failed for document #{$doc->id}: " . $e->getMessage());
            }
        }

        return $reindexedCount > 0;
    }

    /**
     * Re-index all active knowledge documents for a given user.
     */
    public function reindexUser(int $userId): array
    {
        $documents = KnowledgeDocument::where('user_id', $userId)->get();
        $results = [
            'total_documents' => $documents->count(),
            'reindexed' => 0,
            'failed' => 0,
            'total_chunks' => 0,
            'total_vectors' => 0,
            'errors' => [],
        ];

        foreach ($documents as $doc) {
            try {
                $res = $this->indexDocument($doc);
                $results['reindexed']++;
                $results['total_chunks'] += ($res['chunks_created'] ?? 0);
                $results['total_vectors'] = max($results['total_vectors'], $res['total_vectors'] ?? 0);
            } catch (\Throwable $e) {
                $results['failed']++;
                $results['errors'][] = [
                    'document_id' => $doc->id,
                    'title' => $doc->title,
                    'error' => $e->getMessage(),
                ];
            }
        }

        AuditLog::log($userId, 'KNOWLEDGE_REINDEXED', 'KnowledgeDocument', 'all', [
            'reindexed' => $results['reindexed'],
            'total_vectors' => $results['total_vectors'],
        ]);

        return $results;
    }

    /**
     * Re-index all knowledge documents across the entire platform.
     */
    public function reindexAll(): array
    {
        $userIds = KnowledgeDocument::distinct()->pluck('user_id');
        $grandTotal = [
            'users_processed' => count($userIds),
            'documents_reindexed' => 0,
            'total_vectors' => 0,
        ];

        foreach ($userIds as $uid) {
            $userRes = $this->reindexUser($uid);
            $grandTotal['documents_reindexed'] += $userRes['reindexed'];
            $grandTotal['total_vectors'] += $userRes['total_vectors'];
        }

        return $grandTotal;
    }
}
