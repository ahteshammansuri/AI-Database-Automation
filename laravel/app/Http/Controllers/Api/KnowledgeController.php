<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\KnowledgeDocument;
use App\Models\AuditLog;
use App\Services\AiServiceClient;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Exception;

class KnowledgeController extends Controller
{
    public function __construct(
        protected AiServiceClient $aiClient
    ) {}

    public function index(Request $request)
    {
        $docs = KnowledgeDocument::where('user_id', $request->user()->id)
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($docs);
    }

    public function upload(Request $request)
    {
        $mb = (int) config('platform.knowledge_max_upload_mb', 10);
        $request->validate([
            'file' => 'required|file|max:' . ($mb * 1024) . '|extensions:md,markdown,txt,pdf', // admin setting (MB)
            'title' => 'nullable|string|max:255',
        ], ['file.max' => "The file must be {$mb} MB or smaller."]);

        $file = $request->file('file');
        $extension = strtolower($file->getClientOriginalExtension());

        if (!in_array($extension, ['md', 'markdown', 'txt', 'pdf'], true)) {
            $msg = 'Upload a Markdown (.md), text (.txt) or PDF (.pdf) file.';
            return response()->json(['message' => $msg, 'errors' => ['file' => [$msg]]], 422);
        }

        $title = $request->input('title') ?: pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME);
        $disk = Storage::disk('local');
        $filePath = $file->store('knowledge_docs', 'local');
        $fullPath = $disk->path($filePath);

        // Extract text
        $textContent = "";
        if ($extension === 'pdf') {
            // Tier 1: Extract via AI microservice
            try {
                $textContent = $this->aiClient->extractTextFromFile($fullPath);
            } catch (\Throwable $e) {
                $textContent = "";
            }

            // Tier 2: Fallback to dedicated extraction script
            if (empty(trim($textContent))) {
                $pythonBin = base_path('../.venv/bin/python');
                if (!file_exists($pythonBin)) {
                    $pythonBin = 'python3';
                }
                $scriptPath = base_path('../scripts/extract_pdf_text.py');
                if (file_exists($scriptPath)) {
                    $cmd = escapeshellarg($pythonBin) . ' ' . escapeshellarg($scriptPath) . ' ' . escapeshellarg($fullPath);
                    $textContent = shell_exec($cmd) ?: "";
                }
            }
        } else {
            if ($disk->exists($filePath)) {
                $textContent = $disk->get($filePath) ?: "";
            } elseif (file_exists($fullPath)) {
                $textContent = file_get_contents($fullPath) ?: "";
            }
        }

        if (empty(trim($textContent))) {
            return response()->json([
                'message' => 'Uploaded file is empty or no text could be extracted.',
            ], 422);
        }

        $doc = KnowledgeDocument::create([
            'user_id' => $request->user()->id,
            'title' => $title,
            'file_path' => $filePath,
            'file_type' => $extension,
            'file_size' => $file->getSize(),
            'status' => 'indexing',
        ]);

