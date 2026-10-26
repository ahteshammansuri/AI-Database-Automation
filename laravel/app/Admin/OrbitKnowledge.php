<?php

namespace App\Admin;

use App\Models\OrbitKnowledgeGuide;
use App\Services\AiServiceClient;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Orbit's product knowledge. The guides live only in the database (edited in the admin panel); publishing sends the
 * included guides to the AI service, which indexes them for retrieval. No guide is read from files.
 */
final class OrbitKnowledge
{
    /**
     * Send every included guide to the AI service. The AI service replaces its published set and re-indexes.
     *
     * @return array{guides:int, chunks:int, version:?string, embedding_backend:?string}
     */
    public static function publish(): array
    {
        $guides = OrbitKnowledgeGuide::where('is_published', true)->orderBy('sort')->orderBy('id')->get();
        if ($guides->isEmpty()) {
            throw new RuntimeException('Include at least one guide before publishing. Orbit needs knowledge of the website to answer questions about it.');
        }

        try {
            $result = app(AiServiceClient::class)->publishProductGuides($guides->map->payload()->all());
        } catch (\Throwable $e) {
            throw new RuntimeException('The AI service did not accept the guides: ' . $e->getMessage());
        }

        // toBase(): mark what is live without touching updated_at.
        DB::transaction(function () use ($guides) {
            $now = now();
            foreach ($guides as $guide) {
                OrbitKnowledgeGuide::whereKey($guide->id)->toBase()->update(['published_hash' => $guide->contentHash(), 'published_at' => $now]);
            }
            OrbitKnowledgeGuide::where('is_published', false)->toBase()->update(['published_hash' => null, 'published_at' => null]);
        });

        AdminActivity::record('orbit_knowledge.published', 'Orbit knowledge', [
            'guides' => $guides->pluck('slug')->all(),
            'sections' => $result['chunks'] ?? null,
            'version' => $result['version'] ?? null,
        ], 'Published to Orbit');

        return [
            'guides' => (int) ($result['guides'] ?? $guides->count()),
            'chunks' => (int) ($result['chunks'] ?? 0),
            'version' => $result['version'] ?? null,
            'embedding_backend' => $result['embedding_backend'] ?? null,
        ];
    }

    /**
     * Re-publish when the AI service has no product knowledge although guides were published before (for example a
     * fresh AI service or lost index storage). Returns what was published, or null when nothing was needed.
     */
    public static function syncIfLost(): ?array
    {
        $live = self::liveStatus();
        if ($live === null || (int) ($live['chunks'] ?? 0) > 0) {
            return null;
        }
        if (!OrbitKnowledgeGuide::where('is_published', true)->exists()) {
            return null;
        }

        return self::publish();
    }

    /** What Orbit is using right now, as reported by the AI service (null when it cannot be reached). */
    public static function liveStatus(): ?array
    {
        return app(AiServiceClient::class)->productGuidesStatus();
    }
}
