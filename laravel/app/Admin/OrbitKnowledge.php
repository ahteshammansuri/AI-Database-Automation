<?php

namespace App\Admin;

use App\Models\OrbitKnowledgeGuide;
use App\Services\AiServiceClient;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Orbit's product knowledge: the guides admins edit, the built-in guides that ship with the app (docs/orbit-agent),
 * and publishing the included guides to the AI service, which re-indexes them for retrieval.
 */
final class OrbitKnowledge
{
    public static function bundledPath(): string
    {
        return base_path('../docs/orbit-agent');
    }

    /** The built-in guides: slug, title (the file's "# " heading) and body (the rest). */
    public static function bundled(): array
    {
        $out = [];
        foreach (glob(self::bundledPath() . '/*.md') ?: [] as $i => $file) {
            $text = str_replace("\r\n", "\n", (string) file_get_contents($file));
            $slug = pathinfo($file, PATHINFO_FILENAME);
            $title = str($slug)->replace(['_', '-'], ' ')->ucfirst()->toString();
            if (preg_match('/\A#\s+(.+)\n/', $text, $m)) {
                $title = trim($m[1]);
                $text = substr($text, strlen($m[0]));
            }
            $out[] = ['slug' => $slug, 'title' => mb_substr($title, 0, 120), 'body' => trim($text), 'sort' => ($i + 1) * 10];
        }
        return $out;
    }

    /** Add the built-in guides, or put their original text back (custom guides are kept). Returns how many. */
    public static function restoreBundled(): int
    {
        $guides = self::bundled();
        DB::transaction(function () use ($guides) {
            foreach ($guides as $g) {
                $guide = OrbitKnowledgeGuide::firstOrNew(['slug' => $g['slug']]);
                $guide->fill($g + ['is_published' => true, 'updated_by' => auth('admin')->id()])->save();
            }
        });
        AdminActivity::record('orbit_knowledge.restored', 'Orbit knowledge', ['guides' => array_column($guides, 'slug')], 'Built-in guides');
        return count($guides);
    }

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

    /** What Orbit is using right now, as reported by the AI service (null when it cannot be reached). */
    public static function liveStatus(): ?array
    {
        return app(AiServiceClient::class)->productGuidesStatus();
    }
}