        try {
            // Call AI service to chunk and index into tenant FAISS store
            $indexRes = $this->aiClient->indexDocument(
                $request->user()->id,
                $doc->id,
                $title,
                $textContent,
                $extension
            );

            $doc->update([
                'chunk_count' => $indexRes['chunks_created'] ?? 0,
                'vector_count' => $indexRes['total_vectors'] ?? 0,
                'status' => 'indexed',
            ]);

            AuditLog::log($request->user()->id, 'KNOWLEDGE_DOC_INDEXED', 'KnowledgeDocument', (string) $doc->id, [
                'title' => $title,
                'chunks' => $doc->chunk_count,
            ]);

            return response()->json([
                'message' => 'Document indexed successfully into RAG knowledge base',
                'document' => $doc,
            ], 201);
        } catch (Exception $e) {
            $doc->update(['status' => 'failed']);
            return response()->json([
                'message' => 'Indexing failed: ' . $e->getMessage(),
                'document' => $doc,
            ], 500);
        }
    }

    public function destroy(Request $request, $id)
    {
        $doc = KnowledgeDocument::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        try {
            $this->aiClient->deleteDocument($request->user()->id, $doc->id);
        } catch (Exception $e) {
            // Ignore vector purge error if already removed
        }

        if ($doc->file_path && Storage::disk('local')->exists($doc->file_path)) {
            Storage::disk('local')->delete($doc->file_path);
        }

        $doc->delete();

        AuditLog::log($request->user()->id, 'KNOWLEDGE_DOC_DELETED', 'KnowledgeDocument', (string) $id);

        return response()->json([
            'message' => 'Document removed from knowledge base',
        ]);
    }

    /**
     * Test retrieval diagnostics: query tenant's FAISS index and return relevant chunks & scores.
     */
    /**
     * Knowledge documents that match an automation's topic, best first. Measured on nomic-embed-text: matching
     * topics score about 0.75-0.8 and unrelated ones 0.3-0.45, so only clear matches are suggested.
     */
    public function suggest(Request $request)
    {
        $validated = $request->validate(['topic' => 'required|string|min:3|max:4000']);
        $userId = $request->user()->id;
        $docs = KnowledgeDocument::where('user_id', $userId)->pluck('title', 'id');
        if ($docs->isEmpty()) {
            return response()->json(['suggestions' => [], 'backend' => null]);
        }

        try {
            $chunks = $this->aiClient->queryKnowledge($userId, mb_substr($validated['topic'], 0, 1000), 12);
        } catch (\Throwable) {
            return response()->json(['suggestions' => [], 'backend' => null, 'message' => 'Suggestions are unavailable right now.']);
        }

        $best = [];
        $backend = null;
        foreach ($chunks as $c) {
            $id = (int) ($c['document_id'] ?? 0);
            if (!$docs->has($id)) {
                continue;
            }
            $best[$id] = max($best[$id] ?? 0.0, (float) ($c['score'] ?? 0));
            $backend ??= $c['embedding_backend'] ?? null;
        }
        arsort($best);
        $floor = str_starts_with((string) $backend, 'ollama') ? 0.6 : 0.35;
        $top = $best ? reset($best) : 0.0;

        $suggestions = [];
        foreach ($best as $id => $score) {
            if ($score >= $floor && $score >= $top - 0.15 && count($suggestions) < 5) {
                $suggestions[] = ['id' => $id, 'title' => $docs[$id], 'score' => round($score, 3)];
            }
        }

        return response()->json(['suggestions' => $suggestions, 'backend' => $backend]);
    }

    public function query(Request $request)
    {
        $validated = $request->validate([
            'query' => 'required|string|max:500',
            'top_k' => 'nullable|integer|min:1|max:10',
        ]);

        $topK = (int) ($validated['top_k'] ?? 3);
        $userId = $request->user()->id;

        try {
            $chunks = $this->aiClient->queryKnowledge($userId, $validated['query'], $topK);

            // Enrich chunks with document titles from platform database
            $docIds = array_unique(array_filter(array_column($chunks, 'document_id')));
            $docs = KnowledgeDocument::where('user_id', $userId)
                ->whereIn('id', $docIds)
                ->pluck('title', 'id');

            $enriched = array_map(function ($c) use ($docs) {
                $docTitle = $docs[$c['document_id'] ?? null] ?? 'Knowledge Document';
                $score = (float) ($c['score'] ?? $c['similarity_score'] ?? 0.85);
                $text = (string) ($c['text'] ?? $c['content'] ?? '');
                return [
                    'chunk_id' => $c['chunk_id'] ?? '',
                    'document_id' => $c['document_id'] ?? null,
                    'document_title' => $docTitle,
                    'content' => $text,
                    'text' => $text,
                    'similarity_score' => $score,
                    'score' => $score,
                ];
            }, $chunks);

            return response()->json([
                'success' => true,
                'query' => $validated['query'],
                'matches' => $enriched,
                'chunks' => $enriched,
                'count' => count($enriched),
            ]);
        } catch (Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Semantic retrieval query failed: ' . $e->getMessage(),
                'matches' => [],
            ], 500);
        }
    }

    /**
     * Re-index all knowledge documents for the authenticated user.
     */
    public function reindex(Request $request, \App\Services\Knowledge\KnowledgeIndexerService $indexer)
    {
        try {
            $results = $indexer->reindexUser($request->user()->id);
            return response()->json([
                'success' => true,
                'message' => "Successfully indexed {$results['reindexed']} document(s) with {$results['total_vectors']} total vectors.",
                'data' => $results,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => 'Re-indexing failed: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Get RAG status and vector metrics for the authenticated user.
     */
    public function status(Request $request)
    {
        $userId = $request->user()->id;
        $status = $this->aiClient->getRagStatus($userId);

        $dbDocs = KnowledgeDocument::where('user_id', $userId)->get(['id', 'title', 'chunk_count', 'vector_count', 'status']);

        return response()->json([
            'success' => true,
            'rag' => $status,
            'documents_count' => $dbDocs->count(),
            'indexed_count' => count($status['document_ids'] ?? []),
            'total_vectors' => $status['total_vectors'] ?? 0,
            'backend' => $status['backend'] ?? 'unknown',
            'healthy' => ($status['healthy'] ?? false) || $dbDocs->isEmpty(),
        ]);
    }
}
